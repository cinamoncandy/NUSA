const test = require("node:test");
const assert = require("node:assert/strict");
const { aiSha256 } = require("../dist/packages/contracts/src/aiInference.js");
const { TransportModelProvider } = require("../dist/apps/cloud/src/ai/modelProvider.js");
const { buildCloudRuntimeAiEvidence } = require("../dist/apps/cloud/src/ai/cloudRuntimeEvidence.js");
const { createCloudAiRuntime } = require("../dist/apps/cloud/src/ai/runtime.js");

const observedAt = 1_700_000_000_000;
const bundle = buildCloudRuntimeAiEvidence({
  code: "KRW-BTC",
  trade_price: 100,
  trade_timestamp: observedAt,
  signed_change_rate: 0.01,
  acc_trade_volume: 100
}, {
  mode: "PAPER",
  killSwitchActive: false,
  tradingAllowed: true,
  overallHealth: "HEALTHY",
  p0State: "CLOSED",
  observedAt
});

const primaryProvider = new TransportModelProvider("openai", "primary-test", async (request) => {
  const marketEvidenceId = request.input.evidence[0].evidenceId;
  let payload;
  if (request.role === "EVIDENCE_PRODUCER") payload = { observations: [{ claim: "verified market state", claimType: "fact", evidenceReferences: [marketEvidenceId], freshnessStatus: "fresh" }], missingEvidence: [], evidenceBundleHash: request.input.evidenceBundleHash };
  if (request.role === "STRATEGY_PROPOSER") payload = { strategyVersionId: "strategy-preview", decision: "candidate", rationaleClaims: ["candidate"], assumptions: ["paper only"], uncertainty: "medium", rawProbability: 0.7, expectedEffect: "research", costSensitivity: "unknown", capacitySensitivity: "unknown" };
  if (request.role === "ADVERSARIAL_CRITIC") payload = { reviewedProposalHash: request.input.proposalHash, counterClaims: [], failedAssumptions: [], missingTests: [], alternativeExplanations: [], severity: "low" };
  if (request.role === "RISK_VERIFIER") payload = { result: "verified", hardDenies: [], warnings: [], missingRequirements: [], requiredEscalations: [], policyReferences: ["risk-policy"] };
  const output = { schemaVersion: 1, role: request.role, evidenceReferences: [marketEvidenceId], payload };
  return {
    requestId: request.requestId,
    providerId: request.providerId,
    modelVersionId: request.modelVersionId,
    promptArtifactDigest: request.promptArtifactDigest,
    contextHash: request.contextHash,
    inputHash: request.inputHash,
    structuredOutput: output,
    outputHash: aiSha256(output),
    startedAt: observedAt + 1,
    completedAt: observedAt + 2
  };
});

const orchestrationInput = (id = "runtime-nversion") => ({
  orchestrationRunId: id,
  decisionId: `${id}:decision`,
  evaluatedAt: observedAt,
  evidence: bundle.evidence,
  evidenceMaterializations: bundle.evidenceMaterializations,
  policyVersionIds: ["AI_ZERO_AUTHORITY_POLICY_V1"],
  certificationIds: [],
  controlPlaneStateId: "paper-safe",
  contextValidForMs: 120_000
});

const resourceSnapshot = {
  schemaVersion: 1,
  health: "HEALTHY",
  policy: { schemaVersion: 1, policyId: "N_VERSION_TEST", policyVersion: "1", maxModelCalls: 2, maxTotalAttempts: 4, maxCumulativeOutputTokens: 8192, maxInputBytes: 1024, maxWallClockMs: 30000, requireUsageAccounting: true },
  modelCalls: 2,
  attempts: 2,
  reservedOutputTokens: 4096,
  inputBytes: 100,
  usageAccountingStatus: "VERIFIED",
  actualInputTokens: 20,
  actualOutputTokens: 10,
  actualTotalTokens: 30,
  elapsedMs: 10,
  attemptsEvidence: [],
  liveAuthority: "NONE",
  productionMutationAllowed: false
};

