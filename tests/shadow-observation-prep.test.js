const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { StrategyEngine, SmaCrossoverStrategy } = require("../dist/apps/desktop/src/strategy/strategyEngine.js");
const { ShadowOperationalRuntime } = require("../dist/apps/desktop/src/shadow/shadowOperationalRuntime.js");
const { ShadowEvidenceBus, InMemoryEvidenceSink } = require("../dist/apps/desktop/src/shadow/shadowEvidenceBus.js");
const { SHADOW_OBSERVATION_PROFILE, validateShadowObservationProfile, withShortenedObservation } = require("../dist/apps/desktop/src/shadow/shadowObservationProfile.js");
const { evaluateShadowObservationPreflight } = require("../dist/apps/desktop/src/shadow/shadowObservationPreflight.js");
const { buildShadowObservationSummary, formatShadowObservationSummary } = require("../dist/apps/desktop/src/shadow/shadowObservationSummary.js");
const { runShadowObservationSmoke } = require("../scripts/lib/shadow-observation-smoke.js");

const SYMBOL = "KRW-BTC";
const MINUTE = 60_000;
const COMMIT = "a".repeat(40);
const CLOCK = Date.UTC(2026, 0, 2);

/** Every preflight input already satisfying every condition. Individual tests spoil one field. */
function passingPreflightInput(overrides = {}) {
  return {
    profile: SHADOW_OBSERVATION_PROFILE,
    runtimeState: "IDLE",
    evidenceRecoveryState: "NONE",
    incompleteEvidenceArchives: [],
    evidenceArchiveWritable: true,
    liveTradingCapabilityPresent: false,
    privateApiCapabilityPresent: false,
    credentialStoragePresent: false,
    capabilityScanMethod: "source-pattern-scan",
    mutationCounters: {
      actualBrokerCallCount: 0, actualOrderCount: 0, actualFillCount: 0,
      cashMutationCount: 0, positionMutationCount: 0, privateApiCallCount: 0
    },
    configuredMarket: "KRW-BTC",
    configuredInterval: "1m",
    configuredSourceType: "UPBIT_PUBLIC_CANDLE",
    closedCandlesOnly: true,
    now: CLOCK,
    evidenceSinkReady: true,
    busCapacity: SHADOW_OBSERVATION_PROFILE.maxQueueDepth,
    ...overrides
  };
}

