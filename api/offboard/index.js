const { QueueClient } = require("@azure/storage-queue");
const getConn = () => process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage || "";
const getQueueName = () => String(process.env.AZURE_QUEUE_NAME || "").toLowerCase();
const ensureQueue = async () => { const qc = new QueueClient(getConn(), getQueueName()); await qc.createIfNotExists(); return qc; };
const encodeMsg = (obj) => { const json = JSON.stringify(obj); const b64 = Buffer.from(json, "utf8").toString("base64"); if (Buffer.byteLength(b64) > 64 * 1024) throw new Error("Message too large"); return b64; };
function getPrincipal(req){ try{ const raw=req.headers["x-ms-client-principal"]; if(!raw) return null; return JSON.parse(Buffer.from(raw,'base64').toString('utf8')); }catch{ return null; } }
function isAdmin(p){ return Boolean(p?.userRoles?.includes('it_admin')); }

module.exports = async function (context, req) {
  const origin = req.headers?.origin || "*";
  const cors = { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Methods": "POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  if (req.method === "OPTIONS") { context.res = { status: 204, headers: cors }; return; }

  const p = getPrincipal(req);
  const bypassLocal = process.env.ALLOW_ANON_LOCAL === 'true' && (process.env.FUNCTIONS_CORE_TOOLS_ENVIRONMENT === 'Development');
  if (!isAdmin(p) && !bypassLocal) { context.res = { status: 403, headers: cors, body: { ok:false } }; return; }

  const employee = String(req.body?.employee || "").trim();
  const managerId = String(req.body?.managerId || "").trim();
  const managerUpn = String(req.body?.managerUpn || "").trim();
  const managerName = String(req.body?.managerName || "").trim();
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';

  if (!employee) { context.res = { status: 400, headers: cors, body: { ok:false, error:"Missing employee" } }; return; }

  const conn = getConn();
  const queue = getQueueName();

  if (!conn || !queue) { context.res = { status: 503, headers: cors, body: { ok:false, error:"Storage not configured" } }; return; }

  try {
    const qc = await ensureQueue();
    const submittedAt = new Date().toISOString();
    const envelope = {
      type: "employee.termination",
      schema: 1,
      submittedAt,
      requestedBy: p?.userDetails || p?.userId || null,
      employee,
      manager: managerId || managerUpn || managerName ? { id: managerId || null, upn: managerUpn || null, name: managerName || null } : null,
      notes: notes || null,
    };

    const message = encodeMsg(envelope);
    const response = await qc.sendMessage(message);

    context.res = { status: 200, headers: { "Content-Type":"application/json; charset=utf-8", ...cors }, body: { ok:true, submittedAt, messageId: response.messageId } };
  } catch {
    context.res = { status: 500, headers: { "Content-Type":"application/json; charset=utf-8", ...cors }, body: { ok:false, error:"Queue submit failed" } };
  }
};
