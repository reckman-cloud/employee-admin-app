const { QueueClient } = require("@azure/storage-queue");
const getConn = () => process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage || "";
const getQueueName = () => String(process.env.AZURE_QUEUE_NAME || "").toLowerCase();
function getPrincipal(req){ try{ const raw=req.headers["x-ms-client-principal"]; if(!raw) return null; return JSON.parse(Buffer.from(raw,'base64').toString('utf8')); }catch{ return null; } }
function isAdmin(p){ return Boolean(p?.userRoles?.includes('it-admin')); }
module.exports = async function (context, req) {
  const origin = req.headers?.origin || "*";
  const cors = { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Methods": "GET,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  if (req.method === "OPTIONS") { context.res = { status: 204, headers: cors }; return; }

  const p = getPrincipal(req);
  const bypassLocal = process.env.ALLOW_ANON_LOCAL === 'true' && (process.env.FUNCTIONS_CORE_TOOLS_ENVIRONMENT === 'Development');
  if (!isAdmin(p) && !bypassLocal) { context.res = { status: 403, headers: cors, body: { ok:false } }; return; }

  try {
    const qc = new QueueClient(getConn(), getQueueName()); await qc.createIfNotExists();
    const props = await qc.getProperties();
    context.res = { status: 200, headers: { "Content-Type":"application/json; charset=utf-8", ...cors },
      body: { ok:true, queue:{ name: qc.name, approximateMessagesCount: props.approximateMessagesCount ?? null } } };
  } catch {
    context.res = { status: 503, headers: { "Content-Type":"application/json; charset=utf-8", ...cors }, body: { ok:false } };
  }
};
