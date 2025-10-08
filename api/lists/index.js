// Reads departments & business units from /data, managers from Entra ID (Graph) ONLY.
const path = require("node:path");
const fs = require("node:fs/promises");
const { DefaultAzureCredential, ClientSecretCredential } = require("@azure/identity");

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
  for (const p of candidates) {
    try { const s = await fs.stat(p); if (s.isDirectory()) return p; } catch {}
  }
  throw new Error("DATA_DIR not found");
}

// ---------------- Microsoft Graph (Managers) ----------------
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

function makeCredential() {
  const tid = process.env.AZURE_TENANT_ID;
  const cid = process.env.AZURE_CLIENT_ID;
  const secret = process.env.AZURE_CLIENT_SECRET;
  if (tid && cid && secret) return new ClientSecretCredential(tid, cid, secret);
  return new DefaultAzureCredential({ excludeInteractiveBrowserCredential: true });
}
async function getGraphToken(cred) {
  const t = await cred.getToken(GRAPH_SCOPE);
  if (!t?.token) throw new Error("Graph token missing");
  return t.token;
}
function escapeODataLiteral(s) { return String(s).replace(/'/g, "''"); }
async function graphGet(url, accessToken) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`Graph ${r.status}`);
  return r.json();
}

// Prefer exact ID; else try mailNickname; else displayName; else startswith(displayName)
async function resolveGroupId(accessToken) {
  if (process.env.MANAGERS_GROUP_ID) return process.env.MANAGERS_GROUP_ID;

  const nickname = process.env.MANAGERS_GROUP_NICKNAME || "dyn-user-e5s";
  const name = process.env.MANAGERS_GROUP_NAME || "dyn-user-e5s";

  // 1) mailNickname eq 'dyn-user-e5s'
  const q1 = encodeURI(`$filter=mailNickname eq '${escapeODataLiteral(nickname)}'&$select=id,displayName&$top=1`);
  let data = await graphGet(`https://graph.microsoft.com/v1.0/groups?${q1}`, accessToken);
  if (data?.value?.[0]?.id) return data.value[0].id;

  // 2) displayName eq '<name>'
  const q2 = encodeURI(`$filter=displayName eq '${escapeODataLiteral(name)}'&$select=id,displayName&$top=1`);
  data = await graphGet(`https://graph.microsoft.com/v1.0/groups?${q2}`, accessToken);
  if (data?.value?.[0]?.id) return data.value[0].id;

  // 3) startswith(displayName,'<name>')
  const q3 = encodeURI(`$filter=startswith(displayName,'${escapeODataLiteral(name)}')&$select=id,displayName&$top=1`);
  data = await graphGet(`https://graph.microsoft.com/v1.0/groups?${q3}`, accessToken);
  const id = data?.value?.[0]?.id;
  if (!id) throw new Error("Group not found");
  return id;
}

function mapUser(u) {
  return {
    id: u.id,
    name: u.displayName || u.userPrincipalName || "(no name)",
    title: u.jobTitle || "Unknown",
    department: u.department || "Unknown"
  };
}

// Use transitive members to resolve nested groups; users-only cast
async function fetchGroupUsers(groupId, accessToken) {
  const items = [];
  let url = `https://graph.microsoft.com/v1.0/groups/${groupId}/transitiveMembers/microsoft.graph.user` +
            `?$select=id,displayName,jobTitle,department,userPrincipalName&$top=999`;
  while (url) {
    const page = await graphGet(url, accessToken);
    const users = Array.isArray(page?.value) ? page.value.map(mapUser) : [];
    items.push(...users);
    url = page?.['@odata.nextLink'] || null;
  }
  items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return items;
}

// 5-min in-memory cache
let cache = { at: 0, managers: [] };
const CACHE_MS = 5 * 60 * 1000;
async function getManagers() {
  const now = Date.now();
  if (now - cache.at < CACHE_MS && cache.managers.length) return cache.managers;
  const cred = makeCredential();
  const token = await getGraphToken(cred);
  const gid = await resolveGroupId(token);
  const managers = await fetchGroupUsers(gid, token);
  cache = { at: now, managers };
  return managers;
}

// ---------------- Function entry ----------------
module.exports = async function (context, req) {
  if (req.method === "OPTIONS") {
    context.res = { status: 204, headers: corsHeaders(req) };
    return;
  }

  const p = getPrincipal(req);
  const bypassLocal = process.env.ALLOW_ANON_LOCAL === "true" && (process.env.FUNCTIONS_CORE_TOOLS_ENVIRONMENT === "Development");
  if (!isAdmin(p) && !bypassLocal) {
    context.res = { status: 403, headers: corsHeaders(req), body: { ok: false } };
    return;
  }

  try {
    const dataDir = await resolveDataDir(__dirname);
    const [deps, bus] = await Promise.all([
      fs.readFile(path.join(dataDir, "departments.json"), "utf8"),
      fs.readFile(path.join(dataDir, "business-units.json"), "utf8")
    ]);

    let managers = [];
    try { managers = await getManagers(); } catch { managers = []; } // no file fallback

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
