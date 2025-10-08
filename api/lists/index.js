// /api/lists/index.js
// Reads departments & business units from /data, managers from Entra ID group (Microsoft Graph)
const path = require("node:path");
const fs = require("node:fs/promises");
const { DefaultAzureCredential, ClientSecretCredential } = require("@azure/identity");

// --- auth helpers (defense-in-depth)
function getPrincipal(req) {
  try {
    const raw = req.headers["x-ms-client-principal"];
    if (!raw) return null;
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch { return null; }
}
function isAdmin(p) {
  const roles = Array.isArray(p?.userRoles) ? p.userRoles.map(r => String(r).trim().toLowerCase()) : [];
  return roles.includes("it_admin");
}

// --- CORS
const corsHeaders = (req) => {
  const origin = req.headers?.origin || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
};

// --- data-dir resolution
async function resolveDataDir(currentDir) {
  const candidates = [
    process.env.DATA_DIR && path.resolve(process.env.DATA_DIR),
    path.join(process.cwd(), "data"),        // Functions on Azure: /home/site/wwwroot/data
    path.join(currentDir, "..", "data")
  ].filter(Boolean);

  for (const p of candidates) {
    try { const stat = await fs.stat(p); if (stat.isDirectory()) return p; } catch {}
  }
  throw new Error("DATA_DIR not found");
}

// ---------------- Microsoft Graph (Managers) ----------------
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

function makeCredential() {
  const tid = process.env.AZURE_TENANT_ID;
  const cid = process.env.AZURE_CLIENT_ID;
  const secret = process.env.AZURE_CLIENT_SECRET;
  if (tid && cid && secret) {
    // App Registration (client credentials)
    return new ClientSecretCredential(tid, cid, secret);
  }
  // Managed Identity (recommended in Azure)
  return new DefaultAzureCredential({ excludeInteractiveBrowserCredential: true });
}

async function getGraphToken(credential) {
  const token = await credential.getToken(GRAPH_SCOPE);
  if (!token?.token) throw new Error("Graph token missing");
  return token.token;
}

function escapeODataLiteral(s) {
  return String(s).replace(/'/g, "''");
}

async function graphGet(url, accessToken) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) {
    // Hide details from client; throw to allow fallback/500
    throw new Error(`Graph ${r.status}`);
  }
  return r.json();
}

async function resolveGroupId(accessToken) {
  if (process.env.MANAGERS_GROUP_ID) return process.env.MANAGERS_GROUP_ID;
  const name = process.env.MANAGERS_GROUP_NAME || "dyn-user-e5s";
  const filter = encodeURI(`$filter=displayName eq '${escapeODataLiteral(name)}'&$select=id,displayName&$top=1`);
  const data = await graphGet(`https://graph.microsoft.com/v1.0/groups?${filter}`, accessToken);
  const id = data?.value?.[0]?.id;
  if (!id) throw new Error("Group not found");
  return id;
}

function isUser(obj) {
  const t = obj?.['@odata.type'] || "";
  return t.toLowerCase().includes("microsoft.graph.user") || !!obj?.userPrincipalName;
}

function mapUser(u) {
  return {
    id: u.id,
    name: u.displayName || u.userPrincipalName || "(no name)",
    title: u.jobTitle || "Unknown",
    department: u.department || "Unknown"
  };
}

async function fetchGroupUsers(groupId, accessToken) {
  const items = [];
  let url = `https://graph.microsoft.com/v1.0/groups/${groupId}/members?$select=id,displayName,jobTitle,department,userPrincipalName&$top=999`;
  while (url) {
    const page = await graphGet(url, accessToken);
    const pageUsers = Array.isArray(page?.value) ? page.value.filter(isUser).map(mapUser) : [];
    items.push(...pageUsers);
    url = page?.['@odata.nextLink'] || null;
  }
  // stable sort by name
  items.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return items;
}

// Simple warm-instance cache (5 min)
let cache = { at: 0, managers: [] };
const CACHE_MS = 5 * 60 * 1000;
async function getManagers() {
  const now = Date.now();
  if (now - cache.at < CACHE_MS && cache.managers.length) return cache.managers;
  const credential = makeCredential();
  const token = await getGraphToken(credential);
  const groupId = await resolveGroupId(token);
  const managers = await fetchGroupUsers(groupId, token);
  cache = { at: now, managers };
  return managers;
}

// ---------------- Function entry ----------------
module.exports = async function (context, req) {
  if (req.method === "OPTIONS") {
    context.res = { status: 204, headers: corsHeaders(req) };
    return;
  }

  // AuthZ: allow only it_admin (unless explicitly bypassed for local dev)
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

    // Live managers from Entra ID; fallback to file if Graph fails
    let managers;
    try {
      managers = await getManagers();
    } catch {
      // Optional fallback if you keep a file at /data/managers.json
      try {
        const raw = await fs.readFile(path.join(dataDir, "managers.json"), "utf8");
        managers = JSON.parse(raw);
      } catch {
        managers = [];
      }
    }

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
