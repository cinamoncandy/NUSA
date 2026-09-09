const { readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { canonical, sha256 } = require("./actual-paper-runtime-e2e.js");

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function runtimeSnapshots(evidence) {
  return [
    evidence?.first_runtime,
    evidence?.restart_recovery,
    evidence?.automatic_restart,
    evidence?.supervisor?.first_cycle,
    evidence?.supervisor?.second_cycle,
    evidence?.supervisor?.recovered,
  ].filter((snapshot) => snapshot != null && typeof snapshot === "object");
}

function snapshotOrderCount(snapshot) {
  return Math.max(
    safeCount(snapshot?.orderCount),
    safeCount(snapshot?.heartbeat?.paperOrderCount),
  );
}

function snapshotFillCount(snapshot) {
  return Math.max(
    safeCount(snapshot?.fillCount),
    safeCount(snapshot?.heartbeat?.paperFillCount),
  );
}

function snapshotAccountChanged(snapshot) {
  const positionQuantity = Number(snapshot?.position?.quantity || 0);
  return Number(snapshot?.realizedPnl || 0) !== 0
    || Number(snapshot?.unrealizedPnl || 0) !== 0
    || (Number.isFinite(positionQuantity) && positionQuantity !== 0);
}

function classify(evidence) {
  if (evidence == null || typeof evidence !== "object") throw new Error("actual PAPER evidence must be an object");
  const execution = evidence.execution || {};
  const snapshots = runtimeSnapshots(evidence);
  const executionOrderCount = Number.isSafeInteger(execution.order_count)
    ? safeCount(execution.order_count)
    : execution.order_id ? 1 : 0;
  const executionFillCount = Number.isSafeInteger(execution.fill_count)
    ? safeCount(execution.fill_count)
    : execution.fill_id ? 1 : 0;
  const orderCount = Math.max(executionOrderCount, ...snapshots.map(snapshotOrderCount), 0);
  const fillCount = Math.max(executionFillCount, ...snapshots.map(snapshotFillCount), 0);
  const accountChanged = snapshots.some(snapshotAccountChanged);
  const smokePassed = evidence.result === "PASS"
    && evidence?.authority?.liveAuthority === "NONE"
    && evidence?.authority?.productionMutationAllowed === false
    && evidence?.prohibited_capabilities?.real_money_mutation === false;
  const automaticExecutionObserved = orderCount > 0 && fillCount > 0;
  const certified = smokePassed && automaticExecutionObserved && accountChanged;
  const completionStatus = certified
    ? "COMPLETE_AUTONOMOUS_EXECUTION_OBSERVED"
    : "INCOMPLETE_NO_AUTONOMOUS_ORDER_FILL_PNL";
  return {
    ...evidence,
    result: certified ? "PASS" : "INCOMPLETE",
    runtime_safety_smoke: {
      status: smokePassed ? "PASS" : "FAIL",
      public_market_runtime_observed: evidence?.market_data?.channel === "PUBLIC_TICKER",
      restart_recovery_observed: evidence?.supervisor?.restart_count > 0,
      live_authority: evidence?.authority?.liveAuthority ?? null,
      production_mutation_allowed: evidence?.authority?.productionMutationAllowed ?? null,
    },
    autonomous_trading_certification: {
      status: completionStatus,
      automatic_order_observed: orderCount > 0,
      automatic_fill_observed: fillCount > 0,
      account_or_pnl_change_observed: accountChanged,
    },
    production_readiness: {
      status: completionStatus,
      runtime_safety_smoke_passed: smokePassed,
      automatic_order_observed: orderCount > 0,
      automatic_fill_observed: fillCount > 0,
      account_or_pnl_change_observed: accountChanged,
      live_mutation_observed: evidence?.prohibited_capabilities?.real_money_mutation === true,
      completion_claim_allowed: certified,
    },
  };
}

function rewrite(path) {
  const absolute = resolve(path);
  const parsed = JSON.parse(readFileSync(absolute, "utf8"));
  const { artifact_hash: _ignored, ...withoutHash } = parsed;
  const classified = classify(withoutHash);
  const output = {
    ...classified,
    artifact_hash: { algorithm: "sha256", value: sha256(canonical(classified)) },
  };
  writeFileSync(absolute, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return output;
}

if (require.main === module) {
  const path = process.argv[2];
  if (!path) throw new Error("usage: node scripts/classify-actual-paper-runtime-readiness.js <evidence.json>");
  const evidence = rewrite(path);
  process.stdout.write(`${JSON.stringify({ result: evidence.result, runtime_safety_smoke: evidence.runtime_safety_smoke, autonomous_trading_certification: evidence.autonomous_trading_certification, production_readiness: evidence.production_readiness })}\n`);
}

module.exports = { classify, rewrite, runtimeSnapshots, snapshotAccountChanged, snapshotFillCount, snapshotOrderCount };
