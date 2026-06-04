const { TableClient } = require("@azure/data-tables");

const getConn = () => process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage || "";
const getTableName = () => process.env.AZURE_STATUS_TABLE_NAME || "employeestatus";
const getUpdateKey = () => process.env.STATUS_UPDATE_KEY || "";
const PARTITION_KEY = "employee-entries";

// Valid terminal and in-progress status values. Stage names starting with
// "stage_" are also accepted to allow arbitrary runbook-defined stage names.
const VALID_STATUSES = new Set(["queued", "processing", "provisioned", "failed"]);
const isValidStatus = s => VALID_STATUSES.has(s) || /^stage_[a-z0-9_]+$/.test(s);

module.exports = async function (context, req) {
  const origin = req.headers?.origin || "*";
  const cors = {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,x-update-key",
  };

  if (req.method === "OPTIONS") { context.res = { status: 204, headers: cors }; return; }

  // Shared-secret auth for Logic App / runbook callers.
  const expectedKey = getUpdateKey();
  const providedKey = req.headers["x-update-key"] || "";
  if (!expectedKey || providedKey !== expectedKey) {
    context.res = { status: 403, headers: cors, body: { ok: false, error: "Unauthorized" } };
    return;
  }

  const { id, status, stageName, stageNumber, totalStages, statusMessage } = req.body || {};

  if (!id || typeof id !== "string") {
    context.res = { status: 400, headers: cors, body: { ok: false, error: "id required" } };
    return;
  }
  if (!status || !isValidStatus(status)) {
    context.res = { status: 400, headers: cors, body: { ok: false, error: "Invalid status value" } };
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

    const entity = {
      partitionKey: PARTITION_KEY,
      rowKey: id,
      status,
      stageName: stageName || null,
      stageNumber: stageNumber != null ? Number(stageNumber) : null,
      totalStages: totalStages != null ? Number(totalStages) : null,
      failedStage: status === "failed" ? (stageName || null) : null,
      statusMessage: statusMessage || null,
      updatedAt: new Date().toISOString(),
    };

    await table.upsertEntity(entity, "Replace");

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
      body: { ok: true, id, status },
    };
  } catch (error) {
    context.log.error("Status update failed", error?.message);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
      body: { ok: false, error: "Status update failed" },
    };
  }
};
