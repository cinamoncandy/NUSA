"use strict";

// Dispatcher-side freshness gate for failure-repair dispatches (P1 flake fix).
//
// Root cause it addresses: a CI_FAILED observation is planned into a
// `gha:<run>:<head>:<conclusion>` repair dispatch, but by the time the worker
// verifies the cited run against GitHub, the run may have been retried to
// success (same run id, new attempt) or superseded by a newer run of the same
// workflow on the same head. The worker then correctly fails closed with
// CODING_RUNNER_FAILURE_EVIDENCE_INVALID — a failed consumer run for a repair
// nobody needs.
//
// A completed run's own conclusion is immutable, so the superseded case cannot
// be detected from the cited run alone: it stays `failure` forever and every
// later dispatch re-reads `run-still-failure`, producing an unbounded repair
// loop for a workflow that already recovered. The gate therefore also accepts
// the cited workflow's recent runs for the same head and suppresses the
// dispatch when a strictly newer run of that same workflow already succeeded.
//
// This gate re-checks the cited evidence fresh in the consume job and
// suppresses the doomed dispatch with NO_ACTION. Skip happens ONLY on positive
// proof the run no longer needs repair. Anything unverifiable proceeds to the
// worker, whose authoritative verification and fail-closed behavior are
// unchanged by this script.

const fs = require("node:fs");
const path = require("node:path");

// The Worker is authoritative about what counts as repair evidence, and it accepts exactly one
// conclusion (codingRunner.ts: `const allowedConclusions = failureRepair ? ["failure"] : ["success"]`).
// A cited `cancelled` or `timed_out` run is parsed by the reason regex but then always rejected with
// CODING_RUNNER_FAILURE_EVIDENCE_INVALID (409), so dispatching it can never succeed - it only burns a
// consumer run per attempt. A cancellation is the absence of a verdict, not a negative one, which is
// the same rule the Cloudflare deploy gate already applies to exact-head CI.
const REPAIRABLE_CONCLUSIONS = new Set(["failure"]);
// Terminal conclusions that look failure-shaped to the planner but carry no repairable verdict.
const UNREPAIRABLE_FAILURE_SHAPED_CONCLUSIONS = new Set(["cancelled", "timed_out"]);

function isFailureRepairReason(reason) {
  return typeof reason === "string" && reason.includes("gha:");
}

function plainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function runOrdinal(run) {
  const number = Number(run.run_number);
  const attempt = Number(run.run_attempt);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  // run_attempt is optional; a missing attempt is treated as the first one.
  const normalizedAttempt = Number.isSafeInteger(attempt) && attempt > 0 ? attempt : 1;
  return { number, attempt: normalizedAttempt };
}

function isStrictlyNewer(candidate, cited) {
  if (candidate.number !== cited.number) return candidate.number > cited.number;
  return candidate.attempt > cited.attempt;
}

// Positive proof only: a strictly newer run of the SAME workflow on the SAME
// head that completed successfully means the cited failure is already
// remediated. Anything that cannot be fully verified is ignored here, leaving
// the default repair path (and the worker's own verification) untouched.
function supersedingSuccess(citedRun, successorRuns) {
  if (!Array.isArray(successorRuns)) return null;
  const cited = plainObject(citedRun);
  if (cited == null) return null;
  const citedOrdinal = runOrdinal(cited);
  const citedWorkflowId = cited.workflow_id;
  const citedHead = typeof cited.head_sha === "string" ? cited.head_sha.toLowerCase() : null;
  if (citedOrdinal == null || citedHead == null || !Number.isSafeInteger(Number(citedWorkflowId))) return null;

  for (const entry of successorRuns) {
    const candidate = plainObject(entry);
    if (candidate == null) continue;
    if (Number(candidate.workflow_id) !== Number(citedWorkflowId)) continue;
    if (typeof candidate.head_sha !== "string" || candidate.head_sha.toLowerCase() !== citedHead) continue;
    if (candidate.status !== "completed" || candidate.conclusion !== "success") continue;
    const candidateOrdinal = runOrdinal(candidate);
    if (candidateOrdinal == null || !isStrictlyNewer(candidateOrdinal, citedOrdinal)) continue;
    const id = Number.isSafeInteger(Number(candidate.id)) ? Number(candidate.id) : null;
    return { id, runNumber: candidateOrdinal.number, runAttempt: candidateOrdinal.attempt };
  }
  return null;
}

function citedRunNeedsRepair(reason, run, successorRuns) {
  if (!isFailureRepairReason(reason)) return { repair: true, reason: "non-repair-dispatch" };
  if (plainObject(run) == null) {
    return { repair: true, reason: "run-unverifiable" };
  }
  if (run.status !== "completed" || typeof run.conclusion !== "string") {
    return { repair: true, reason: "run-unverifiable" };
  }
  if (REPAIRABLE_CONCLUSIONS.has(run.conclusion)) {
    const superseded = supersedingSuccess(run, successorRuns);
    if (superseded != null) {
      return {
        repair: false,
        reason: `superseded-by-success:${superseded.id ?? superseded.runNumber}`,
        supersededBy: superseded,
      };
    }
    return { repair: true, reason: `run-still-${run.conclusion}` };
  }
  if (UNREPAIRABLE_FAILURE_SHAPED_CONCLUSIONS.has(run.conclusion)) {
    return { repair: false, reason: `run-not-repairable:${run.conclusion}` };
  }
  return { repair: false, reason: `run-no-longer-failed:${run.conclusion}` };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--reason") out.reason = argv[++i];
    else if (argv[i] === "--run") out.run = argv[++i];
    else if (argv[i] === "--out") out.out = argv[++i];
    else if (argv[i] === "--successors") out.successors = argv[++i];
    else throw new Error(`UNKNOWN_ARG:${argv[i]}`);
  }
  if (out.reason == null || out.run == null || out.out == null) {
    throw new Error("USAGE: verify-dispatch-run-freshness.js --reason <r> --run <run.json> --out <decision.json> [--successors <runs.json>]");
  }
  return out;
}

// An unreadable/malformed successor listing must never be treated as proof of
// anything: it degrades to the pre-existing behavior instead of failing the job.
function readSuccessorRuns(file) {
  if (file == null) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) return parsed;
  const wrapped = plainObject(parsed);
  return wrapped != null && Array.isArray(wrapped.workflow_runs) ? wrapped.workflow_runs : null;
}

function main(argv) {
  const args = parseArgs(argv);
  const run = JSON.parse(fs.readFileSync(args.run, "utf8"));
  const successorRuns = readSuccessorRuns(args.successors);
  const decision = citedRunNeedsRepair(args.reason, run, successorRuns);
  const record = Object.freeze({
    repair: decision.repair,
    reason: decision.reason,
    runConclusion: plainObject(run) != null ? run.conclusion ?? null : null,
    runStatus: plainObject(run) != null ? run.status ?? null : null,
    supersededBy: decision.supersededBy ?? null,
    checkedAt: new Date().toISOString(),
  });
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(record, null, 2)}\n`);
  // First stdout line is machine-readable for $GITHUB_OUTPUT.
  process.stdout.write(`repair=${decision.repair}\n`);
  console.error(`dispatch-freshness: repair=${decision.repair} (${decision.reason})`);
}

module.exports = { REPAIRABLE_CONCLUSIONS, UNREPAIRABLE_FAILURE_SHAPED_CONCLUSIONS, isFailureRepairReason, citedRunNeedsRepair, supersedingSuccess };

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`verify-dispatch-run-freshness: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
