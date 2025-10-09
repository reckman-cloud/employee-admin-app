// /api/groups-check/index.js  (diagnostic; no console logs, returns structured detail)
const { DefaultAzureCredential, ClientSecretCredential, ManagedIdentityCredential } = require("@azure/identity");
const { fetch: undiciFetch } = require("undici");

const fetch = global.fetch || undiciFetch; // ensure fetch exists on Node 16+
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

function cors(req){ const o=req.headers?.origin||"*"; return {"Access-Control-Allow-Origin":o,"Vary":"Origin","Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"Content-Type"}; }

function getCredential() {
  const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = process.env;
  if (AZURE_TENANT_ID && AZURE_CLIENT_ID && AZURE_CLIENT_SECRET) {
    // App registration (client credentials)
    return new ClientSecretCredential(AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET);
  }
  // Prefer MI explicitly; DefaultAzureCredential sometimes skips if not present
  return new ManagedIdentityCredential(); // falls back to identity assigned to the Function App
}

async function getTokenAndPrincipal() {
  const cred = getCredential();
  const token = await cred.getToken(GRAPH_SCOPE);
  return { token: token?.token || null, principalHint: (cred.id || cred.clientId || null) };
}

async function g(url, at, extraHeaders = {}) {
  const r = await fetch(url, { headers: { Authorization:`Bearer ${at}`, ConsistencyLevel:'eventual', ...extraHeaders } });
  const text = await r.text(); // raw to avoid JSON parse errors masking issues
  let body = null; try { body = JSON.parse(text); } catch {}
  return { ok: r.ok, status: r.status, body, raw: body ? undefined : (text || null) };
}

function esc(s){ return String(s).replace(/'/g,"''"); }

module.exports = async function (context, req) {
  if (req.method === "OPTIONS") { context.res = { status: 204, headers: cors(req) }; return; }
  const headers = cors(req);

  const result = { ok:false, stage:null, details:{} };

  try {
    // 1) Token
    result.stage = "token";
    const { token, principalHint } = await getTokenAndPrincipal().catch(e => ({ token:null, principalHint:null, error:String(e && e.message || e) }));
    if (!token) {
      result.details = { reason: "token-failed", hint: "No Graph token from Managed Identity/App Reg", principalHint };
      context.res = { status: 200, headers, body: result }; return;
    }
    result.details.tokenAcquired = true;
    result.details.principalHint = principalHint || null;

    // 2) Resolve groupId
    result.stage = "group";
    let gid = process.env.MANAGERS_GROUP_ID || "";
    if (!gid) {
      const name = process.env.MANAGERS_GROUP_NAME || process.env.MANAGERS_GROUP_NICKNAME || "dyn-user-e5s";
      // Try mailNickname then displayName
      let q = await g(`https://graph.microsoft.com/v1.0/groups?$filter=mailNickname eq '${esc(name)}'&$select=id,displayName&$top=1`, token);
      gid = q.body?.value?.[0]?.id || "";
      if (!gid) {
        q = await g(`https://graph.microsoft.com/v1.0/groups?$filter=displayName eq '${esc(name)}'&$select=id,displayName&$top=1`, token);
        gid = q.body?.value?.[0]?.id || "";
      }
      if (!gid) {
        result.details = { reason:"group-not-found", tried: name, lastStatus: q.status, lastBody: q.body || q.raw || null };
        context.res = { status: 200, headers, body: result }; return;
      }
    }
    result.details.groupId = gid;

    // 3) Counts & samples
    result.stage = "members";
    const directCount = await g(`https://graph.microsoft.com/v1.0/groups/${gid}/members/$count`, token);
    const transCount = await g(`https://graph.microsoft.com/v1.0/groups/${gid}/transitiveMembers/$count`, token);
    const sample = await g(`https://graph.microsoft.com/v1.0/groups/${gid}/transitiveMembers/microsoft.graph.user?$select=id,displayName,jobTitle,department,userPrincipalName&$top=5`, token);

    if (!directCount.ok && !transCount.ok && !sample.ok) {
      result.details = {
        reason: "members-query-failed",
        direct: { status: directCount.status, body: directCount.body || directCount.raw || null },
        trans: { status: transCount.status, body: transCount.body || transCount.raw || null },
        sample: { status: sample.status, body: sample.body || sample.raw || null }
      };
      context.res = { status: 200, headers, body: result }; return;
    }

    const sampleUsers = Array.isArray(sample.body?.value) ? sample.body.value.map(u => ({
      id: u.id,
      name: u.displayName || u.userPrincipalName || null,
      title: u.jobTitle || null,
      dept: u.department || null
    })) : [];

    result.ok = true;
    result.stage = "done";
    result.details = {
      groupId: gid,
      directCount: directCount.ok ? Number(directCount.body) : null,
      transitiveCount: transCount.ok ? Number(transCount.body) : null,
      sampleUsers
    };

    context.res = { status: 200, headers, body: result };
  } catch (e) {
    // keep minimal message; no logs
    result.ok = false;
    result.details = { reason: "exception", message: (e && e.message) || "error" };
    context.res = { status: 200, headers, body: result };
  }
};
