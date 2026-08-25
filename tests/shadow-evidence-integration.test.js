const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { StrategyEngine, SmaCrossoverStrategy } = require("../dist/apps/desktop/src/strategy/strategyEngine.js");
const { ShadowOperationalRuntime } = require("../dist/apps/desktop/src/shadow/shadowOperationalRuntime.js");
const { ShadowEvidenceBus, InMemoryEvidenceSink, DurableEvidenceSink } = require("../dist/apps/desktop/src/shadow/shadowEvidenceBus.js");
const { ShadowEvidenceArchive, verifyShadowEvidenceDirectory, findIncompleteShadowArchives } = require("../dist/apps/desktop/src/shadow/shadowEvidenceArchive.js");

const SYMBOL = "KRW-BTC";
const MINUTE = 60_000;
const COMMIT = "a".repeat(40);

/** A sink that records deliveries and can be told to fail on a chosen sequence. */
function recordingSink(options = {}) {
  const delivered = [];
  let finalizedAs = null;
  return {
    name: options.name || "recording",
    delivered,
    finalStatus: () => finalizedAs,
    deliver(event) {
      if (options.failOnSequence === event.sequence) throw new Error(`writer exploded on ${event.sequence}`);
      delivered.push(event);
    },
    finalize(_reason, status) {
      if (options.failFinalize) throw new Error("finalize exploded");
      finalizedAs = status;
    },
    flush() {
      if (options.failFlush) throw new Error("flush exploded");
    }
  };
}

