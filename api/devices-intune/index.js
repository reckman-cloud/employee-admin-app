const { ClientSecretCredential, ManagedIdentityCredential } = require('@azure/identity');
const { fetch: undiciFetch } = require('undici');

const fetch = global.fetch || undiciFetch;
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

function headers(req) {
  return {
    'Access-Control-Allow-Origin': req.headers?.origin || '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
  };
}

function principal(req) {
  try {
    return JSON.parse(Buffer.from(req.headers?.['x-ms-client-principal'] || '', 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function authorized(req) {
  const roles = principal(req)?.userRoles || [];
  const local = process.env.ALLOW_ANON_LOCAL === 'true' && process.env.FUNCTIONS_CORE_TOOLS_ENVIRONMENT === 'Development';
  return local || roles.includes('it_admin') || roles.includes('it_helpdesk');
}

function credential() {
  const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = process.env;
  return AZURE_TENANT_ID && AZURE_CLIENT_ID && AZURE_CLIENT_SECRET
    ? new ClientSecretCredential(AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET)
    : new ManagedIdentityCredential();
}

module.exports = async function (context, req) {
  const responseHeaders = headers(req);
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: responseHeaders };
    return;
  }
  if (!authorized(req)) {
    context.res = { status: 403, headers: responseHeaders, body: { ok: false, reason: 'unauthorized' } };
    return;
  }

  const serialNumber = String(req.query?.serialNumber || '').trim();
  if (!serialNumber) {
    context.res = { status: 400, headers: responseHeaders, body: { ok: false, reason: 'serial-number-required' } };
    return;
  }

  try {
    const token = await credential().getToken(GRAPH_SCOPE);
    const escapedSerial = serialNumber.replace(/'/g, "''");
    const params = new URLSearchParams({
      '$filter': `serialNumber eq '${escapedSerial}'`,
      '$select': 'serialNumber,deviceName,userDisplayName,userPrincipalName',
      '$top': '1',
    });
    const graphResponse = await fetch(`https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?${params}`, {
      headers: { Authorization: `Bearer ${token.token}` },
    });
    const body = await graphResponse.json().catch(() => null);
    if (!graphResponse.ok) throw new Error(`Microsoft Graph returned ${graphResponse.status}`);

    const device = body?.value?.[0];
    context.res = {
      status: 200,
      headers: responseHeaders,
      body: {
        ok: true,
        found: Boolean(device),
        source: 'intune',
        device: device ? {
          serialNumber: device.serialNumber || serialNumber,
          deviceName: device.deviceName || null,
          assignedUser: device.userDisplayName || device.userPrincipalName || null,
        } : null,
      },
    };
  } catch (error) {
    context.log.error('Intune device search failed', error?.message || error);
    context.res = { status: 502, headers: responseHeaders, body: { ok: false, reason: 'intune-search-failed' } };
  }
};
