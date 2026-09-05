const { readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { canonical, sha256 } = require("./actual-paper-runtime-e2e.js");

function classify(evidence) {
  if (evidence == null || typeof evidence !== "object") throw new Error("actual PAPER evidence must be an object");
  const execution = evidence.execution || {};
  const firstRuntime = evidence.first_runtime || {};
  const orderCount = Number.isSafeInteger(firstRuntime.orderCount)
    ? firstRuntime.orderCount
    : Number.isSafeInteger(execution.order_count) ? execution.order_count : execution.order_id ? 1 : 0;
  const fillCount = Number.isSafeInteger(execution.fill_count)
    ? execution.fill_count
    : execution.fill_id ? 1 : 0;
  const accountChanged = Number(firstRuntime.realizedPnl || 0) !== 0 || Number(firstRuntime.unrealizedPnl || 0) !== 0 || firstRuntime.position != null;
  const automaticExecutionObserved = orderCount > 0 && fillCount > 0;
  const completionStatus = automaticExecutionObserved && accountChanged
    ? "COMPLETE_AUTONOMOUS_EXECUTION_OBSERVED"
    : "INCOMPLETE_NO_AUTONOMOUS_ORDER_FILL_PNL";
  return {
    ...evidence,
    result: automaticExecutionObserved && accountChanged ? "PASS" : "INCOMPLETE",
    production_readiness: {
      status: completionStatus,
      automatic_order_observed: orderCount > 0,
      automatic_fill_observed: fillCount > 0,
      account_or_pnl_change_observed: accountChanged,
      live_mutation_observed: evidence?.prohibited_capabilities?.real_money_mutation === true,
      completion_claim_allowed: automaticExecutionObserved && accountChanged && evidence?.prohibited_capabilities?.real_money_mutation === false,
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
  process.stdout.write(`${JSON.stringify({ result: evidence.result, production_readiness: evidence.production_readiness })}\n`);
}

module.exports = { classify, rewrite };