function makeRuntime(overrides = {}) {
  const strategy = new StrategyEngine(new SmaCrossoverStrategy(5, 20));
  strategy.start();
  let now = CLOCK;
  let nextMinute = 20;
  const buses = [];
  const runtime = new ShadowOperationalRuntime({
    symbol: SYMBOL,
    strategyId: "sma-crossover",
    strategyVersion: "sma-crossover:closed-candle-1m-v1",
    sourceCommitSha: COMMIT,
    fingerprints: { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" },
    strategy,
    getPositionQuantity: () => 0,
    onProductionSignal: overrides.onProductionSignal || (() => {}),
    riskGate: { evaluate: () => ({ status: "ALLOW", reasonCodes: [] }) },
    getHypotheticalOrderQuantity: () => 0.001,
    getSafetyState: () => ({
      deploymentIntegrity: true, reconciliation: true, killSwitch: false,
      openP0: false, automaticTrading: false, currentModeIsCanaryOrExtended: false
    }),
    now: () => now,
    ...(overrides.maxSessionDurationMs === undefined ? {} : { maxSessionDurationMs: overrides.maxSessionDurationMs }),
    ...(overrides.maxCandleAgeMs === undefined ? {} : { maxCandleAgeMs: overrides.maxCandleAgeMs }),
    createEvidenceBus: overrides.createEvidenceBus || (({ sessionId, onHalt }) => {
      const bus = new ShadowEvidenceBus({ sessionId, sinks: overrides.sinks || [new InMemoryEvidenceSink()], capacity: overrides.capacity, onHalt });
      buses.push(bus);
      return bus;
    }),
    findIncompleteEvidence: overrides.findIncompleteEvidence || (() => [])
  });
  return {
    runtime, buses,
    setNow: (value) => { now = value; },
    getNow: () => now,
    warmUp: () => {
      runtime.onWebSocketStatus("connected");
      for (let minute = 0; minute <= 20; minute += 1) {
        now = CLOCK + minute * MINUTE;
        runtime.onTicker({ code: SYMBOL, trade_price: 100, trade_timestamp: now, trade_volume: 1, trade_id: `w-${minute}` });
      }
    },
    /**
     * Feeds one tick per minute, contiguously from where the last call left off, closing one
     * candle per call. Contiguity matters: skipping a minute makes the closed-candle adapter
     * report GAP_DETECTED and auto-pause, which would mask whatever the test meant to check.
     */
    candles: (count, priceAt) => {
      for (let index = 0; index < count; index += 1) {
        nextMinute += 1;
        now = CLOCK + nextMinute * MINUTE;
        runtime.onTicker({ code: SYMBOL, trade_price: priceAt(index), trade_timestamp: now, trade_volume: 1, trade_id: `c-${nextMinute}` });
      }
    },
    /** Feeds a closed candle straight down the official-candle path, bypassing the adapter. */
    officialCandles: (candles) => runtime.syncOfficialCandles({ loadClosedCandles: async () => candles }),
    closedCandle: (minute, price) => Object.freeze({
      symbol: SYMBOL, interval: "1m", openTime: CLOCK + minute * MINUTE, closeTime: CLOCK + (minute + 1) * MINUTE,
      open: price, high: price, low: price, close: price, volume: 1
    })
  };
}

// ---------------------------------------------------------------- 1. preflight PASS

test("1: a fully healthy system passes preflight", () => {
  const report = evaluateShadowObservationPreflight(passingPreflightInput());
  assert.equal(report.status, "PASS", JSON.stringify(report.blockers));
  assert.deepEqual([...report.blockers], []);
  // A PASS must never be readable as proof that no capability exists.
  assert.equal(report.capabilityAssuranceLimit, "SOURCE_SCAN_PROVES_PRESENCE_NOT_ABSENCE");
});

test("1b: the shipped profile satisfies every A4 boundary", () => {
  assert.deepEqual([...validateShadowObservationProfile(SHADOW_OBSERVATION_PROFILE)], []);
  assert.equal(SHADOW_OBSERVATION_PROFILE.market, "KRW-BTC");
  assert.equal(SHADOW_OBSERVATION_PROFILE.candleInterval, "1m");
  assert.equal(SHADOW_OBSERVATION_PROFILE.actualOrdersEnabled, false);
  assert.equal(SHADOW_OBSERVATION_PROFILE.privateApiEnabled, false);
  assert.equal(SHADOW_OBSERVATION_PROFILE.initialObservationDurationMs, 10 * MINUTE);
  assert.equal(SHADOW_OBSERVATION_PROFILE.maxSessionDurationMs, 30 * MINUTE);
});

test("1c: a shortened profile may only shorten, never lengthen or widen", () => {
  const short = withShortenedObservation(SHADOW_OBSERVATION_PROFILE, 2 * MINUTE);
  assert.equal(short.maxSessionDurationMs, 2 * MINUTE);
  assert.equal(short.initialObservationDurationMs, 2 * MINUTE);
  assert.equal(short.market, "KRW-BTC");
  assert.equal(short.actualOrdersEnabled, false);
  // Fail-closed rather than clamping: a silently-ignored override is how a short run becomes long.
  assert.throws(() => withShortenedObservation(SHADOW_OBSERVATION_PROFILE, 60 * MINUTE), /exceeds the profile maximum/);
  assert.throws(() => withShortenedObservation(SHADOW_OBSERVATION_PROFILE, 0), /invalid observation duration/);
  assert.throws(() => withShortenedObservation(SHADOW_OBSERVATION_PROFILE, Number.NaN), /invalid observation duration/);
});

// ------------------------------------------- 2. incomplete archive blocks the start

test("2: an incomplete archive blocks preflight and blocks the runtime start", () => {
  const report = evaluateShadowObservationPreflight(passingPreflightInput({ incompleteEvidenceArchives: ["/scratch/shadow-previous"] }));
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.includes("INCOMPLETE_EVIDENCE_ARCHIVES:1"), JSON.stringify(report.blockers));

  const h = makeRuntime({ findIncompleteEvidence: () => ["/scratch/shadow-previous"] });
  h.warmUp();
  const result = h.runtime.start();
  assert.equal(result.state, "HALTED");
  assert.ok(result.blockers.includes("EVIDENCE_RECOVERY_REQUIRED"), JSON.stringify(result.blockers));
});

