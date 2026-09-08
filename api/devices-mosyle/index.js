const testing;
const { fetch: undiciFetch } = require('undici');

const fetch = global.fetch || undiciFetch;

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

function deviceList(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.devices)) return body.devices;
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body?.response?.[0]?.devices)) return body.response[0].devices;
  if (Array.isArray(body?.response)) return body.response;
  if (Array.isArray(body?.response?.devices)) return body.response.devices;
  return [];
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

  const endpoint = process.env.MOSYLE_API_URL || 'https://managerapi.mosyle.com/v2/listdevices';
  const token = process.env.MOSYLE_API_TOKEN || '';
  if (!token) {
    context.res = { status: 503, headers: responseHeaders, body: { ok: false, reason: 'mosyle-not-configured' } };
    return;
  }

  try {
    const mosyleResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: { serial_numbers: [serialNumber], page: 1, page_size: 1 } }),
    });
    const body = await mosyleResponse.json().catch(() => null);
    if (!mosyleResponse.ok) throw new Error(`Mosyle returned ${mosyleResponse.status}`);

    const rawDevice = deviceList(body)[0];
    const device = rawDevice ? {
      serialNumber: rawDevice.serial_number || rawDevice.serialNumber || serialNumber,
      deviceName: rawDevice.device_name || rawDevice.deviceName || rawDevice.name || null,
      assignedUser: rawDevice.username || rawDevice.user_name || rawDevice.assigned_user || rawDevice.user?.name || rawDevice.user?.email || null,
    } : null;
    context.res = { status: 200, headers: responseHeaders, body: { ok: true, found: Boolean(device), source: 'mosyle', device } };
  } catch (error) {
    context.log.error('Mosyle device search failed', error?.message || error);
    context.res = { status: 502, headers: responseHeaders, body: { ok: false, reason: 'mosyle-search-failed' } };
  }
};
