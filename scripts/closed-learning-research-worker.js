"use strict";

const path = require("node:path");

const SHA64 = /^[0-9a-f]{64}$/;
const FORBIDDEN_KEY = /(authorization|bearer|token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|cookie|jwt|credential)/i;

function rejectForbidden(value, seen = new Set()) {
  if (value == null || typeof value !== "object") return;
  if (seen.has(value)) throw new Error("closed-learning worker request must be acyclic");
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error("closed-learning worker request contains a forbidden field");
    rejectForbidden(child, seen);
  }
  seen.delete(value);
}

function validateRequest(request) {
  rejectForbidden(request);
  if (request == null || typeof request !== "object" || Array.isArray(request)) throw new Error("closed-learning worker request is invalid");
  if (request.schemaVersion !== 1 || request.operation !== "REPLAY_PAPER_EVIDENCE") throw new Error("closed-learning worker operation is unsupported");
  const fingerprint = String(request.originalRunFingerprintSha256 || "").trim().toLowerCase();
  if (!SHA64.test(fingerprint)) throw new Error("closed-learning worker run fingerprint is invalid");
  const evidence = request.paperEvidenceByCandidate;
  if (evidence == null || typeof evidence !== "object" || Array.isArray(evidence)) throw new Error("closed-learning worker PAPER evidence map is invalid");
  for (const [candidateId, item] of Object.entries(evidence)) {
    if (!candidateId.trim() || candidateId.length > 240) throw new Error("closed-learning worker candidate identity is invalid");
    if (item == null || typeof item !== "object" || Array.isArray(item)) throw new Error("closed-learning worker candidate evidence is invalid");
  }
  return Object.freeze({ schemaVersion: 1, operation: "REPLAY_PAPER_EVIDENCE", originalRunFingerprintSha256: fingerprint, paperEvidenceByCandidate: evidence });
}

function snapshotPathFromEnv(env) {
  const value = String(env.NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH || "").trim();
  if (!value || value === ":memory:" || !path.isAbsolute(value)) throw new Error("NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH must be an absolute durable path");
  return value;
}

function defaultDependencies() {
  const { FileResearchRunReplaySnapshotStore } = require("../dist/apps/desktop/src/cloud/researchRunReplaySnapshotStore.js");
  const { replayResearchRunWithPaperEvidence } = require("../dist/apps/desktop/src/cloud/researchRunReplaySnapshot.js");
  return { FileResearchRunReplaySnapshotStore, replayResearchRunWithPaperEvidence };
}

function executeRequest(requestValue, env = process.env, dependencies = defaultDependencies()) {
  const request = validateRequest(requestValue);
  const store = new dependencies.FileResearchRunReplaySnapshotStore(snapshotPathFromEnv(env));
  const snapshot = store.read(request.originalRunFingerprintSha256);
  if (snapshot == null) throw new Error("closed-learning worker original Research snapshot is unavailable");
  const replay = dependencies.replayResearchRunWithPaperEvidence(snapshot, request.paperEvidenceByCandidate);
  if (replay == null || replay.qualification == null || replay.run == null) throw new Error("closed-learning worker replay result is invalid");
  const qualification = replay.qualification;
  if (qualification.liveAuthority !== "NONE" || qualification.productionMutationAllowed !== false || qualification.aiAuthority !== "ZERO_AUTHORITY") {
    throw new Error("closed-learning worker authority invariant violated");
  }
  return Object.freeze({
    schemaVersion: 1,
    operation: "REPLAY_PAPER_EVIDENCE",
    originalRunFingerprintSha256: request.originalRunFingerprintSha256,
    replayRunFingerprintSha256: replay.run.provenance.runFingerprintSha256,
    qualification,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { body += chunk; if (Buffer.byteLength(body, "utf8") > 8 * 1024 * 1024) reject(new Error("closed-learning worker request is too large")); });
    process.stdin.on("end", () => resolve(body));
    process.stdin.on("error", reject);
  });
}

async function main() {
  const body = await readStdin();
  let request;
  try { request = JSON.parse(body); }
  catch { throw new Error("closed-learning worker request is not valid JSON"); }
  process.stdout.write(`${JSON.stringify(executeRequest(request))}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`closed-learning research worker failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { executeRequest, snapshotPathFromEnv, validateRequest };