test("2b: a RECOVERY_REQUIRED runtime blocks preflight", () => {
  const report = evaluateShadowObservationPreflight(passingPreflightInput({ evidenceRecoveryState: "RECOVERY_REQUIRED" }));
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.includes("EVIDENCE_RECOVERY_REQUIRED"));
});

// ------------------------------------ 3. private API / live capability blocks start

test("3: a detected private-API or live-trading capability blocks the start", () => {
  for (const [field, code] of [
    ["privateApiCapabilityPresent", "PRIVATE_API_CAPABILITY_PRESENT"],
    ["liveTradingCapabilityPresent", "LIVE_TRADING_CAPABILITY_PRESENT"],
    ["credentialStoragePresent", "CREDENTIAL_STORAGE_PRESENT"]
  ]) {
    const report = evaluateShadowObservationPreflight(passingPreflightInput({ [field]: true }));
    assert.equal(report.status, "BLOCKED", field);
    assert.ok(report.blockers.includes(code), `${field}: ${JSON.stringify(report.blockers)}`);
  }
});

test("3b: an undeclared capability scan method blocks the start", () => {
  // "I did not say how I checked" must not read the same as "I checked and it was clean".
  const report = evaluateShadowObservationPreflight(passingPreflightInput({ capabilityScanMethod: "" }));
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.blockers.includes("CAPABILITY_SCAN_METHOD_UNDECLARED"));
});

// ------------------------------------------- 4. non-zero mutation counters block

test("4: any non-zero mutation counter blocks the start", () => {
  const fields = [
    ["actualBrokerCallCount", "BROKER_MUTATION:1"],
    ["actualOrderCount", "ORDER_MUTATION:1"],
    ["actualFillCount", "FILL_MUTATION:1"],
    ["cashMutationCount", "CASH_MUTATION:1"],
    ["positionMutationCount", "POSITION_MUTATION:1"],
    ["privateApiCallCount", "PRIVATE_API_CALLS:1"]
  ];
  for (const [field, code] of fields) {
    const base = passingPreflightInput();
    const report = evaluateShadowObservationPreflight({ ...base, mutationCounters: { ...base.mutationCounters, [field]: 1 } });
    assert.equal(report.status, "BLOCKED", field);
    assert.ok(report.blockers.includes(code), `${field}: ${JSON.stringify(report.blockers)}`);
  }
});

test("4b: a busy runtime, an unwritable archive, or an implausible clock blocks the start", () => {
  assert.ok(evaluateShadowObservationPreflight(passingPreflightInput({ runtimeState: "RUNNING" })).blockers.includes("RUNTIME_NOT_STARTABLE:RUNNING"));
  assert.ok(evaluateShadowObservationPreflight(passingPreflightInput({ evidenceArchiveWritable: false })).blockers.includes("EVIDENCE_ARCHIVE_NOT_WRITABLE"));
  assert.ok(evaluateShadowObservationPreflight(passingPreflightInput({ evidenceSinkReady: false })).blockers.includes("EVIDENCE_SINK_NOT_READY"));
  assert.ok(evaluateShadowObservationPreflight(passingPreflightInput({ now: 0 })).blockers.includes("CLOCK_IMPLAUSIBLE"));
  assert.ok(evaluateShadowObservationPreflight(passingPreflightInput({ configuredMarket: "KRW-ETH" })).blockers.includes("MARKET_MISMATCH:KRW-ETH"));
  assert.ok(evaluateShadowObservationPreflight(passingPreflightInput({ closedCandlesOnly: false })).blockers.includes("CLOSED_CANDLES_NOT_ENFORCED"));
  // A queue larger than the profile allows would weaken A3's bound.
  assert.ok(evaluateShadowObservationPreflight(passingPreflightInput({ busCapacity: 5_000 })).blockers.includes("QUEUE_CAPACITY_EXCEEDS_PROFILE:5000"));
});

// --------------------------------------------------- 5. an unclosed candle is refused

test("5: an in-progress candle never reaches the strategy", () => {
  // The adapter only ever emits closed:true candles, so this asserts the property at the one
  // place a non-closed candle could enter: the runtime's own admission gate.
  const seen = [];
  const h = makeRuntime({ onProductionSignal: (input) => seen.push(input) });
  h.warmUp();
  h.runtime.start();
  const before = seen.length;
  h.candles(2, () => 300);
  assert.ok(seen.length > before, "a closed candle must reach the production path");
  for (const entry of seen) assert.equal(typeof entry.price, "number");
  assert.equal(h.runtime.diagnostics().inputType, "CLOSED_CANDLE");
});