const comparison = (state) => ({
  schemaVersion: 1,
  comparisonRunId: "runtime-nversion:nversion",
  comparisonState: state,
  trustDisposition: state === "CONSENSUS" ? "NO_UPLIFT" : "ABSTAIN",
  independentGroupCount: 2,
  completedGroupCount: state === "INCOMPLETE" ? 1 : 2,
  policyIdentity: "p".repeat(64),
  comparisonIdentity: "c".repeat(64),
  groups: [],
  metrics: { decisionAgreement: state === "CONSENSUS", uncertaintyAgreement: true, maxProbabilityDelta: 0.1, minimumEvidenceReferenceOverlap: 1, minimumAssumptionOverlap: 1, disagreementCodes: state === "DISAGREEMENT" ? ["DECISION_MISMATCH"] : [] },
  inferenceResources: resourceSnapshot,
  liveAuthority: "NONE",
  realOrderAuthority: false,
  realTransferAuthority: false,
  productionMutationAllowed: false
});

async function waitFor(runtime) {
  for (let attempt = 0; attempt < 100 && (runtime.isInFlight() || runtime.isProviderComparisonInFlight()); attempt += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.isInFlight(), false);
  assert.equal(runtime.isProviderComparisonInFlight(), false);
}

test("N-version comparison is off by default and cannot appear without explicit composition", async () => {
  const now = observedAt + 100;
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, primaryProvider, { now: () => now, minimumCadenceMs: 0, maximumResultAgeMs: 10000, nVersionEvaluator: null });
  assert.equal(runtime.schedule(orchestrationInput("default-off")), true);
  await waitFor(runtime);
  assert.equal(runtime.latestProviderComparison(now), null);
  assert.equal(runtime.latest(now)?.providerComparison, undefined);
});

test("Cloud runtime runs an injected N-version evaluator on the same evidence and attaches only read-only evidence", async () => {
  const now = observedAt + 100;
  let received = null;
  const evaluator = { run: async (input) => { received = input; return comparison("DISAGREEMENT"); } };
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, primaryProvider, { now: () => now, minimumCadenceMs: 0, maximumResultAgeMs: 10000, nVersionEvaluator: evaluator });
  const scheduled = orchestrationInput();
  assert.equal(runtime.schedule(scheduled), true);
  await waitFor(runtime);
  assert.ok(received);
  assert.equal(received.comparisonRunId, `${scheduled.orchestrationRunId}:nversion`);
  assert.equal(received.decisionId, scheduled.decisionId);
  assert.equal(received.evidence, scheduled.evidence);
  assert.equal(received.evidenceMaterializations, scheduled.evidenceMaterializations);
  const latest = runtime.latest(now);
  assert.ok(latest);
  assert.equal(latest.providerComparison.comparisonState, "DISAGREEMENT");
  assert.equal(latest.providerComparison.liveAuthority, "NONE");
  assert.equal(latest.providerComparison.realOrderAuthority, false);
  assert.equal(latest.providerComparison.productionMutationAllowed, false);
  const projection = runtime.latestProjection(now);
  assert.equal(projection.providerComparisonState, "DISAGREEMENT");
  assert.equal(projection.providerTrustDisposition, "ABSTAIN");
  assert.equal(projection.confidence, 0);
  assert.equal(projection.effectiveConfidence, 0);
  assert.equal(projection.liveAuthority, "NONE");
  assert.equal(projection.productionMutationAllowed, false);
});

test("provider comparison evidence expires independently and cannot contaminate later primary results", async () => {
  let now = observedAt + 100;
  const evaluator = { run: async () => comparison("CONSENSUS") };
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, primaryProvider, { now: () => now, minimumCadenceMs: 0, maximumResultAgeMs: 1000, nVersionEvaluator: evaluator });
  runtime.schedule(orchestrationInput("fresh-comparison"));
  await waitFor(runtime);
  assert.equal(runtime.latestProviderComparison(now).comparisonState, "CONSENSUS");
  now += 1001;
  assert.equal(runtime.latestProviderComparison(now), null);
  assert.equal(runtime.latest(now), null, "primary and comparison evidence obey the same maximum result age boundary");
});
