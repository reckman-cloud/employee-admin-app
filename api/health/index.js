const { QueueClient } = require("@azure/storage-queue");
const getConn = () => process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage || "";
const getQueueName = () => String(process.env.AZURE_QUEUE_NAME || "").toLowerCase();
const allowAnonymousHealth = () => process.env.ALLOW_ANON_HEALTH === 'true';

const parseConnectionInfo = conn => {
  if (!conn) return {};

  const map = {};
  conn.split(';').forEach(pair => {
    const i = pair.indexOf('=');
    if (i === -1) return;
    const key = pair.slice(0, i);
    const value = pair.slice(i + 1);
    map[key] = value;
  });

  const sas = map.SharedAccessSignature || '';
  let sasPermissions = null;
  let sasServices = null;
  let sasResourceTypes = null;

  if (sas) {
    try {
      const params = new URLSearchParams(sas.startsWith('?') ? sas.slice(1) : sas);
      sasPermissions = params.get('sp');
      sasServices = params.get('ss');
      sasResourceTypes = params.get('srt');
    } catch {
      // Ignore malformed SAS fragments; diagnostics are best-effort.
    }
  }

  return {
    accountName: map.AccountName || null,
    queueEndpoint: map.QueueEndpoint || null,
    endpointSuffix: map.EndpointSuffix || null,
    credentialType: map.AccountKey ? 'accountKey' : sas ? 'sas' : null,
    sasPermissions,
    sasServices,
    sasResourceTypes,
  };
};

const redact = (text, conn) => {
  if (!text) return null;
  if (!conn) return text;
  return text.replace(conn, '[redacted-connection-string]');
};

const storageSnapshot = (conn, queue) => ({
  queue,
  connectionStringLength: conn?.length || 0,
  connectionStringPreview: conn ? `${conn.slice(0, 6)}...${conn.slice(-4)}` : null,
  connectionInfo: parseConnectionInfo(conn),
});
function getPrincipal(req){ try{ const raw=req.headers["x-ms-client-principal"]; if(!raw) return null; return JSON.parse(Buffer.from(raw,'base64').toString('utf8')); }catch{ return null; } }
function isAdmin(p){ return Boolean(p?.userRoles?.includes('it_admin')); }
module.exports = async function (context, req) {
  const origin = req.headers?.origin || "*";
  const cors = { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Methods": "GET,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  if (req.method === "OPTIONS") { context.res = { status: 204, headers: cors }; return; }

  const p = getPrincipal(req);
  const bypassLocal = process.env.ALLOW_ANON_LOCAL === 'true' && (process.env.FUNCTIONS_CORE_TOOLS_ENVIRONMENT === 'Development');
  const anonymousHealth = allowAnonymousHealth();
  if (!isAdmin(p) && !bypassLocal && !anonymousHealth) {
    context.res = { status: 403, headers: cors, body: { ok:false, reason:'unauthorized' } }; return;
  }

  try {
    const conn = getConn();
    const queue = getQueueName();

    const storage = storageSnapshot(conn, queue);

    if (!conn || !queue) {
      context.res = { status: 503, headers: { "Content-Type":"application/json; charset=utf-8", ...cors }, body: { ok:false, reason:'missing-storage-settings', storage } };
      return;
    }

    const qc = new QueueClient(conn, queue);
    const exists = await qc.exists();

    if (!exists) {
      context.res = { status: 503, headers: { "Content-Type":"application/json; charset=utf-8", ...cors }, body: { ok:false, reason:'queue-not-found', storage } };
      return;
    }

    const props = await qc.getProperties();
    context.res = { status: 200, headers: { "Content-Type":"application/json; charset=utf-8", ...cors },
      body: { ok:true, queue:{ name: qc.name, approximateMessagesCount: props.approximateMessagesCount ?? null }, storage } };
  } catch (error) {
    const reason = error?.details?.errorCode || error?.code || 'queue-connection-failed';
    const conn = getConn();
    const storage = storageSnapshot(conn, getQueueName());
    const diagnostics = {
      reason,
      statusCode: error?.statusCode ?? null,
      message: redact(error?.message || String(error), conn),
    };

    context.log.error('Health check failed', reason, diagnostics.message);
    context.res = { status: 503, headers: { "Content-Type":"application/json; charset=utf-8", ...cors }, body: { ok:false, reason, storage, diagnostics } };
  }
};