// ------------------------------------------------- 6. duplicate candle handled safely

test("6: a duplicate closed candle is counted and dropped, not dispatched twice", async () => {
  const h = makeRuntime();
  h.warmUp();
  h.runtime.start();
  // Two candles from the ticker stream, closing minutes 22 and 23.
  h.candles(2, () => 900);
  const afterFirst = h.runtime.diagnostics();
  assert.ok(afterFirst.signalCount >= 1, "the first pass must produce a signal to make the replay meaningful");

  // The already-observed minute, now arriving again from the official-candle backfill. The
  // two sources each de-duplicate within themselves and keep independent high-water marks, so
  // neither notices the other -- the runtime's own gate is the only thing that catches this.
  const replayed = afterFirst.lastClosedCandleTime;
  await h.officialCandles([h.closedCandle(21, 900)]);

  const after = h.runtime.diagnostics();
  assert.notEqual(after.state, "FAILED");
  assert.equal(after.duplicateCandleCount, 1, JSON.stringify(after.blockers));
  assert.equal(after.lastClosedCandleTime, replayed, "the replay covered the minute already observed");
  assert.equal(after.signalCount, afterFirst.signalCount, "a replayed candle must not produce a second signal");
});

// --------------------------------------------- 7. candle sequence regression halts

test("7: a closed candle arriving out of order halts the session", async () => {
  const h = makeRuntime();
  h.warmUp();
  h.runtime.start();
  h.candles(4, (index) => 300 + index * 100);
  assert.equal(h.runtime.diagnostics().state, "RUNNING", JSON.stringify(h.runtime.diagnostics().blockers));

  // A candle from well before the last one Shadow accepted, arriving from the official
  // backfill -- a route with its own independent high-water mark, so nothing upstream stops
  // it. Ordering being broken puts every later candle's position in the sequence in doubt.
  await h.officialCandles([h.closedCandle(10, 250)]);

  const after = h.runtime.diagnostics();
  assert.equal(after.state, "HALTED", JSON.stringify(after.blockers));
  assert.ok(after.blockers.includes("CANDLE_SEQUENCE_REGRESSION"), JSON.stringify(after.blockers));
  assert.equal(after.outOfOrderCandleCount, 1);
});

test("7b: a stale closed candle is counted and dropped without halting", async () => {
  const h = makeRuntime({ maxCandleAgeMs: 3 * MINUTE });
  h.warmUp();
  h.runtime.start();
  // The candle closes at minute 22 but the clock reads minute 40: eighteen minutes stale.
  h.setNow(CLOCK + 40 * MINUTE);
  await h.officialCandles([h.closedCandle(21, 300)]);

  const after = h.runtime.diagnostics();
  assert.equal(after.staleCandleCount, 1, JSON.stringify(after.blockers));
  assert.equal(after.state, "RUNNING", "a single stale candle is a bad input, not a broken stream");
});

// ---------------------------------------------------------- 8. queue overflow halts

test("8: queue overflow halts the session", () => {
  const stalled = { name: "stalled", deliver: () => new Promise(() => {}) };
  const h = makeRuntime({ sinks: [stalled], capacity: 1 });
  h.warmUp();
  h.runtime.start();
  h.candles(8, (index) => 100 + index * 200);
  const after = h.runtime.diagnostics();
  assert.equal(after.state, "HALTED", JSON.stringify(after.blockers));
  assert.ok(after.blockers.some((blocker) => blocker.includes("QUEUE_OVERFLOW")), JSON.stringify(after.blockers));
});

// ---------------------------------------------------------- 9. writer failure halts

test("9: a durable writer failure halts the session", async () => {
  const exploding = { name: "exploding", deliver: () => { throw new Error("writer exploded"); } };
  const h = makeRuntime({ sinks: [exploding] });
  h.warmUp();
  h.runtime.start();
  await new Promise((resolve) => setImmediate(resolve));
  const after = h.runtime.diagnostics();
  assert.equal(after.state, "HALTED", JSON.stringify(after.blockers));
  assert.ok(after.blockers.some((blocker) => blocker.includes("SINK_WRITE_FAILED")), JSON.stringify(after.blockers));
});

