const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ShadowPilotRuntime } = require("../dist/apps/desktop/src/shadow/shadowPilotRuntime.js");
const { ShadowEvidenceArchive, findIncompleteShadowArchives, verifyShadowEvidenceDirectory, replayShadowEvidenceArchive, replayShadowEvidenceArchives, replayShadowEvidenceTimeline } = require("../dist/apps/desktop/src/shadow/shadowEvidenceArchive.js");
const { buildShadowCompletionEvidence } = require("../dist/apps/desktop/src/shadow/shadowCompletionEvidence.js");

function metadata(sessionId) {
  return {
    sessionId,
    createdAt: 1000,
    sourceCommitSha: "a".repeat(40),
    symbol: "KRW-BTC",
    strategyId: "sma-crossover",
    strategyVersion: "sma-crossover:closed-candle-1m-v1",
    controlOrigin: "LOCAL_INTERACTIVE_UI",
    authenticatedOwner: false,
    fingerprints: { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" }
  };
}

function pilot(sessionId) {
  const runtime = new ShadowPilotRuntime({
    sessionId,
    createdAt: 1000,
    sourceCommitSha: "a".repeat(40),
    symbol: "KRW-BTC",
    strategyId: "sma-crossover",
    fingerprints: { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" }
  });
  assert.equal(runtime.precheck({ paperOnly: true, deploymentIntegrity: true, reconciliation: true, killSwitch: false, openP0: false, marketDataHealthy: true, warmedUp: true, automaticTrading: false }), "READY");
  runtime.start(1100);
  runtime.observe({ timestamp: 1200, signalId: "sig-1", commandId: "cmd-1", side: "BUY", quantity: 1, decision: "ALLOW", reasonCodes: [] });
  runtime.stop(1300);
  return runtime;
}

test("archive writes an append-only hash chain and independently verifies zero mutation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nusa-shadow-evidence-"));
  const sessionId = "shadow-test-1";
  const archive = await ShadowEvidenceArchive.create(root, metadata(sessionId));
  for (const event of pilot(sessionId).eventLog()) await archive.append(event, event.timestamp + 1);
  const manifest = await archive.finalize("OWNER_STOP", 1400);
  assert.equal(manifest.status, "COMPLETED");
  assert.equal(manifest.eventCount, 3);
  const verification = await verifyShadowEvidenceDirectory(archive.directoryPath(), 1500);
  assert.equal(verification.status, "PASS");
  assert.equal(verification.actualBrokerCalls, 0);
  assert.equal(verification.actualOrders, 0);
  assert.equal(verification.actualFills, 0);
  assert.equal(verification.cashMutations, 0);
  assert.equal(verification.positionMutations, 0);
});

test("sealed archives replay deterministically without hydrating execution", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nusa-shadow-replay-"));
  const sessionId = "shadow-replay-1";
  const archive = await ShadowEvidenceArchive.create(root, metadata(sessionId));
  for (const event of pilot(sessionId).eventLog()) await archive.append(event, event.timestamp + 1);
  await archive.finalize("OWNER_STOP", 1400);
  const first = await replayShadowEvidenceArchive(archive.directoryPath());
  const second = await replayShadowEvidenceArchive(archive.directoryPath());
  assert.deepEqual(first.events, second.events);
  assert.equal(first.events.length, 3);
  assert.equal(first.events[0].actualBrokerCallCount, 0);
  const all = await replayShadowEvidenceArchives(root);
  assert.equal(all.archives.length, 1);
  assert.deepEqual(all.rejected, []);
  const timeline = await replayShadowEvidenceTimeline(root);
  assert.equal(timeline.events.length, 3);
  assert.deepEqual(timeline.rejectedArchives, []);
});

test("corrupt or open archives fail closed during replay", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nusa-shadow-replay-invalid-"));
  const archive = await ShadowEvidenceArchive.create(root, metadata("shadow-replay-open"));
  await archive.append(pilot("shadow-replay-open").eventLog()[0]);
  await assert.rejects(() => replayShadowEvidenceArchive(archive.directoryPath()), /replay rejected/);
});

test("completed observation persists an independently hashed SAFE_COMPLETION summary", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nusa-shadow-completion-"));
  const sessionId = "shadow-completion-evidence";
  const runtime = pilot(sessionId);
  const archive = await ShadowEvidenceArchive.create(root, metadata(sessionId));
  for (const event of runtime.eventLog()) await archive.append(event, event.timestamp + 1);
  const completion = buildShadowCompletionEvidence({ diagnostics: {
    ...runtime.snapshot(), state: "COMPLETED", sessionId, symbol: "KRW-BTC", strategyId: "sma-crossover", startedAt: 1100,
    actualBrokerCallCount: 0, executionGateCallCount: 0, actualOrderCount: 0, actualFillCount: 0, cashMutationCount: 0, positionMutationCount: 0,
    signalCount: 1
  }, completionReason: "MAX_SESSION_DURATION_REACHED", completedAt: 1400 });
  assert.equal(completion.safety, "SAFE_COMPLETION");
  const manifest = await archive.finalize("MAX_SESSION_DURATION_REACHED", 1400, "COMPLETED", completion);
  assert.match(manifest.completionSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(archive.directoryPath(), "completion.json"), "utf8")), completion);
  assert.equal((await verifyShadowEvidenceDirectory(archive.directoryPath(), 1500)).status, "PASS");
});

