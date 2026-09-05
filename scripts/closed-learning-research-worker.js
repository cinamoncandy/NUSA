"use strict";

const path = require("node:path");

const SHA64 = /^[0-9a-f]{64}$/;
const MARKET = /^KRW-[A-Z0-9-]+$/;
const FORBIDDEN_KEY = /(authorization|bearer|token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|cookie|jwt|credential)/i;
const OPERATIONS = new Set(["REPLAY_PAPER_EVIDENCE", "REPLAY_CANONICAL_PAPER_EVIDENCE"]);

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
  if (request.schemaVersion !== 1 || !OPERATIONS.has(request.operation)) throw new Error("closed-learning worker operation is unsupported");
  const fingerprint = String(request.originalRunFingerprintSha256 || "").trim().toLowerCase();
  if (!SHA64.test(fingerprint)) throw new Error("closed-learning worker run fingerprint is invalid");
  if (request.operation === "REPLAY_PAPER_EVIDENCE") {
    const evidence = request.paperEvidenceByCandidate;
    if (evidence == null || typeof evidence !== "object" || Array.isArray(evidence)) throw new Error("closed-learning worker PAPER evidence map is invalid");
    for (const [candidateId, item] of Object.entries(evidence)) {
      if (!candidateId.trim() || candidateId.length > 240) throw new Error("closed-learning worker candidate identity is invalid");
      if (item == null || typeof item !== "object" || Array.isArray(item)) throw new Error("closed-learning worker candidate evidence is invalid");
    }
    return Object.freeze({ schemaVersion: 1, operation: request.operation, originalRunFingerprintSha256: fingerprint, paperEvidenceByCandidate: evidence });
  }
  if (!Array.isArray(request.persistedPaperPeriods) || request.persistedPaperPeriods.length === 0) throw new Error("closed-learning worker canonical PAPER periods are empty");
  if (request.paperAccount == null || typeof request.paperAccount !== "object" || Array.isArray(request.paperAccount)) throw new Error("closed-learning worker canonical PAPER account is invalid");
  if (request.executionQualityPolicy == null || typeof request.executionQualityPolicy !== "object" || Array.isArray(request.executionQualityPolicy)) throw new Error("closed-learning worker execution quality policy is invalid");
  return Object.freeze({
    schemaVersion: 1,
    operation: request.operation,
    originalRunFingerprintSha256: fingerprint,
    persistedPaperPeriods: request.persistedPaperPeriods,
    paperAccount: request.paperAccount,
    executionQualityPolicy: request.executionQualityPolicy,
  });
}

function snapshotPathFromEnv(env) {
  const value = String(env.NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH || "").trim();
  if (!value || value === ":memory:" || !path.isAbsolute(value)) throw new Error("NUSA_RESEARCH_REPLAY_SNAPSHOT_PATH must be an absolute durable path");
  return value;
}

function defaultDependencies() {
  const { FileResearchRunReplaySnapshotStore } = require("../dist/apps/desktop/src/cloud/researchRunReplaySnapshotStore.js");
  const { replayResearchRunWithPaperEvidence } = require("../dist/apps/desktop/src/cloud/researchRunReplaySnapshot.js");
  const { adaptPersistedPaperForwardEvidence } = require("../dist/apps/desktop/src/cloud/persistedPaperForwardEvidenceAdapter.js");
  const { buildCanonicalPaperCandidatePerformance } = require("../dist/apps/cloud/src/canonicalPaperCandidatePerformance.js");
  return { FileResearchRunReplaySnapshotStore, replayResearchRunWithPaperEvidence, adaptPersistedPaperForwardEvidence, buildCanonicalPaperCandidatePerformance };
}

function canonicalEvidence(request, snapshot, dependencies) {
  const adapted = dependencies.adaptPersistedPaperForwardEvidence(request.persistedPaperPeriods);
  const snapshotIds = new Set(snapshot.candidates.map((candidate) => String(candidate.id || "").trim()));
  const unmatchedPaperCandidateIds = adapted.candidates.map((candidate) => candidate.candidateId).filter((candidateId) => !snapshotIds.has(candidateId)).sort();
  if (unmatchedPaperCandidateIds.length > 0) throw new Error("closed-learning worker PAPER evidence does not belong to the original Research snapshot");
  const paperEvidenceByCandidate = {};
  const matchedCandidateIds = [];
  const awaitingPerformanceCandidateIds = [];
  for (const candidate of adapted.candidates) {
    const paperPerformance = dependencies.buildCanonicalPaperCandidatePerformance({
      candidateId: candidate.candidateId,
      periods: candidate.periods,
      account: request.paperAccount,
      executionQualityPolicy: request.executionQualityPolicy,
    });
    if (paperPerformance == null) {
      awaitingPerformanceCandidateIds.push(candidate.candidateId);
      continue;
    }
    paperEvidenceByCandidate[candidate.candidateId] = Object.freeze({ admission: candidate.admission, paperPerformance });
    matchedCandidateIds.push(candidate.candidateId);
  }
  return Object.freeze({
    paperEvidenceByCandidate: Object.freeze(paperEvidenceByCandidate),
    matchedCandidateIds: Object.freeze(matchedCandidateIds.sort()),
    awaitingPerformanceCandidateIds: Object.freeze(awaitingPerformanceCandidateIds.sort()),
    orderedRecordIds: Object.freeze([...adapted.orderedRecordIds]),
  });
}