// ------------------------------------------- 10. session ceiling stops the session

test("10: passing the maximum session duration stops the session as a normal completion", () => {
  const h = makeRuntime({ maxSessionDurationMs: 5 * MINUTE });
  h.warmUp();
  h.runtime.start();
  assert.equal(h.runtime.diagnostics().state, "RUNNING");
  assert.equal(h.runtime.diagnostics().maxSessionDurationMs, 5 * MINUTE);

  h.candles(2, () => 300);
  assert.equal(h.runtime.diagnostics().state, "RUNNING", "still inside the ceiling");

  // Now cross the ceiling: each candle advances the simulated clock by one minute.
  h.candles(6, (index) => 300 + index * 100);
  const after = h.runtime.diagnostics();
  // COMPLETED, not HALTED: reaching a planned limit is the design working, and sealing it as
  // a fault would make an ordinary ending look like a failure in the evidence record.
  assert.equal(after.state, "COMPLETED", JSON.stringify(after.blockers));
  assert.deepEqual([...after.blockers], ["MAX_SESSION_DURATION_REACHED"]);
  assert.ok(after.elapsedMs >= 5 * MINUTE);
});

test("10a: the session ceiling is a safe normal completion, not a precheck failure", async () => {
  const h = makeRuntime({ maxSessionDurationMs: 5 * MINUTE });
  h.warmUp();
  h.runtime.start();
  h.candles(8, (index) => 300 + index * 100);
  const diagnostics = h.runtime.diagnostics();
  const summary = buildShadowObservationSummary({
    diagnostics,
    evidence: { status: "OPEN", haltReason: null, published: 3, delivered: 3, duplicatesDropped: 0, highWaterMark: 1 },
    verification: { status: "PASS", blockers: [], actualBrokerCalls: 0, actualOrders: 0, actualFills: 0, cashMutations: 0, positionMutations: 0 },
    completionMarker: "COMPLETED", evidenceRecoveryState: "NONE", privateApiCallCount: 0, endedAt: CLOCK + 8 * MINUTE
  });
  assert.equal(diagnostics.state, "COMPLETED");
  assert.equal(summary.completionReason, "MAX_SESSION_DURATION_REACHED");
  assert.equal(summary.safeCompletion, "SAFE_COMPLETION");
  assert.equal(summary.executionGateCallCount, 0);
  assert.equal(summary.brokerCallCount, 0);
  assert.ok(!summary.verdictReasons.some((reason) => reason.includes("PRECHECK")));
});

test("10b: with no ceiling configured the session runs on, exactly as before A4", () => {
  const h = makeRuntime();
  h.warmUp();
  h.runtime.start();
  h.candles(60, (index) => 300 + index * 10);
  assert.equal(h.runtime.diagnostics().state, "RUNNING", JSON.stringify(h.runtime.diagnostics().blockers));
  assert.equal(h.runtime.diagnostics().maxSessionDurationMs, null);
  assert.ok(h.runtime.diagnostics().elapsedMs > 30 * MINUTE, "well past what the A4 ceiling would have allowed");
});

// --------------------------------- 11-16. end-to-end via the real smoke runner

test("11-16: the smoke run verifies PASS, seals a COMPLETED marker, and mutates nothing", async (t) => {
  const parent = await fsp.mkdtemp(path.join(os.tmpdir(), "a4-smoke-"));
  t.after(() => fsp.rm(parent, { recursive: true, force: true }));
  const { preflight, summary, archiveDirectory } = await runShadowObservationSmoke({ root: path.join(parent, "shadow-evidence"), candleCount: 6 });

  // 1: preflight PASS against a real repository scan.
  assert.equal(preflight.status, "PASS", JSON.stringify(preflight.blockers));

  // 11: verifier PASS after a normal stop.
  assert.equal(summary.evidenceVerification, "PASS", JSON.stringify(summary.verdictReasons));
  // 12: completion marker present.
  assert.equal(summary.completionMarker, "COMPLETED");
  assert.equal(summary.runtimeFinalState, "COMPLETED");

  // The smoke conditions the WO asks for.
  assert.ok(summary.candleCount >= 3, `expected at least 3 candles, got ${summary.candleCount}`);
  assert.ok(summary.signalCount >= 1, `expected at least 1 signal, got ${summary.signalCount}`);
  assert.equal(summary.publishedEvents, summary.deliveredEvents, "every published event must be delivered");
  assert.equal(summary.duplicateEvents, 0);

  // 15/16: private API calls and every mutation counter are zero.
  assert.equal(summary.privateApiCalls, 0);
  assert.equal(summary.brokerMutation, 0);
  assert.equal(summary.orderMutation, 0);
  assert.equal(summary.fillMutation, 0);
  assert.equal(summary.cashMutation, 0);
  assert.equal(summary.positionMutation, 0);

  // 14: a summary is produced, and it renders without leaking a path.
  const rendered = formatShadowObservationSummary(summary);
  assert.match(rendered, /\[A4 Shadow Observation Summary\]/);
  assert.match(rendered, /- final verdict: PASS/);
  assert.equal(/\/home\/|\/Users\/|[A-Za-z]:\\/.test(rendered), false, "the summary must not contain an absolute user path");
  assert.equal(rendered.includes(archiveDirectory), false, "the summary must not contain the archive path");

  assert.equal(summary.verdict, "PASS", JSON.stringify(summary.verdictReasons));
});

