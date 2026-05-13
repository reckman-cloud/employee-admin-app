const { TableClient } = require("@azure/data-tables");

const getConn = () => process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage || "";
const getTableName = () => process.env.AZURE_STATUS_TABLE_NAME || "employeestatus";
const PARTITION_KEY = "employee-entries";

function getPrincipal(req) {
  try {
    const raw = req.headers["x-ms-client-principal"];
    if (!raw) return null;
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch { return null; }
}
function isAdmin(p) { return Boolean(p?.userRoles?.includes("it_admin")); }

module.exports = async function (context, req) {
  const origin = req.headers?.origin || "*";
  const cors = {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") { context.res = { status: 204, headers: cors }; return; }

  const p = getPrincipal(req);
  const bypassLocal = process.env.ALLOW_ANON_LOCAL === "true" &&
    process.env.FUNCTIONS_CORE_TOOLS_ENVIRONMENT === "Development";
  if (!isAdmin(p) && !bypassLocal) {
    context.res = { status: 403, headers: cors, body: { ok: false } };
    return;
  }

  const idsParam = req.query?.ids || "";
  const ids = idsParam.split(",").map(s => s.trim()).filter(Boolean);
  if (!ids.length) {
    context.res = { status: 400, headers: cors, body: { ok: false, error: "No ids provided" } };
    return;
  }

  const conn = getConn();
  if (!conn) {
    context.res = { status: 503, headers: cors, body: { ok: false, error: "Storage not configured" } };
    return;
  }

  try {
    const table = TableClient.fromConnectionString(conn, getTableName());
    await table.createTable().catch(() => {});

    const results = {};
    await Promise.all(ids.map(async id => {
      try {
        const entity = await table.getEntity(PARTITION_KEY, id);
        results[id] = {
          status: entity.status,
          stageName: entity.stageName || null,
          stageNumber: entity.stageNumber != null ? Number(entity.stageNumber) : null,
          totalStages: entity.totalStages != null ? Number(entity.totalStages) : null,
          failedStage: entity.failedStage || null,
          statusMessage: entity.statusMessage || null,
          updatedAt: entity.updatedAt || null,
        };
      } catch {
        // Entity not yet written by downstream — entry is still queued
      }
    }));

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
      body: { ok: true, statuses: results },
    };
  } catch (error) {
    context.log.error("Status read failed", error?.message);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
      body: { ok: false, error: "Status read failed" },
    };
  }
};
