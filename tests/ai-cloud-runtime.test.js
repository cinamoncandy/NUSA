const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { aiSha256 } = require("../dist/packages/contracts/src/aiInference.js");
const { TransportModelProvider } = require("../dist/apps/cloud/src/ai/modelProvider.js");
const { createCloudAiRuntime } = require("../dist/apps/cloud/src/ai/runtime.js");
const { buildCloudRuntimeAiEvidence } = require("../dist/apps/cloud/src/ai/cloudRuntimeEvidence.js");
const { MultiAgentOrchestrator } = require("../dist/apps/cloud/src/ai/multiAgentOrchestrator.js");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");

const proposalSeed = { strategyVersionId: "cloud-paper-preview", decision: "candidate", rationaleClaims: ["grounded public market evidence"], assumptions: ["PAPER only"], uncertainty: "uncalibrated", rawProbability: 0.6 };

function grounded(at = 1_000) {
  return buildCloudRuntimeAiEvidence({ code: "KRW-BTC", trade_price: 100, trade_timestamp: at, signed_change_rate: 0.01, acc_trade_volume: 5 }, { mode: "PAPER", killSwitchActive: false, tradingAllowed: true, overallHealth: "HEALTHY", p0State: "CLOSED", observedAt: at });
}

function input(at = 1_000, id = "cloud-ai-test") {
  const bundle = grounded(at);
  return { orchestrationRunId: id, decisionId: `${id}:decision`, evaluatedAt: at, evidence: bundle.evidence, evidenceMaterializations: bundle.evidenceMaterializations, policyVersionIds: ["AI_ZERO_AUTHORITY_POLICY_V1", "NUSA_DETERMINISTIC_SAFETY_V1"], certificationIds: [], controlPlaneStateId: "cloud:PAPER:ACTIVE:CLOSED", contextValidForMs: 120_000 };
}

function providerWithClock(clock) {
  return new TransportModelProvider("cloud-fixture", "model-1", async (request) => {
    const startedAt = clock.advance(5);
    let payload;
    if (request.role === "EVIDENCE_PRODUCER") payload = { observations: [{ claim: "market state is grounded", claimType: "fact", evidenceReferences: [request.input.evidence[0].evidenceId], freshnessStatus: "fresh" }], missingEvidence: [], evidenceBundleHash: request.input.evidenceBundleHash };
    if (request.role === "STRATEGY_PROPOSER") payload = proposalSeed;
    if (request.role === "ADVERSARIAL_CRITIC") payload = { reviewedProposalHash: request.input.proposalHash, counterClaims: ["same-model roles are correlated"], failedAssumptions: [], missingTests: ["independent challenger"], alternativeExplanations: ["market noise"], severity: "low" };
    if (request.role === "RISK_VERIFIER") payload = { result: "verified", hardDenies: [], warnings: ["zero authority"], missingRequirements: [], requiredEscalations: [], policyReferences: ["risk-policy-1"] };
    const output = { schemaVersion: 1, role: request.role, evidenceReferences: request.input.evidence.map((item) => item.evidenceId), payload };
    const completedAt = clock.advance(5);
    return { requestId: request.requestId, providerId: request.providerId, modelVersionId: request.modelVersionId, promptArtifactDigest: request.promptArtifactDigest, contextHash: request.contextHash, inputHash: request.inputHash, structuredOutput: output, outputHash: aiSha256(output), startedAt, completedAt };
  });
}

async function settle(runtime) {
  for (let attempt = 0; attempt < 50 && runtime.isInFlight(); attempt += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.isInFlight(), false);
}

test("Cloud AI evidence contains only digest-bound public market and deterministic safety payloads", () => {
  const bundle = grounded(10_000);
  assert.equal(bundle.evidence.length, 2);
  assert.equal(bundle.evidenceMaterializations.length, 2);
  for (const materialized of bundle.evidenceMaterializations) assert.equal(aiSha256(materialized.payload), materialized.contentDigest);
  const encoded = JSON.stringify(bundle);
  assert.match(encoded, /UPBIT_PUBLIC_TICKER/);
  assert.match(encoded, /NUSA_DETERMINISTIC_SAFETY_STATE/);
  assert.doesNotMatch(encoded, /authorization|bearer|credential|password|privateKey|availableCash|accountBalance|orders|fills/i);
});

test("real model completion after snapshot time is evaluated at completion time while freshness remains bounded", async () => {
  const clock = { value: 20_000, advance(step) { this.value += step; return this.value; } };
  const result = await new MultiAgentOrchestrator(providerWithClock(clock), { enabled: true, maxRetries: 0 }).run(input(20_000, "post-snapshot-completion"));
  assert.equal(result.status, "COMPLETED");
  assert.ok(result.governanceDecision);
  assert.equal(result.governanceDecision.vetoReasons.includes("RUN_TIME_INVALID"), false);
  assert.equal(result.runs.every((run) => run.completedAt > 20_000), true);
  assert.equal(result.productionMutationAllowed, false);
});

