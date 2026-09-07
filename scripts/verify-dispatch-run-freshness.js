"use strict";

// Dispatcher-side freshness gate for failure-repair dispatches (P1 flake fix).
//
// Root cause it addresses: a CI_FAILED observation is planned into a
// `gha:<run>:<head>:<conclusion>` repair dispatch, but by the time the worker
// verifies the cited run against GitHub, the run may have been retried to
// success (same run id, new attempt) or superseded. The worker then correctly
// fails closed with CODING_RUNNER_FAILURE_EVIDENCE_INVALID — a failed
// consumer run for a repair nobody needs (observed twice, 1s apart).
//
// This gate re-checks the cited run fresh in the consume job and suppresses
// the doomed dispatch with NO_ACTION. Skip happens ONLY on positive proof
// the run no longer needs repair. Anything unverifiable proceeds to the
// worker, whose authoritative verification and fail-closed behavior are
// unchanged by this script.

const fs = require("node:fs");
const path = require("node:path");

const REPAIRABLE_CONCLUSIONS = new Set(["failure", "cancelled", "timed_out"]);

function isFailureRepairReason(reason) {
  return typeof reason === "string" && reason.includes("gha:");
}

function citedRunNeedsRepair(reason, run) {
  if (!isFailureRepairReason(reason)) return { repair: true, reason: "non-repair-dispatch" };
  if (run == null || typeof run !== "object" || Array.isArray(run)) {
    return { repair: true, reason: "run-unverifiable" };
  }
  if (run.status !== "completed" || typeof run.conclusion !== "string") {
    return { repair: true, reason: "run-unverifiable" };
  }
  if (REPAIRABLE_CONCLUSIONS.has(run.conclusion)) {
    return { repair: true, reason: `run-still-${run.conclusion}` };
  }
  return { repair: false, reason: `run-no-longer-failed:${run.conclusion}` };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--reason") out.reason = argv[++i];
    else if (argv[i] === "--run") out.run = argv[++i];
    else if (argv[i] === "--out") out.out = argv[++i];
    else throw new Error(`UNKNOWN_ARG:${argv[i]}`);
  }
  if (out.reason == null || out.run == null || out.out == null) {
    throw new Error("USAGE: verify-dispatch-run-freshness.js --reason <r> --run <run.json> --out <decision.json>");
  }
  return out;
}

function main(argv) {
  const args = parseArgs(argv);
  const run = JSON.parse(fs.readFileSync(args.run, "utf8"));
  const decision = citedRunNeedsRepair(args.reason, run);
  const record = Object.freeze({
    repair: decision.repair,
    reason: decision.reason,
    runConclusion: run != null && typeof run === "object" ? run.conclusion ?? null : null,
    runStatus: run != null && typeof run === "object" ? run.status ?? null : null,
    checkedAt: new Date().toISOString(),
  });
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(record, null, 2)}\n`);
  // First stdout line is machine-readable for $GITHUB_OUTPUT.
  process.stdout.write(`repair=${decision.repair}\n`);
  console.error(`dispatch-freshness: repair=${decision.repair} (${decision.reason})`);
}

module.exports = { REPAIRABLE_CONCLUSIONS, isFailureRepairReason, citedRunNeedsRepair };

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`verify-dispatch-run-freshness: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
