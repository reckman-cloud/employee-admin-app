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

function errorDetails(body) {
  const details = [];
  const visit = (value, key = '') => {
    if (details.length >= 10 || value == null) return;
    if (typeof value === 'string' || typeof value === 'number') {
      if (['error', 'errors', 'message', 'detail', 'reason'].includes(key.toLowerCase())) {
        const text = String(value).trim().slice(0, 500);
        if (text && !details.includes(text)) details.push(text);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, key));
      return;
    }
    if (typeof value === 'object') {
      Object.entries(value).forEach(([childKey, childValue]) => visit(childValue, childKey));
    }
  };
  visit(body);
  return details;
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function bearerToken(response, body) {
  const authorization = response.headers?.get?.('authorization') || '';
  const headerToken = authorization.replace(/^Bearer\s+/i, '').trim();
  const candidates = [
    headerToken,
    body?.bearerToken,
    body?.bearer_token,
    body?.token,
    body?.accessToken,
    body?.access_token,
    body?.response?.bearerToken,
    body?.response?.token,
    body?.response?.accessToken,
    body?.response?.[0]?.bearerToken,
    body?.response?.[0]?.token,
    body?.response?.[0]?.accessToken,
  ];
  return candidates.find(value => typeof value === 'string' && value.trim())?.trim() || '';
}

async function failure(context, response, operation) {
  const responseText = await response.text();
  const body = parseJson(responseText);
  const errors = errorDetails(body);
  if (!errors.length && responseText) errors.push(responseText.trim().slice(0, 500));
  context.log.error(`Mosyle ${operation} failed`, response.status, errors.join('; '));
  return {
    ok: false,
    reason: `mosyle-${operation}-failed`,
    upstreamStatus: response.status,
    errors: [`Mosyle ${operation} returned HTTP ${response.status}`, ...errors],
  };
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

  const apiUrl = (process.env.MOSYLE_API_URL || 'https://businessapi.mosyle.com/v1').replace(/\/$/, '');
  const accessToken = process.env.MOSYLE_API_TOKEN || '';
  const email = process.env.MOSYLE_API_EMAIL || '';
  const password = process.env.MOSYLE_API_PASSWORD || '';
  if (!accessToken || !email || !password) {
    const missing = [
      !accessToken && 'MOSYLE_API_TOKEN',
      !email && 'MOSYLE_API_EMAIL',
      !password && 'MOSYLE_API_PASSWORD',
    ].filter(Boolean);
    context.res = {
      status: 503,
      headers: responseHeaders,
      body: {
        ok: false,
        reason: 'mosyle-not-configured',
        errors: [`Missing Mosyle configuration: ${missing.join(', ')}`],
      },
    };
    return;
  }

  try {
    const loginResponse = await fetch(`${apiUrl}/login`, {
      method: 'POST',
      headers: { accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
      }),
    });
    if (!loginResponse.ok) {
      context.res = { status: 502, headers: responseHeaders, body: await failure(context, loginResponse, 'login') };
      return;
    }

    const loginText = await loginResponse.text();
    const token = bearerToken(loginResponse, parseJson(loginText));
    if (!token) {
      context.log.error('Mosyle login response did not include an Authorization bearer token');
      context.res = {
        status: 502,
        headers: responseHeaders,
        body: {
          ok: false,
          reason: 'mosyle-login-failed',
          errors: ['Mosyle login response did not include a bearer token in the Authorization header or response body.'],
        },
      };
      return;
    }

    const mosyleResponse = await fetch(`${apiUrl}/devices`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        options: { serial_numbers: [serialNumber], page: 1, page_size: 1 },
      }),
    });
    const responseText = await mosyleResponse.text();
    const body = parseJson(responseText);
    if (!mosyleResponse.ok) {
      context.res = {
        status: 502,
        headers: responseHeaders,
        body: await failure(context, {
          status: mosyleResponse.status,
          text: async () => responseText,
        }, 'device search'),
      };
      return;
    }

    const rawDevice = deviceList(body)[0];
    const device = rawDevice ? {
      serialNumber: rawDevice.serial_number || rawDevice.serialNumber || serialNumber,
      deviceName: rawDevice.device_name || rawDevice.deviceName || rawDevice.name || null,
      assignedUser: rawDevice.username || rawDevice.user_name || rawDevice.assigned_user || rawDevice.user?.name || rawDevice.user?.email || null,
    } : null;
    context.res = { status: 200, headers: responseHeaders, body: { ok: true, found: Boolean(device), source: 'mosyle', device } };
  } catch (error) {
    context.log.error('Mosyle device search failed', error?.message || error);
    context.res = {
      status: 502,
      headers: responseHeaders,
      body: {
        ok: false,
        reason: 'mosyle-search-failed',
        errors: [error?.message || 'The Mosyle request could not be completed.'],
      },
    };
  }
};
