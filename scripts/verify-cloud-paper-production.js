"use strict";

const fs = require("node:fs");
const path = require("node:path");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const asInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

async function requestJson(baseUrl, pathname, token) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method: "GET",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${pathname} returned HTTP ${response.status}`);
  return response.json();
}

function assertSnapshot(snapshot, now) {
  if (snapshot.liveAuthority !== "NONE" || snapshot.productionMutationAllowed !== false) throw new Error("LIVE_AUTHORITY_INVARIANT_VIOLATED");
  if (snapshot.mode !== "PAPER") throw new Error(`production PAPER verifier observed mode=${snapshot.mode}`);
  const operations = snapshot.operations || {};
  const heartbeat = operations.heartbeat || {};
  if (operations.runtimeState !== "RUNNING") throw new Error(`runtime is not RUNNING (${operations.runtimeState})`);
  if (operations.schedulerRunning !== true || operations.schedulerMode !== "ACTIVE") throw new Error("autonomous PAPER scheduler is not ACTIVE");
  if (operations.transport !== "ONLINE") throw new Error("public market transport is not ONLINE");
  if (!operations.supervisor || operations.supervisor.managed !== true) throw new Error("production runtime is not under the canonical PAPER supervisor");
  if (operations.supervisor.liveAuthority !== "NONE" || operations.supervisor.productionMutationAllowed !== false || operations.supervisor.aiAuthority !== "ZERO_AUTHORITY") throw new Error("supervisor authority invariant violated");
  if (!Number.isSafeInteger(heartbeat.eventCount) || !Number.isSafeInteger(heartbeat.paperOrderCount) || !Number.isSafeInteger(heartbeat.paperFillCount)) throw new Error("runtime heartbeat counters unavailable");
  if (!Number.isFinite(heartbeat.lastHeartbeatAt) || now - heartbeat.lastHeartbeatAt > 15_000) throw new Error("runtime heartbeat stale");
  if (!Number.isFinite(heartbeat.lastMarketEventAt) || now - heartbeat.lastMarketEventAt > 60_000) throw new Error("market data stale");
  if (!Array.isArray(snapshot.markets) || snapshot.markets.length === 0) throw new Error("no production market observations");
  if (snapshot.portfolio == null) throw new Error("PAPER portfolio projection unavailable");
  if (!Array.isArray(snapshot.orders)) throw new Error("PAPER order projection unavailable");
  const ids = new Set();
  for (const order of snapshot.orders) {
    if (ids.has(`order:${order.id}`)) throw new Error(`duplicate PAPER order id ${order.id}`);
    ids.add(`order:${order.id}`);
    if (!Array.isArray(order.fills) || order.fills.length === 0) throw new Error(`filled PAPER order ${order.id} has no fills`);
    for (const fill of order.fills) {
      if (ids.has(`fill:${fill.id}`)) throw new Error(`duplicate PAPER fill id ${fill.id}`);
      ids.add(`fill:${fill.id}`);
    }
  }
  return {
    generatedAt: snapshot.generatedAt,
    eventCount: heartbeat.eventCount,
    decisionCount: heartbeat.decisionCount,
    paperOrderCount: heartbeat.paperOrderCount,
    paperFillCount: heartbeat.paperFillCount,
    lastMarketEventAt: heartbeat.lastMarketEventAt,
    lastHeartbeatAt: heartbeat.lastHeartbeatAt,
    restartCount: operations.supervisor.restartCount,
    orderProjectionCount: snapshot.orders.length,
    totalFee: snapshot.orders.reduce((sum, order) => sum + Number(order.fee || 0), 0),
    cash: snapshot.portfolio.account.cash,
    equity: snapshot.portfolio.account.equity,
    realizedPnl: snapshot.portfolio.account.realizedPnl ?? snapshot.portfolio.account.position.realizedPnl,
    unrealizedPnl: snapshot.portfolio.account.unrealizedPnl,
  };
}

async function run(env = process.env) {
  const baseUrl = env.NUSA_PRODUCTION_BASE_URL?.trim();
  const token = env.NUSA_CLOUD_DASHBOARD_TOKEN?.trim();
  if (!baseUrl) throw new Error("NUSA_PRODUCTION_BASE_URL is required");
  if (!baseUrl.startsWith("https://")) throw new Error("production verifier requires HTTPS");
  if (!token || Buffer.byteLength(token, "utf8") < 32) throw new Error("NUSA_CLOUD_DASHBOARD_TOKEN is required");
  const durationMs = asInt(env.NUSA_PRODUCTION_PROOF_DURATION_MS, 10 * 60_000);
  const pollMs = asInt(env.NUSA_PRODUCTION_PROOF_POLL_MS, 15_000);
  const output = env.NUSA_PRODUCTION_PROOF_OUTPUT?.trim() || "artifacts/operational-evidence/cloud-paper-production-proof.json";
  if (durationMs < 60_000) throw new Error("production proof duration must be at least 60000ms");

  const startedAt = Date.now();
  const samples = [];
  while (Date.now() - startedAt < durationMs || samples.length < 2) {
    const now = Date.now();
    const health = await requestJson(baseUrl, "/health");
    if (health.ok !== true) throw new Error("health endpoint failed");
    const readiness = await requestJson(baseUrl, "/ready", token);
    if (readiness.ok !== true) throw new Error("readiness endpoint failed");
    const snapshot = await requestJson(baseUrl, "/api/paper-operations", token);
    samples.push({ observedAt: now, ...assertSnapshot(snapshot, now) });
    if (Date.now() - startedAt >= durationMs && samples.length >= 2) break;
    await sleep(pollMs);
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const checks = {
    heartbeatProgressed: last.lastHeartbeatAt > first.lastHeartbeatAt,
    marketDataProgressed: last.eventCount > first.eventCount && last.lastMarketEventAt > first.lastMarketEventAt,
    decisionsProgressed: last.decisionCount >= first.decisionCount,
    autonomousPaperOrdersObserved: last.paperOrderCount > 0,
    autonomousPaperFillsObserved: last.paperFillCount > 0,
    feesObserved: last.totalFee > 0,
    durableSupervisorRecoveryObserved: last.restartCount > 0,
    noDuplicateProjectedOrderOrFillIds: true,
    liveMutationAuthorityAbsent: true,
  };
  const passed = Object.values(checks).every(Boolean);
  const receipt = {
    schemaVersion: 1,
    kind: "NUSA_CLOUD_AUTONOMOUS_PAPER_PRODUCTION_PROOF",
    sourceCommit: env.NUSA_SOURCE_COMMIT?.trim() || null,
    baseUrlOrigin: new URL(baseUrl).origin,
    startedAt,
    finishedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    sampleCount: samples.length,
    first,
    last,
    checks,
    passed,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
    note: "Read-only verifier. It never calls a PAPER order mutation endpoint.",
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (!passed) throw new Error(`production PAPER proof incomplete: ${Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name).join(", ")}`);
  return receipt;
}

if (require.main === module) run().catch((error) => { console.error(error instanceof Error ? error.stack || error.message : error); process.exitCode = 1; });
module.exports = { assertSnapshot, requestJson, run };