test("Cloud AI scheduler suppresses overlap and cadence, retains only fresh validated zero-authority results", async () => {
  const clock = { value: 30_000, advance(step) { this.value += step; return this.value; } };
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, providerWithClock(clock), { now: () => clock.value, minimumCadenceMs: 30_000, maximumResultAgeMs: 120_000 });
  assert.equal(runtime.schedule(input(30_000, "scheduler-1")), true);
  assert.equal(runtime.schedule(input(30_000, "scheduler-overlap")), false);
  await settle(runtime);
  const latest = runtime.latest(clock.value);
  assert.ok(latest);
  assert.equal(latest.liveAuthority, "NONE");
  assert.equal(latest.realOrderAuthority, false);
  assert.equal(latest.realTransferAuthority, false);
  assert.equal(latest.productionMutationAllowed, false);
  assert.equal(runtime.schedule(input(clock.value, "scheduler-cadence")), false);
  clock.advance(30_000);
  assert.equal(runtime.schedule(input(clock.value, "scheduler-2")), true);
  await settle(runtime);
  clock.advance(120_001);
  assert.equal(runtime.latest(clock.value), null);
});

test("provider failure never becomes a latest validated result", async () => {
  const clock = 50_000;
  const failing = new TransportModelProvider("down", "down", async () => { throw new Error("provider down"); });
  const runtime = createCloudAiRuntime({ NUSA_AI_ENABLED: "true" }, failing, { now: () => clock, minimumCadenceMs: 0 });
  assert.equal(runtime.schedule(input(clock, "provider-down")), true);
  await settle(runtime);
  assert.equal(runtime.latest(clock), null);
  assert.equal(runtime.liveAuthority, "NONE");
  assert.equal(runtime.productionMutationAllowed, false);
});

test("Cloud ticker schedules bounded AI evidence without awaiting it and AI faults do not erase PAPER read state", async () => {
  const token = ["ai", "cloud", "read-only", "dashboard", "fixture", "123456"].join("-");
  const env = { NUSA_CLOUD_DASHBOARD_HOST: "127.0.0.1", NUSA_CLOUD_DASHBOARD_PORT: "41960", NUSA_CLOUD_DASHBOARD_TOKEN: token, NUSA_CLOUD_STATE_DB_PATH: ":memory:", NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true", NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC", NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "1000000" };
  let onTicker;
  let onConnectionState;
  let scheduled = null;
  let latestReads = 0;
  const marketFactory = (_markets, tickerCallback, stateCallback) => {
    onTicker = tickerCallback; onConnectionState = stateCallback;
    return { subscribe() {}, start() {}, stop() {} };
  };
  const aiRuntime = { enabled: true, orchestrator: null, schedule(value) { scheduled = value; throw new Error("AI scheduler fault must be isolated"); }, latest() { latestReads += 1; return null; }, applicableLessons() { return []; }, isInFlight() { return false; }, liveAuthority: "NONE", productionMutationAllowed: false };
  const handle = startCloudRuntime(env, undefined, undefined, marketFactory, undefined, undefined, undefined, undefined, undefined, undefined, aiRuntime);
  try {
    onConnectionState("CONNECTED");
    const observedAt = Date.now();
    onTicker({ type: "ticker", code: "KRW-BTC", trade_price: 100000000, trade_timestamp: observedAt, signed_change_rate: 0.02, acc_trade_volume: 10 });
    assert.ok(scheduled);
    assert.equal(scheduled.evidence.length, 2);
    assert.equal(scheduled.evidenceMaterializations.length, 2);
    assert.equal(scheduled.controlPlaneStateId.includes("CLOSED"), true);
    const response = await fetch(`http://${handle.host}:${handle.port}/api/paper-operations`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.liveAuthority, "NONE");
    assert.equal(body.productionMutationAllowed, false);
    assert.equal(body.portfolio.account.cash, 1000000);
    assert.equal(body.ai.status, "UNAVAILABLE");
    assert.ok(latestReads >= 1);
  } finally { await handle.stop(); }
  const source = fs.readFileSync("apps/cloud/src/runtime.ts", "utf8");
  assert.doesNotMatch(source, /await\s+aiRuntime\??\.schedule/);
  assert.match(source, /projectAiReadOnly\(aiRuntime\.latest\(Date\.now\(\)\)\)/);
});
