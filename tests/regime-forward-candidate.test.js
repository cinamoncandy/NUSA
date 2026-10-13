const test = require("node:test");
const assert = require("node:assert/strict");
const { maskResearchEntry, evaluateRegimeCandidate } = require("../scripts/lib/regime-forward-candidate");
const signal = type => ({ type, timestamp: 21, confidence: 0.8, reason: "synthetic" });

test("research entry mask allows upward trends and blocks down/flat/unknown", () => {
  for (const step of [-1, 0]) assert.equal(maskResearchEntry(signal("BUY"), { price: 100 + 20 * step, timestamp: 21 }, Array.from({ length: 20 }, (_, i) => 100 + i * step)).type, "HOLD");
  assert.equal(maskResearchEntry(signal("BUY"), { price: 120, timestamp: 21 }, Array.from({ length: 20 }, (_, i) => 100 + i)).type, "BUY");
  assert.equal(maskResearchEntry(signal("BUY"), { price: 100, timestamp: 21 }, []).type, "HOLD");
});
test("entry mask preserves exits and holds verbatim; malformed buy prices fail closed", () => {
  for (const type of ["SELL", "HOLD"]) { const input = signal(type); assert.equal(maskResearchEntry(input, {}, []), input); }
  assert.throws(() => maskResearchEntry(signal("BUY"), { price: NaN, timestamp: 21 }, Array(20).fill(100)), /positive and finite/);
});
test("paired research uses deterministic canonical next-observation execution", () => {
  const points = Array.from({ length: 400 }, (_, i) => ({ timestamp: i * 3600000, close: 100 + 15 * Math.sin(i / 20) + i / 20 }));
  const config = { initialCash: 10000, orderQuantity: 1, feeRate: 0.0005 };
  const result = evaluateRegimeCandidate(points, config);
  assert.deepEqual(result, evaluateRegimeCandidate(points, config));
  for (const run of [result.candidate, result.comparator]) {
    assert.ok(run.decisions.some(d => d.outcome === "FILLED"));
    for (const decision of run.decisions.filter(d => d.outcome === "FILLED")) assert.ok(decision.executionTimestamp > decision.signalTimestamp);
  }
  const prefix = evaluateRegimeCandidate(points.slice(0, 200), config);
  assert.deepEqual(result.candidate.decisions.slice(0, 198), prefix.candidate.decisions.slice(0, 198));
});
