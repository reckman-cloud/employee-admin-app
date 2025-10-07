const { QueueClient } = require("@azure/storage-queue");
const getConn = () => process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage || "";
const getQueueName = () => String(process.env.AZURE_QUEUE_NAME || "").toLowerCase();
const ensureQueue = async () => { const qc = new QueueClient(getConn(), getQueueName()); await qc.createIfNotExists(); return qc; };
const encodeMsg = (obj) => { const json = JSON.stringify(obj); const b64 = Buffer.from(json, "utf8").toString("base64"); if (Buffer.byteLength(b64) > 64 * 1024) throw new Error("Message too large"); return b64; };
function getPrincipal(req){ try{ const raw=req.headers["x-ms-client-principal"]; if(!raw) return null; return JSON.parse(Buffer.from(raw,'base64').toString('utf8')); }catch{ return null; } }
function isAdmin(p){ return Boolean(p?.userRoles?.includes('it-admin')); }

module.exports = async function (context, req) {
  const origin = req.headers?.origin || "*";
  const cors = { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Methods": "POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  if (req.method === "OPTIONS") { context.res = { status: 204, headers: cors }; return; }

  const p = getPrincipal(req);
  const bypassLocal = process.env.ALLOW_ANON_LOCAL === 'true' && (process.env.FUNCTIONS_CORE_TOOLS_ENVIRONMENT === 'Development');
  if (!isAdmin(p) && !bypassLocal) { context.res = { status: 403, headers: cors, body: { ok:false } }; return; }

  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  if (!entries.length) { context.res = { status: 400, headers: cors, body: { ok:false, error:"No entries" } }; return; }

  try {
    const qc = await ensureQueue();
    const submittedAt = new Date().toISOString();
    const accepted = [], failed = [];
    const tasks = entries.map((e, index) => async () => {
      const id = e?.id || `no-id-${index}`;
      try { const envelope = { type: "employee.entry", schema: 1, submittedAt, id, data: e };
        const payload = encodeMsg(envelope); const out = await qc.sendMessage(payload); accepted.push({ id, messageId: out.messageId }); }
      catch { failed.push({ id }); }
    });
    for (let i=0;i<tasks.length;i+=5) await Promise.all(tasks.slice(i,i+5).map(fn=>fn()));
    context.res = { status: 200, headers: { "Content-Type":"application/json; charset=utf-8", ...cors }, body: { ok: failed.length===0, submittedAt, accepted, failed } };
  } catch {
    context.res = { status: 500, headers: { "Content-Type":"application/json; charset=utf-8", ...cors }, body: { ok:false, error:"Submit failed" } };
  }
};
