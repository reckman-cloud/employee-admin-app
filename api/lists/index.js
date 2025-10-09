// /api/lists/index.js
// Managers from Entra ID via App Registration; returns upn. No static fallback.
// Requires env: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, MANAGERS_GROUP_ID
const path = require("node:path");
const fs = require("node:fs/promises");
const { ClientSecretCredential } = require("@azure/identity");
const { fetch: undiciFetch } = require("undici");

const fetch = global.fetch || undiciFetch;
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const TIMEOUT_MS = 10000;

// ---- auth (defense-in-depth)
function getPrincipal(req) {
  try { const raw = req.headers["x-ms-client-principal"]; if (!raw) return null;
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch { return null; }
}
function isAdmin(p) {
  const roles = Array.isArray(p?.userRoles) ? p.userRoles.map(r => String(r).trim().toLowerCase()) : [];
  return roles.includes("it_admin");
}

// ---- CORS
const corsHeaders = (req) => {
  const origin = req.headers?.origin || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
};

// ---- data-dir resolution
async function resolveDataDir(currentDir) {
  const candidates = [
    process.env.DATA_DIR && path.resolve(process.env.DATA_DIR),
    path.join(process.cwd(), "data"),
    path.join(currentDir, "..", "data")
  ].filter(Boolean);
  for (const p of candidates) { try { const s = await fs.stat(p); if (s.isDirectory()) return p; } catch {} }
  throw new Error("DATA_DIR not found");
}

// ---------------- Graph helpers ----------------
function requireAppReg() {
  const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = process.env;
  if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET) {
    const missing = ['AZURE_TENANT_ID','AZURE_CLIENT_ID','AZURE_CLIENT_SECRET'].filter(k=>!process.env[k]);
    const err = new Error(`Missing App Registration env: ${missing.join(', ')}`);
    err.code = 'NO_APP_REG';
    throw err;
  }
  return new ClientSecretCredential(AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET);
}
async function withTimeout(promiseFactory, ms, label='op'){
  const ac = new AbortController(); const t=setTimeout(()=>ac.abort(`${label}-timeout`), ms);
  try { return await promiseFactory(ac.signal); } finally { clearTimeout(t); }
}
async function getToken() {
  const cred = requireAppReg();
  const t = await withTimeout(sig=> cred.getToken(GRAPH_SCOPE, { abortSignal: sig }), TIMEOUT_MS, 'token');
  if (!t?.token) throw new Error('No Graph token');
  return t.token;
}
async function g(url, token, label){
  return withTimeout(async (signal)=>{
    const r = await fetch(url, { signal, headers:{ Authorization:`Bearer ${token}`, ConsistencyLevel:'eventual' }});
    if (!r.ok) throw new Error(`Graph ${r.status}`);
    return r.json();
  }, TIMEOUT_MS, label);
}

function mapUser(u) {
  // why: include UPN for downstream systems that key on UPN/email
  return {
    id: u.id,
    name: u.displayName || u.userPrincipalName || "(no name)",
    upn: u.userPrincipalName || null,
    title: u.jobTitle || "Unknown",
    department: u.department || "Unknown"
  };
}

async function fetchGroupUsers(groupId, token) {
  const items = [];
  let url = `https://graph.microsoft.com/v1.0/groups/${groupId}/transitiveMembers/microsoft.graph.user` +
            `?$select=id,displayName,jobTitle,department,userPrincipalName&$top=999`;
  while (url) {
    const page = await g(url, token, 'members-page');
    const users = Array.isArray(page?.value) ? page.value.map(mapUser) : [];
    items.push(...users);
    url = page?.['@odata.nextLink'] || null;
  }
  items.sort((a,b)=> a.name.localeCompare(b.name, undefined, {sensitivity:'base'}));
  return items;
}

let cache = { at: 0, managers: [] };
const CACHE_MS = 5 * 60 * 1000;
async function getManagers() {
  const gid = process.env.MANAGERS_GROUP_ID;
  if (!gid) throw new Error('MANAGERS_GROUP_ID missing');
  const now = Date.now();
  if (now - cache.at < CACHE_MS && cache.managers.length) return cache.managers;
  const token = await getToken();
  const managers = await fetchGroupUsers(gid, token);
  cache = { at: now, managers };
  return managers;
}

// ---------------- Function entry ----------------
module.exports = async function (context, req) {
  if (req.method === "OPTIONS") { context.res = { status: 204, headers: corsHeaders(req) }; return; }

  const p = getPrincipal(req);
  const bypassLocal = process.env.ALLOW_ANON_LOCAL === "true" && (process.env.FUNCTIONS_CORE_TOOLS_ENVIRONMENT === "Development");
  if (!isAdmin(p) && !bypassLocal) { context.res = { status: 403, headers: corsHeaders(req), body: { ok: false } }; return; }

  try {
    const dataDir = await resolveDataDir(__dirname);
    const [deps, bus] = await Promise.all([
      fs.readFile(path.join(dataDir, "departments.json"), "utf8"),
      fs.readFile(path.join(dataDir, "business-units.json"), "utf8")
    ]);

    let managers = [];
    try { managers = await getManagers(); } catch { managers = []; }

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(req) },
      body: {
        ok: true,
        departments: JSON.parse(deps),
        businessUnits: JSON.parse(bus),
        managers
      }
    };
  } catch {
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(req) },
      body: { ok: false, error: "Failed to load lists" }
    };
  }
};
