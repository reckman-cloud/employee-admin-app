const fetch = global.fetch || require('undici').fetch;
const DEVICE_COLUMNS = [
  'serial_number',
  'device_name',
  'device_type',
  'os',
  'username',
  'useremail',
  'userid',
];

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

async function failure(context, response, operation, knownText) {
  const text = knownText ?? await response.text();
  const body = parseJson(text);
  const errors = errorDetails(body);
  if (!errors.length && text) errors.push(text.trim().slice(0, 500));
  context.log.error(`Mosyle ${operation} failed`, response.status, errors.join('; '));
  return {
    ok: false,
    reason: `mosyle-${operation}-failed`,
    upstreamStatus: response.status,
    diagnostics: {
      stage: operation,
      invocationId: context.invocationId || null,
      responseType: response.headers?.get?.('content-type') || null,
    },
    errors: [`Mosyle ${operation} returned HTTP ${response.status}`, ...errors],
  };
}

function logStage(context, stage, details = {}) {
  const log = context.log?.info || context.log;
  if (typeof log === 'function') {
    log('Mosyle device search diagnostic', {
      stage,
      invocationId: context.invocationId || null,
      ...details,
    });
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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
  const configuredTimeout = Number(process.env.MOSYLE_API_TIMEOUT_MS || 15000);
  const timeoutMs = Number.isFinite(configuredTimeout)
    ? Math.min(Math.max(configuredTimeout, 1000), 30000)
    : 15000;
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

  let stage = 'login-request';
  try {
    logStage(context, 'login-request', { url: `${apiUrl}/login` });
    const loginResponse = await fetchWithTimeout(`${apiUrl}/login`, {
      method: 'POST',
      headers: { accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
      }),
    }, timeoutMs);
    stage = 'login-response';
    logStage(context, 'login-response', { status: loginResponse.status });
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
          diagnostics: {
            stage: 'login-token-extraction',
            invocationId: context.invocationId || null,
            responseType: loginResponse.headers?.get?.('content-type') || null,
          },
          errors: ['Mosyle login response did not include a bearer token in the Authorization header or response body.'],
        },
      };
      return;
    }

    const deviceRequestBody = {
      operation: 'list',
      options: {
        serial_numbers: [serialNumber],
        page: 1,
        page_size: 1,
        specific_columns: DEVICE_COLUMNS,
      },
    };
    stage = 'device-request';
    logStage(context, 'device-request', {
      url: `${apiUrl}/devices`,
      operation: deviceRequestBody.operation,
      optionKeys: Object.keys(deviceRequestBody.options),
    });
    const mosyleResponse = await fetchWithTimeout(`${apiUrl}/devices`, {
      method: 'POST',
      headers: {
        accessToken,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(deviceRequestBody),
    }, timeoutMs);
    stage = 'device-response';
    const deviceResponseText = await mosyleResponse.text();
      status: mosyleResponse.status,
      responseType: mosyleResponse.headers?.get?.('content-type') || null,
      responseLength: deviceResponseText.length,
    });
    const body = parseJson(deviceResponseText);
    if (!mosyleResponse.ok) {
      context.res = {
        status: 502,
        headers: responseHeaders,
        body: await failure(context, mosyleResponse, 'device search', deviceResponseText),
      };
      return;
    }

    const rawDevice = deviceList(body)[0];
    const device = rawDevice ? {
      serialNumber: rawDevice.serial_number || rawDevice.serialNumber || serialNumber,
      deviceName: rawDevice.device_name || rawDevice.deviceName || rawDevice.name || null,
      assignedUser: rawDevice.username || rawDevice.useremail || rawDevice.userid || null,
    } : null;
    context.res = { status: 200, headers: responseHeaders, body: { ok: true, found: Boolean(device), source: 'mosyle', device } };
  } catch (error) {
    context.log.error('Mosyle device search failed', stage, error?.message || error);
    context.res = {
      status: 502,
      headers: responseHeaders,
      body: {
        ok: false,
        reason: 'mosyle-search-failed',
        diagnostics: {
          stage,
          invocationId: context.invocationId || null,
          errorType: error?.name || null,
          timeoutMs,
        },
        errors: [
          error?.name === 'AbortError'
            ? `Mosyle ${stage} timed out after ${timeoutMs} ms.`
            : error?.message || 'The Mosyle request could not be completed.',
        ],
      },
    };
  }
};