function deploymentProjection(run, qualification, preparation, originalRunFingerprintSha256) {
  if (preparation == null) return Object.freeze({ deploymentBlockedReason: "CANONICAL_PAPER_PREPARATION_REQUIRED" });
  const qualified = qualification.candidates.filter((candidate) => candidate.outcome === "QUALIFIED_FOR_LEAGUE");
  if (qualified.length === 0) return Object.freeze({ deploymentBlockedReason: "NO_QUALIFIED_CANDIDATE" });
  if (qualified.length > 1) return Object.freeze({ deploymentBlockedReason: "MULTIPLE_QUALIFIED_CANDIDATES" });
  const candidateId = qualified[0].candidateId;
  if (preparation.awaitingPerformanceCandidateIds.includes(candidateId)) return Object.freeze({ deploymentBlockedReason: "CANONICAL_PAPER_PERFORMANCE_INSUFFICIENT" });
  if (!preparation.matchedCandidateIds.includes(candidateId)) return Object.freeze({ deploymentBlockedReason: "QUALIFIED_CANDIDATE_HAS_NO_MATCHED_PAPER_EVIDENCE" });
  if (run.allocation == null || !Array.isArray(run.allocation.entries) || run.allocation.entries.length !== 1 || run.allocation.entries[0].id !== candidateId) {
    return Object.freeze({ deploymentBlockedReason: "AMBIGUOUS_LEAGUE_ALLOCATION" });
  }
  const bindings = run.provenance.candidateBindings.filter((binding) => binding.candidateId === candidateId);
  if (bindings.length !== 1) throw new Error("closed-learning worker qualified candidate binding is ambiguous");
  const binding = bindings[0];
  const dataset = run.provenance.dataset;
  if (!SHA64.test(binding.specificationHash) || !SHA64.test(binding.datasetContentSha256) || binding.datasetId !== dataset.datasetId || binding.datasetContentSha256 !== dataset.contentSha256) {
    throw new Error("closed-learning worker qualified candidate provenance is invalid");
  }
  if (!MARKET.test(String(dataset.market || "").trim().toUpperCase()) || !run.allocation.entries[0].sourceDatasetIds.includes(binding.datasetId)) {
    throw new Error("closed-learning worker qualified candidate allocation provenance is invalid");
  }
  const replayRunFingerprintSha256 = run.provenance.runFingerprintSha256;
  if (!SHA64.test(replayRunFingerprintSha256)) throw new Error("closed-learning worker replay fingerprint is invalid");
  const decisionReference = `research-replay:${replayRunFingerprintSha256}:${binding.specificationHash.slice(0, 24)}`;
  return Object.freeze({
    deploymentCandidate: Object.freeze({
      candidateId,
      candidateVersion: binding.specificationHash,
      market: String(dataset.market).trim().toUpperCase(),
      advisory: run.allocation,
      candidateProvenance: Object.freeze([{ candidateId, datasetId: binding.datasetId, datasetContentSha256: binding.datasetContentSha256 }]),
      decisionReference,
      originalRunFingerprintSha256,
      replayRunFingerprintSha256,
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }),
  });
}

function executeRequest(requestValue, env = process.env, dependencies = defaultDependencies()) {
  const request = validateRequest(requestValue);
  const store = new dependencies.FileResearchRunReplaySnapshotStore(snapshotPathFromEnv(env));
  const snapshot = store.read(request.originalRunFingerprintSha256);
  if (snapshot == null) throw new Error("closed-learning worker original Research snapshot is unavailable");
  const preparation = request.operation === "REPLAY_CANONICAL_PAPER_EVIDENCE" ? canonicalEvidence(request, snapshot, dependencies) : undefined;
  const paperEvidenceByCandidate = preparation == null ? request.paperEvidenceByCandidate : preparation.paperEvidenceByCandidate;
  const replay = dependencies.replayResearchRunWithPaperEvidence(snapshot, paperEvidenceByCandidate);
  if (replay == null || replay.qualification == null || replay.run == null) throw new Error("closed-learning worker replay result is invalid");
  const qualification = replay.qualification;
  if (qualification.liveAuthority !== "NONE" || qualification.productionMutationAllowed !== false || qualification.aiAuthority !== "ZERO_AUTHORITY") {
    throw new Error("closed-learning worker authority invariant violated");
  }
  const projection = deploymentProjection(replay.run, qualification, preparation, request.originalRunFingerprintSha256);
  return Object.freeze({
    schemaVersion: 1,
    operation: "REPLAY_PAPER_EVIDENCE",
    originalRunFingerprintSha256: request.originalRunFingerprintSha256,
    replayRunFingerprintSha256: replay.run.provenance.runFingerprintSha256,
    qualification,
    ...(preparation == null ? {} : { canonicalPreparation: Object.freeze({
      matchedCandidateIds: preparation.matchedCandidateIds,
      awaitingPerformanceCandidateIds: preparation.awaitingPerformanceCandidateIds,
      orderedRecordIds: preparation.orderedRecordIds,
      ...projection,
    }) }),
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

module.exports = { canonicalEvidence, deploymentProjection, executeRequest, snapshotPathFromEnv, validateRequest };