test("13: a failed session is never reported as a completed one", () => {
  const failing = {
    diagnostics: {
      state: "HALTED", sessionId: "s1", symbol: SYMBOL, blockers: ["EVIDENCE_SINK_WRITE_FAILED"],
      closedCandleCount: 5, duplicateCandleCount: 0, staleCandleCount: 0, outOfOrderCandleCount: 0,
      signalCount: 1, startedAt: CLOCK, actualBrokerCallCount: 0, actualOrderCount: 0,
      actualFillCount: 0, cashMutationCount: 0, positionMutationCount: 0
    },
    evidence: { status: "HALTED", haltReason: "SINK_WRITE_FAILED", published: 3, delivered: 2, duplicatesDropped: 0, highWaterMark: 2 },
    verification: null,
    completionMarker: "ABORTED",
    evidenceRecoveryState: "NONE",
    privateApiCallCount: 0,
    endedAt: CLOCK + MINUTE
  };
  const summary = buildShadowObservationSummary(failing);
  assert.equal(summary.verdict, "FAIL");
  assert.ok(summary.verdictReasons.includes("RUNTIME_FINAL_STATE:HALTED"), JSON.stringify(summary.verdictReasons));
  assert.ok(summary.verdictReasons.includes("EVIDENCE_NOT_VERIFIED"), JSON.stringify(summary.verdictReasons));
  assert.ok(summary.verdictReasons.includes("COMPLETION_MARKER:ABORTED"), JSON.stringify(summary.verdictReasons));
});

test("13b: an unverified archive can never reach PASS, even when everything else is clean", () => {
  const clean = {
    diagnostics: {
      state: "COMPLETED", sessionId: "s1", symbol: SYMBOL, blockers: [],
      closedCandleCount: 5, duplicateCandleCount: 0, staleCandleCount: 0, outOfOrderCandleCount: 0,
      signalCount: 1, startedAt: CLOCK, actualBrokerCallCount: 0, actualOrderCount: 0,
      actualFillCount: 0, cashMutationCount: 0, positionMutationCount: 0
    },
    evidence: { status: "OPEN", haltReason: null, published: 3, delivered: 3, duplicatesDropped: 0, highWaterMark: 1 },
    verification: null,
    completionMarker: "COMPLETED",
    evidenceRecoveryState: "NONE",
    privateApiCallCount: 0,
    endedAt: CLOCK + MINUTE
  };
  assert.equal(buildShadowObservationSummary(clean).verdict, "FAIL");
  // The same run with a real PASS verification is the only way through.
  const verified = { ...clean, verification: { status: "PASS", blockers: [], actualBrokerCalls: 0, actualOrders: 0, actualFills: 0, cashMutations: 0, positionMutations: 0 } };
  assert.equal(buildShadowObservationSummary(verified).verdict, "PASS");
});

