const path = require("node:path");
const fs = require("node:fs/promises");
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
    const dataDir = path.resolve(__dirname, "../../data");
    const [deps, bus, mgrs] = await Promise.all([
      fs.readFile(path.join(dataDir, "departments.json"), "utf8"),
      fs.readFile(path.join(dataDir, "business-units.json"), "utf8"),
      fs.readFile(path.join(dataDir, "managers.json"), "utf8")
    ]);
    context.res = { status: 200, headers: { "Content-Type":"application/json; charset=utf-8", ...cors },
      body: { ok:true, departments: JSON.parse(deps), businessUnits: JSON.parse(bus), managers: JSON.parse(mgrs) } };
  } catch {
    context.res = { status: 500, headers: { "Content-Type":"application/json; charset=utf-8", ...cors }, body: { ok:false, error:"Failed to load lists" } };
  }
};
