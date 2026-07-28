const test = require("node:test");
const assert = require("node:assert/strict");
const { ShadowPilotRuntime, verifyShadowPilotEvents, createShadowPilotEventVerifier } = require("../dist/apps/desktop/src/shadowPilotRuntime.js");

const COMMIT = "a".repeat(40);
const FINGERPRINTS = { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" };

function startedPilot(sessionId = "verifier-test") {
  const pilot = new ShadowPilotRuntime({ sessionId, createdAt: 0, sourceCommitSha: COMMIT, symbol: "KRW-BTC", strategyId: "sma-crossover", fingerprints: FINGERPRINTS });
  pilot.precheck({ paperOnly: true, deploymentIntegrity: true, reconciliation: true, killSwitch: false, openP0: false, marketDataHealthy: true, warmedUp: true, automaticTrading: false });
  pilot.start(0);
  return pilot;
}

const observe = (pilot, index, decision = "ALLOW") =>
  pilot.observe({ timestamp: index, signalId: `s${index}`, commandId: `c${index}`, side: "BUY", quantity: 0.001, decision, reasonCodes: [] });

test("the incremental verifier agrees with the full one at every step of a growing log", () => {
  // The saving is only worth anything if the answer is identical. Checked on every prefix,
  // not just the final state, because the incremental path is what runs on every signal.
  const pilot = startedPilot();
  const incremental = createShadowPilotEventVerifier();
  for (let index = 1; index <= 60; index += 1) {
    observe(pilot, index, index % 7 === 0 ? "REJECT" : "ALLOW");
    const events = pilot.eventLog();
    assert.deepEqual(
      [...incremental.verify(events, COMMIT)],
      [...verifyShadowPilotEvents(events, COMMIT)],
      `disagreement after ${index} signals`
    );
  }
  assert.deepEqual([...incremental.verify(pilot.eventLog(), COMMIT)], []);
});

test("a missing source commit is reported the same way by both", () => {
  const pilot = startedPilot();
  observe(pilot, 1);
  const incremental = createShadowPilotEventVerifier();
  const events = pilot.eventLog();
  assert.deepEqual([...incremental.verify(events, "")], [...verifyShadowPilotEvents(events, "")]);
  // Recoverable state: the same verifier still answers correctly once the commit is supplied.
  assert.deepEqual([...incremental.verify(events, COMMIT)], []);
});

test("KNOWN GAP: a mid-log substitution behind the boundary is not caught incrementally", () => {
  // This records a real limit rather than asserting a capability the design does not have.
  // The boundary check reads the stored hash of the last verified event; it does not
  // re-derive it, so replacing an earlier event while length and tail are unchanged slips
  // past. Closing it would mean re-hashing the whole log, which is the cost being avoided.
  const pilot = startedPilot();
  for (let index = 1; index <= 10; index += 1) observe(pilot, index);
  const incremental = createShadowPilotEventVerifier();
  assert.deepEqual([...incremental.verify(pilot.eventLog(), COMMIT)], []);

  const tampered = Object.freeze(pilot.eventLog().map((event, index) => index === 4 ? { ...event, timestamp: event.timestamp + 1 } : event));

  // The full verifier does catch it -- and it is the one that runs before a session is
  // sealed, so no session is certified on incremental evidence alone.
  assert.ok(verifyShadowPilotEvents(tampered, COMMIT).includes("EVENT_HASH_MISMATCH"), "the full verifier must catch it");
  // The incremental one does not, and this test exists so that stays a measured fact.
  assert.deepEqual([...incremental.verify(tampered, COMMIT)], [], "documented gap: substitution behind the verified boundary");
});

test("a replaced TAIL is caught, because the boundary hash no longer matches", () => {
  const pilot = startedPilot();
  for (let index = 1; index <= 10; index += 1) observe(pilot, index);
  const incremental = createShadowPilotEventVerifier();
  incremental.verify(pilot.eventLog(), COMMIT);

  const events = pilot.eventLog();
  const tampered = Object.freeze(events.map((event, index) => index === events.length - 1 ? { ...event, timestamp: event.timestamp + 1 } : event));
  const result = incremental.verify(tampered, COMMIT);
  assert.deepEqual([...result], [...verifyShadowPilotEvents(tampered, COMMIT)]);
  assert.ok(result.includes("EVENT_HASH_MISMATCH"), JSON.stringify(result));
});

test("a truncated log discards the remembered prefix instead of trusting it", () => {
  const pilot = startedPilot();
  for (let index = 1; index <= 10; index += 1) observe(pilot, index);
  const incremental = createShadowPilotEventVerifier();
  incremental.verify(pilot.eventLog(), COMMIT);

  // Fewer events than were verified: the boundary no longer exists, so the fast path must
  // not be taken on a prefix this verifier never saw in this shape.
  const truncated = Object.freeze(pilot.eventLog().slice(0, 4));
  assert.deepEqual([...incremental.verify(truncated, COMMIT)], [...verifyShadowPilotEvents(truncated, COMMIT)]);
});

test("a different session's log is verified from scratch, not against the old boundary", () => {
  const first = startedPilot("session-one");
  for (let index = 1; index <= 8; index += 1) observe(first, index);
  const incremental = createShadowPilotEventVerifier();
  incremental.verify(first.eventLog(), COMMIT);

  const second = startedPilot("session-two");
  for (let index = 1; index <= 8; index += 1) observe(second, index);
  assert.deepEqual([...incremental.verify(second.eventLog(), COMMIT)], [...verifyShadowPilotEvents(second.eventLog(), COMMIT)]);
  assert.deepEqual([...incremental.verify(second.eventLog(), COMMIT)], []);
});

test("a fault found early keeps being reported as the log grows", () => {
  // A verifier that only looked at the tail would report a broken chain once and then go
  // quiet, which is worse than never having checked.
  const pilot = startedPilot();
  for (let index = 1; index <= 5; index += 1) observe(pilot, index);
  const broken = [...pilot.eventLog()];
  broken[2] = { ...broken[2], reasonCodes: Object.freeze(["TAMPERED"]) };

  const incremental = createShadowPilotEventVerifier();
  const firstPass = incremental.verify(Object.freeze(broken), COMMIT);
  assert.ok(firstPass.includes("EVENT_HASH_MISMATCH"));

  // Append more valid-looking events after the damage and re-verify.
  for (let index = 6; index <= 12; index += 1) observe(pilot, index);
  const grown = Object.freeze([...broken, ...pilot.eventLog().slice(broken.length)]);
  const secondPass = incremental.verify(grown, COMMIT);
  assert.ok(secondPass.includes("EVENT_HASH_MISMATCH"), "the earlier fault must still be reported");
  assert.deepEqual([...secondPass], [...verifyShadowPilotEvents(grown, COMMIT)]);
});

test("verification cost per signal stops growing with the log", () => {
  // The property that matters, asserted rather than described: with the full verifier the
  // per-signal cost rises with N; with this one it must not.
  const measure = (signals) => {
    const pilot = startedPilot();
    const incremental = createShadowPilotEventVerifier();
    const started = process.hrtime.bigint();
    for (let index = 1; index <= signals; index += 1) {
      observe(pilot, index);
      incremental.verify(pilot.eventLog(), COMMIT);
    }
    return Number(process.hrtime.bigint() - started) / 1e6 / signals;
  };

  const small = measure(200);
  const large = measure(1600);
  // An 8x longer log must not cost meaningfully more per signal. The bound is loose because
  // this runs on shared CI hardware; the failure it guards against is quadratic growth,
  // which showed a ~10x rise over this range before the change.
  assert.ok(large < small * 4, `per-signal cost grew from ${small.toFixed(4)}ms to ${large.toFixed(4)}ms`);
});