function makeRuntime(overrides = {}) {
  const strategy = new StrategyEngine(new SmaCrossoverStrategy(5, 20));
  strategy.start();
  let now = 0;
  const buses = [];
  const runtime = new ShadowOperationalRuntime({
    symbol: SYMBOL,
    strategyId: "sma-crossover",
    sourceCommitSha: COMMIT,
    fingerprints: { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" },
    strategy,
    getPositionQuantity: () => 0,
    onProductionSignal: () => {},
    riskGate: { evaluate: () => ({ status: "ALLOW", reasonCodes: [] }) },
    getHypotheticalOrderQuantity: () => 0.001,
    getSafetyState: () => ({
      deploymentIntegrity: true, reconciliation: true, killSwitch: false,
      openP0: false, automaticTrading: false, currentModeIsCanaryOrExtended: false
    }),
    now: () => now,
    createEvidenceBus: overrides.createEvidenceBus || (({ sessionId, onHalt }) => {
      const bus = new ShadowEvidenceBus({ sessionId, sinks: overrides.sinks || [], capacity: overrides.capacity, onHalt });
      buses.push(bus);
      return bus;
    }),
    findIncompleteEvidence: overrides.findIncompleteEvidence || (() => [])
  });
  return {
    runtime, buses,
    setNow: (value) => { now = value; },
    warmUp: () => {
      runtime.onWebSocketStatus("connected");
      for (let minute = 0; minute <= 20; minute += 1) {
        now = minute * MINUTE;
        runtime.onTicker({ code: SYMBOL, trade_price: 100, trade_timestamp: minute * MINUTE, trade_volume: 1, trade_id: `w-${minute}` });
      }
    },
    crossover: (minute, price) => {
      now = minute * MINUTE;
      runtime.onTicker({ code: SYMBOL, trade_price: price, trade_timestamp: minute * MINUTE, trade_volume: 1, trade_id: `x-${minute}a` });
      now = (minute + 1) * MINUTE;
      runtime.onTicker({ code: SYMBOL, trade_price: price, trade_timestamp: (minute + 1) * MINUTE, trade_volume: 1, trade_id: `x-${minute}b` });
    }
  };
}

test("every pilot event reaches the sinks exactly once, in order", async () => {
  const memory = new InMemoryEvidenceSink();
  const recorder = recordingSink();
  const h = makeRuntime({ sinks: [memory, recorder] });
  h.warmUp();
  h.runtime.start();
  h.crossover(21, 300);
  h.runtime.stop();
  await h.runtime.awaitEvidenceFinalized();

  const sequences = recorder.delivered.map((event) => event.sequence);
  assert.deepEqual(sequences, [...new Set(sequences)], "no sequence delivered twice");
  assert.deepEqual(sequences, sequences.slice().sort((a, b) => a - b), "delivered in order");
  assert.deepEqual(memory.snapshot(), recorder.delivered, "both sinks receive the same canonical events");
  assert.equal(recorder.delivered[0].eventType, "SESSION_STARTED");
  assert.equal(recorder.delivered.at(-1).eventType, "SESSION_STOPPED");
  assert.equal(h.runtime.evidenceDiagnostics().duplicatesDropped, 0);
});

test("re-publishing an already-accepted sequence is dropped rather than written twice", async () => {
  const recorder = recordingSink();
  const bus = new ShadowEvidenceBus({ sessionId: "s1", sinks: [recorder] });
  const event = { sequence: 1, sessionId: "s1", eventType: "SESSION_STARTED" };
  assert.equal(bus.publish(event), true);
  assert.equal(bus.publish(event), true, "a duplicate is accepted-and-ignored, not an error");
  await bus.flush();
  assert.equal(recorder.delivered.length, 1);
  assert.equal(bus.diagnostics().duplicatesDropped, 1);
  assert.equal(bus.diagnostics().delivered, 1);
});

test("the queue is bounded and overflow halts instead of dropping an event", async () => {
  // A sink that never resolves keeps the queue from draining, so capacity is reached.
  const stalled = { name: "stalled", deliver: () => new Promise(() => {}) };
  const bus = new ShadowEvidenceBus({ sessionId: "s1", sinks: [stalled], capacity: 2 });
  assert.equal(bus.publish({ sequence: 1, sessionId: "s1" }), true);
  assert.equal(bus.publish({ sequence: 2, sessionId: "s1" }), true);
  assert.equal(bus.publish({ sequence: 3, sessionId: "s1" }), false, "third must be refused, not silently dropped");
  const diagnostics = bus.diagnostics();
  assert.equal(diagnostics.status, "HALTED");
  assert.equal(diagnostics.haltReason, "QUEUE_OVERFLOW");
  assert.equal(diagnostics.queueCapacity, 2);
  // The refused event was never accepted, so it cannot later be delivered as a phantom.
  assert.equal(diagnostics.published, 2);
});

test("a writer failure halts the bus and leaves the failed event undelivered", async () => {
  const recorder = recordingSink({ failOnSequence: 2 });
  const bus = new ShadowEvidenceBus({ sessionId: "s1", sinks: [recorder] });
  bus.publish({ sequence: 1, sessionId: "s1" });
  bus.publish({ sequence: 2, sessionId: "s1" });
  bus.publish({ sequence: 3, sessionId: "s1" });
  await bus.flush();
  const diagnostics = bus.diagnostics();
  assert.equal(diagnostics.status, "HALTED");
  assert.equal(diagnostics.haltReason, "SINK_WRITE_FAILED");
  assert.match(diagnostics.haltDetail, /writer exploded on 2/);
  assert.deepEqual(recorder.delivered.map((e) => e.sequence), [1], "nothing after the failure is delivered");
});

test("a halted bus never accepts another event", () => {
  const bus = new ShadowEvidenceBus({ sessionId: "s1", sinks: [{ name: "x", deliver: () => new Promise(() => {}) }], capacity: 1 });
  bus.publish({ sequence: 1, sessionId: "s1" });
  assert.equal(bus.publish({ sequence: 2, sessionId: "s1" }), false);
  assert.equal(bus.publish({ sequence: 3, sessionId: "s1" }), false, "still refused after halting");
});

test("a writer failure inside a running session halts the runtime", async () => {
  const h = makeRuntime({ sinks: [recordingSink({ failOnSequence: 2 })] });
  h.warmUp();
  h.runtime.start();
  assert.equal(h.runtime.diagnostics().state, "RUNNING");
  h.crossover(21, 300);
  await h.runtime.awaitEvidenceFinalized();
  const diagnostics = h.runtime.diagnostics();
  assert.equal(diagnostics.state, "HALTED", "a broken archive must stop the session");
  assert.ok(diagnostics.blockers.some((b) => b.includes("SINK_WRITE_FAILED")), JSON.stringify(diagnostics.blockers));
});

test("a sink flush failure halts the runtime and seals the session as ABORTED", async () => {
  const recorder = recordingSink({ failFlush: true });
  const h = makeRuntime({ sinks: [recorder] });
  h.warmUp();
  h.runtime.start();
  h.runtime.stop();
  await h.runtime.awaitEvidenceFinalized();
  assert.equal(h.runtime.diagnostics().state, "HALTED");
  assert.equal(h.runtime.evidenceDiagnostics().haltReason, "SINK_FLUSH_FAILED");
  assert.equal(recorder.finalStatus(), "ABORTED");
});

test("queue overflow inside a running session halts the runtime", async () => {
  const h = makeRuntime({ sinks: [{ name: "stalled", deliver: () => new Promise(() => {}) }], capacity: 1 });
  h.warmUp();
  h.runtime.start();
  h.crossover(21, 300);
  const diagnostics = h.runtime.diagnostics();
  assert.equal(diagnostics.state, "HALTED");
  assert.ok(diagnostics.blockers.some((b) => b.includes("QUEUE_OVERFLOW")), JSON.stringify(diagnostics.blockers));
});

test("stop finalizes the sinks exactly once as COMPLETED", async () => {
  const recorder = recordingSink();
  const h = makeRuntime({ sinks: [recorder] });
  h.warmUp();
  h.runtime.start();
  h.runtime.stop();
  await h.runtime.awaitEvidenceFinalized();
  assert.equal(recorder.finalStatus(), "COMPLETED");
  assert.equal(h.runtime.evidenceDiagnostics().finalized, true);
});

test("a halted session finalizes as ABORTED, not COMPLETED", async () => {
  const recorder = recordingSink();
  const h = makeRuntime({ sinks: [recorder] });
  h.warmUp();
  h.runtime.start();
  h.runtime.onWebSocketStatus("reconnect-exhausted");
  await h.runtime.awaitEvidenceFinalized();
  assert.equal(h.runtime.diagnostics().state, "HALTED");
  assert.equal(recorder.finalStatus(), "ABORTED", "a partial session must be sealed as aborted");
});

test("an incomplete archive from a previous process forces RECOVERY_REQUIRED and blocks start", () => {
  const h = makeRuntime({ sinks: [], findIncompleteEvidence: () => ["/evidence/shadow-previous"] });
  h.warmUp();
  const result = h.runtime.start();
  assert.equal(result.state, "HALTED");
  assert.ok(result.blockers.includes("EVIDENCE_RECOVERY_REQUIRED"), JSON.stringify(result.blockers));
  assert.equal(h.runtime.evidenceRecoveryState(), "RECOVERY_REQUIRED");
});

test("a previous session is never auto-continued: each start builds a fresh bus", async () => {
  const h = makeRuntime({ sinks: [recordingSink()] });
  h.warmUp();
  h.runtime.start();
  const first = h.runtime.diagnostics().sessionId;
  h.runtime.stop();
  await h.runtime.awaitEvidenceFinalized();
  assert.equal(h.buses.length, 1);
  // COMPLETED is terminal for this instance; there is no path back to RUNNING without a
  // brand-new runtime, which is what makes "no automatic continuation" structural.
  assert.throws(() => h.runtime.start(), /requires IDLE/);
  assert.ok(first);
});

test("a completed session is followed only by a new session identity", async () => {
  const first = makeRuntime({ sinks: [recordingSink()] });
  first.warmUp();
  first.runtime.start();
  const firstSessionId = first.runtime.diagnostics().sessionId;
  first.runtime.stop();
  await first.runtime.awaitEvidenceFinalized();

  const second = makeRuntime({ sinks: [recordingSink()] });
  second.warmUp();
  second.runtime.start();
  assert.notEqual(second.runtime.diagnostics().sessionId, firstSessionId);
});

test("end to end: the durable archive verifies PASS and records zero actual mutation", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "shadow-evidence-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  let archive;
  const h = makeRuntime({
      createEvidenceBus: ({ sessionId, createdAt, onHalt }) => {
      const pending = ShadowEvidenceArchive.create(root, {
        sessionId, createdAt, sourceCommitSha: COMMIT, symbol: SYMBOL,
        strategyId: "sma-crossover", strategyVersion: "sma-crossover:closed-candle-1m-v1",
        controlOrigin: "LOCAL_INTERACTIVE_UI", authenticatedOwner: false,
        fingerprints: { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" }
      }).then((created) => { archive = created; return created; });
      // The archive is created asynchronously; the sink awaits it before every write, so no
      // event can outrun directory creation.
      const writer = {
        append: async (event, receivedAt) => (await pending).append(event, receivedAt),
        finalize: async (reason, generatedAt, status) => (await pending).finalize(reason, generatedAt, status)
      };
      return new ShadowEvidenceBus({ sessionId, sinks: [new InMemoryEvidenceSink(), new DurableEvidenceSink(writer, () => 1_700_000_000_000)], onHalt });
    }
  });

  h.warmUp();
  h.runtime.start();
  h.crossover(21, 300);
  h.runtime.stop();
  await h.runtime.awaitEvidenceFinalized();

  assert.equal(h.runtime.diagnostics().state, "COMPLETED");
  const verification = await verifyShadowEvidenceDirectory(archive.directoryPath());
  assert.equal(verification.status, "PASS", JSON.stringify(verification.blockers));
  assert.equal(verification.actualBrokerCalls, 0);
  assert.equal(verification.actualOrders, 0);
  assert.equal(verification.actualFills, 0);
  assert.equal(verification.cashMutations, 0);
  assert.equal(verification.positionMutations, 0);
  assert.equal(verification.hashChainValid, true);
  assert.equal(verification.sequenceContinuous, true);
  // A sealed session leaves nothing for recovery to pick up.
  assert.deepEqual(await findIncompleteShadowArchives(root), []);
});