test("tampering with the completion summary fails independent verification", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nusa-shadow-completion-tamper-"));
  const sessionId = "shadow-completion-tamper";
  const runtime = pilot(sessionId);
  const archive = await ShadowEvidenceArchive.create(root, metadata(sessionId));
  for (const event of runtime.eventLog()) await archive.append(event);
  const completion = buildShadowCompletionEvidence({ diagnostics: {
    ...runtime.snapshot(), state: "COMPLETED", sessionId, symbol: "KRW-BTC", strategyId: "sma-crossover", startedAt: 1100,
    actualBrokerCallCount: 0, executionGateCallCount: 0, actualOrderCount: 0, actualFillCount: 0, cashMutationCount: 0, positionMutationCount: 0, signalCount: 1
  }, completionReason: "MAX_SESSION_DURATION_REACHED", completedAt: 1400 });
  await archive.finalize("MAX_SESSION_DURATION_REACHED", 1400, "COMPLETED", completion);
  const completionPath = path.join(archive.directoryPath(), "completion.json");
  const changed = JSON.parse(await fs.readFile(completionPath, "utf8"));
  changed.signalCount = 99;
  await fs.writeFile(completionPath, JSON.stringify(changed) + "\n", "utf8");
  const verification = await verifyShadowEvidenceDirectory(archive.directoryPath(), 1500);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.blockers.includes("COMPLETION_EVIDENCE_MISMATCH"));
});

test("payload tampering is detected by re-derived envelope hashes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nusa-shadow-evidence-"));
  const sessionId = "shadow-test-2";
  const archive = await ShadowEvidenceArchive.create(root, metadata(sessionId));
  for (const event of pilot(sessionId).eventLog()) await archive.append(event);
  const file = path.join(archive.directoryPath(), "events.ndjson");
  const text = await fs.readFile(file, "utf8");
  await fs.writeFile(file, text.replace('"riskDecision":"ALLOW"', '"riskDecision":"REJECT"'), "utf8");
  const verification = await verifyShadowEvidenceDirectory(archive.directoryPath(), 1500);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.blockers.includes("EVENT_HASH_MISMATCH"));
});

test("manifest tampering is detected independently of event payload hashes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nusa-shadow-evidence-"));
  const sessionId = "shadow-manifest-tamper";
  const archive = await ShadowEvidenceArchive.create(root, metadata(sessionId));
  for (const event of pilot(sessionId).eventLog()) await archive.append(event);
  await archive.finalize("OWNER_STOP", 1400);
  const manifestPath = path.join(archive.directoryPath(), "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.eventCount += 1;
  await fs.writeFile(manifestPath, JSON.stringify(manifest) + "\n", "utf8");
  const verification = await verifyShadowEvidenceDirectory(archive.directoryPath(), 1500);
  assert.equal(verification.status, "FAIL");
  assert.ok(verification.blockers.includes("MANIFEST_MISMATCH"));
});

test("partial NDJSON line is classified as corrupted", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nusa-shadow-evidence-"));
  const sessionId = "shadow-test-3";
  const archive = await ShadowEvidenceArchive.create(root, metadata(sessionId));
  await archive.append(pilot(sessionId).eventLog()[0]);
  const file = path.join(archive.directoryPath(), "events.ndjson");
  const text = await fs.readFile(file, "utf8");
  await fs.writeFile(file, text.trimEnd(), "utf8");
  const verification = await verifyShadowEvidenceDirectory(archive.directoryPath(), 1500);
  assert.equal(verification.status, "CORRUPTED");
});

test("credential-like fields and absolute user paths are rejected before persistence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nusa-shadow-evidence-"));
  await assert.rejects(() => ShadowEvidenceArchive.create(root, { ...metadata("shadow-secret"), fingerprints: { strategy: "s", config: "c", runtime: "r", riskPolicy: "p", apiToken: "secret" } }), /credential-like field/);
  await assert.rejects(() => ShadowEvidenceArchive.create(root, { ...metadata("shadow-path"), sourceCommitSha: "C:\\Users\\person\\secret" }), /absolute user path/);
  const archive = await ShadowEvidenceArchive.create(root, metadata("shadow-event-fields"));
  const event = pilot("shadow-event-fields").eventLog()[0];
  await assert.rejects(() => archive.append({ ...event, apiToken: "secret" }), /credential-like field/);
  await assert.rejects(() => archive.append({ ...event, commandId: "C:\\Users\\person\\private" }), /absolute user path/);
});

test("an aborted partial session is sealed and verifies without inventing a stop event", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nusa-shadow-evidence-"));
  const sessionId = "shadow-aborted-partial";
  const archive = await ShadowEvidenceArchive.create(root, metadata(sessionId));
  await archive.append(pilot(sessionId).eventLog()[0]);
  const manifest = await archive.finalize("SINK_WRITE_FAILED", 1400, "ABORTED");
  assert.equal(manifest.status, "ABORTED");
  const verification = await verifyShadowEvidenceDirectory(archive.directoryPath(), 1500);
  assert.equal(verification.status, "PASS");
  assert.deepEqual(await findIncompleteShadowArchives(root), []);
});

test("open sessions without a completion marker are reported for recovery", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nusa-shadow-evidence-"));
  const archive = await ShadowEvidenceArchive.create(root, metadata("shadow-incomplete"));
  const incomplete = await findIncompleteShadowArchives(root);
  assert.deepEqual(incomplete, [archive.directoryPath()]);
});
