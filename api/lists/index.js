// /api/lists/index.js
// Reads departments/business units/managers from the deployed "data" folder.
// Why: In Azure Functions (SWA), CWD is /home/site/wwwroot; __dirname is /home/site/wwwroot/<function>

const path = require("node:path");
const fs = require("node:fs/promises");

// --- auth helpers (defense-in-depth)
function getPrincipal(req) {
  try {
    const raw = req.headers["x-ms-client-principal"];
    if (!raw) return null;
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch { return null; }
}
function isAdmin(p) {
  // case-insensitive match; SWA roles are case-insensitive
  return Array.isArray(p?.userRoles) && p.userRoles
    .map(r => String(r).trim().toLowerCase())
    .includes("it_admin");
}

// --- data-dir resolution
async function resolveDataDir(currentDir) {
  // Prefer explicit env for flexibility
  const candidates = [
    process.env.DATA_DIR && path.resolve(process.env.DATA_DIR),
    path.join(process.cwd(), "data"),        // Azure Functions CWD: /home/site/wwwroot
    path.join(currentDir, "..", "data")      // fallback: one level up from function folder
    // NOTE: intentionally NOT using "../../data" (points to /home/site/data in prod)
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      const stat = await fs.stat(p);
      if (stat.isDirectory()) return p;
    } catch { /* try next */ }
  }
  throw new Error("DATA_DIR not found");
}

const corsHeaders = (req) => {
  const origin = req.headers?.origin || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
};

module.exports = async function (context, req) {
  if (req.method === "OPTIONS") {
    context.res = { status: 204, headers: corsHeaders(req) };
    return;
  }

  // AuthZ: allow only it_admin (unless explicitly bypassing for local dev)
  const p = getPrincipal(req);
  const bypassLocal = process.env.ALLOW_ANON_LOCAL === "true" && (process.env.FUNCTIONS_CORE_TOOLS_ENVIRONMENT === "Development");
  if (!isAdmin(p) && !bypassLocal) {
    context.res = { status: 403, headers: corsHeaders(req), body: { ok: false } };
    return;
  }

  try {
    const dataDir = await resolveDataDir(__dirname);
    const [deps, bus, mgrs] = await Promise.all([
      fs.readFile(path.join(dataDir, "departments.json"), "utf8"),
      fs.readFile(path.join(dataDir, "business-units.json"), "utf8"),
      fs.readFile(path.join(dataDir, "managers.json"), "utf8")
    ]);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(req) },
      body: {
        ok: true,
        departments: JSON.parse(deps),
        businessUnits: JSON.parse(bus),
        managers: JSON.parse(mgrs)
      }
    };
  } catch (err) {
    // minimal, user-facing error (no logs per your preference)
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(req) },
      body: { ok: false, error: "Failed to load lists" }
    };
  }
};