test("13c: a mutation recorded only in the archive still fails the run", () => {
  // The runtime's own counters and the re-read archive are independent witnesses. Trusting
  // one alone would let a mutating session pass on the strength of the other's silence.
  const summary = buildShadowObservationSummary({
    diagnostics: {
      state: "COMPLETED", sessionId: "s1", symbol: SYMBOL, blockers: [],
      closedCandleCount: 5, duplicateCandleCount: 0, staleCandleCount: 0, outOfOrderCandleCount: 0,
      signalCount: 1, startedAt: CLOCK, actualBrokerCallCount: 0, actualOrderCount: 0,
      actualFillCount: 0, cashMutationCount: 0, positionMutationCount: 0
    },
    evidence: { status: "OPEN", haltReason: null, published: 3, delivered: 3, duplicatesDropped: 0, highWaterMark: 1 },
    verification: { status: "PASS", blockers: [], actualBrokerCalls: 0, actualOrders: 2, actualFills: 0, cashMutations: 0, positionMutations: 0 },
    completionMarker: "COMPLETED",
    evidenceRecoveryState: "NONE",
    privateApiCallCount: 0,
    endedAt: CLOCK + MINUTE
  });
  assert.equal(summary.verdict, "FAIL");
  assert.ok(summary.verdictReasons.includes("MUTATION_ARCHIVE_ORDER:2"), JSON.stringify(summary.verdictReasons));
});

test("SAFE_COMPLETION is never reported when a mutation counter is non-zero", () => {
  const summary = buildShadowObservationSummary({
    diagnostics: { state: "COMPLETED", sessionId: "s-mutation", symbol: SYMBOL, blockers: ["MAX_SESSION_DURATION_REACHED"], closedCandleCount: 5, duplicateCandleCount: 0, staleCandleCount: 0, outOfOrderCandleCount: 0, signalCount: 1, startedAt: CLOCK, actualBrokerCallCount: 1, executionGateCallCount: 0, actualOrderCount: 0, actualFillCount: 0, cashMutationCount: 0, positionMutationCount: 0 },
    evidence: { status: "OPEN", haltReason: null, published: 3, delivered: 3, duplicatesDropped: 0, highWaterMark: 1 },
    verification: { status: "PASS", blockers: [], actualBrokerCalls: 1, actualOrders: 0, actualFills: 0, cashMutations: 0, positionMutations: 0 },
    completionMarker: "COMPLETED", evidenceRecoveryState: "NONE", privateApiCallCount: 0, endedAt: CLOCK + MINUTE
  });
  assert.equal(summary.safeCompletion, "NOT_SAFE_COMPLETION");
  assert.notEqual(summary.verdict, "PASS");
});

test("13d: a RECOVERY_REQUIRED run reports RECOVERY_REQUIRED, not FAIL", () => {
  const summary = buildShadowObservationSummary({
    diagnostics: {
      state: "HALTED", sessionId: null, symbol: SYMBOL, blockers: ["EVIDENCE_RECOVERY_REQUIRED"],
      closedCandleCount: 0, duplicateCandleCount: 0, staleCandleCount: 0, outOfOrderCandleCount: 0,
      signalCount: 0, startedAt: null, actualBrokerCallCount: 0, actualOrderCount: 0,
      actualFillCount: 0, cashMutationCount: 0, positionMutationCount: 0
    },
    evidence: null,
    verification: null,
    completionMarker: "NONE",
    evidenceRecoveryState: "RECOVERY_REQUIRED",
    privateApiCallCount: 0,
    endedAt: CLOCK
  });
  assert.equal(summary.verdict, "RECOVERY_REQUIRED");
});

test("the smoke runner refuses to write evidence into the repository", async () => {
  await assert.rejects(
    () => runShadowObservationSmoke({ root: path.join(__dirname, "..", "scratch-evidence") }),
    /refuses to write evidence inside the repository/
  );
});

test("the smoke runner opens no socket and names no private endpoint", () => {
  const fs = require("node:fs");
  const raw = fs.readFileSync(path.join(__dirname, "..", "scripts", "lib", "shadow-observation-smoke.js"), "utf8");
  // Comments are stripped first. The file's own header lists what it must not do, and a
  // check that reads prose would fail on the sentence promising the very thing it verifies.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // `onWebSocketStatus` survives -- it is the runtime's own connection-status callback,
  // called with a literal string. What must be absent is anything that could open a
  // connection, name a private endpoint, or touch the broker.
  for (const forbidden of ["node:http", "node:https", "node:net", "node:tls", "WebSocket(", "fetch(", "api.upbit.com", "access_key", "secret_key", "UpbitWebSocketClient", "UpbitMinuteCandleSource", "PaperBroker"]) {
    assert.equal(code.includes(forbidden), false, `smoke runner must not reference ${forbidden}`);
  }
});
