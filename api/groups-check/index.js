// /api/groups-check/index.js
const { DefaultAzureCredential, ClientSecretCredential } = require("@azure/identity");
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

function cors(req){ const o=req.headers?.origin||"*"; return {"Access-Control-Allow-Origin":o,"Vary":"Origin","Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"Content-Type"}; }
function cred(){
  const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = process.env;
  return (AZURE_TENANT_ID && AZURE_CLIENT_ID && AZURE_CLIENT_SECRET)
    ? new ClientSecretCredential(AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET)
    : new DefaultAzureCredential({ excludeInteractiveBrowserCredential: true });
}
async function token(){ const t = await cred().getToken(GRAPH_SCOPE); if(!t?.token) throw new Error("no token"); return t.token; }
async function g(url, at, extraHeaders={}) {
  const r = await fetch(url, { headers: { Authorization:`Bearer ${at}`, ConsistencyLevel:'eventual', ...extraHeaders } });
  const j = await r.json().catch(()=>null);
  return { ok: r.ok, status: r.status, body: j };
}
function esc(s){ return String(s).replace(/'/g,"''"); }

module.exports = async function (context, req) {
  if (req.method === "OPTIONS") { context.res = { status: 204, headers: cors(req) }; return; }
  const headers = cors(req);
  try {
    const at = await token();

    // Resolve group id (env first, then nickname/displayName)
    let gid = process.env.MANAGERS_GROUP_ID || "";
    if (!gid) {
      const name = process.env.MANAGERS_GROUP_NAME || process.env.MANAGERS_GROUP_NICKNAME || "dyn-user-e5s";
      const q1 = await g(`https://graph.microsoft.com/v1.0/groups?$filter=mailNickname eq '${esc(name)}'&$select=id,displayName&$top=1`, at);
      gid = q1.body?.value?.[0]?.id || "";
      if (!gid) {
        const q2 = await g(`https://graph.microsoft.com/v1.0/groups?$filter=displayName eq '${esc(name)}'&$select=id,displayName&$top=1`, at);
        gid = q2.body?.value?.[0]?.id || "";
      }
    }
    if (!gid) { context.res = { status: 404, headers, body: { ok:false, error:"Group not found" } }; return; }

    // Count direct members
    const m1 = await g(`https://graph.microsoft.com/v1.0/groups/${gid}/members/$count`, at, { ConsistencyLevel:'eventual' });
    // Count transitive users-only
    const m2 = await g(`https://graph.microsoft.com/v1.0/groups/${gid}/transitiveMembers/microsoft.graph.user?$top=5`, at);
    const countTrans = await g(`https://graph.microsoft.com/v1.0/groups/${gid}/transitiveMembers/$count`, at);

    context.res = {
      status: 200, headers,
      body: {
        ok: true,
        groupId: gid,
        directCount: m1.ok ? Number(m1.body) : null,
        transitiveCount: countTrans.ok ? Number(countTrans.body) : null,
        sampleUsers: Array.isArray(m2.body?.value) ? m2.body.value.map(u => ({
          id: u.id, name: u.displayName || u.userPrincipalName || null,
          title: u.jobTitle || null, dept: u.department || null
        })) : [],
        notes: "If counts > 0 but sampleUsers empty/null fields, add User.Read.All; for hidden membership, add Member.Read.Hidden."
      }
    };
  } catch {
    context.res = { status: 500, headers, body: { ok:false } };
  }
};
