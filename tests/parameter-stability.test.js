const test = require("node:test");
const assert = require("node:assert/strict");
const { runParameterStability } = require("../dist/apps/desktop/src/strategy/parameterStability.js");

class RoundTrip {
  constructor(id) { this.id = id; this.name = id; this.index = 0; }
  onTick(tick) {
    this.index += 1;
    return { type: this.index === 1 ? "BUY" : this.index === 2 ? "SELL" : "HOLD", reason: "test", confidence: 0, timestamp: tick.timestamp };
  }
  reset() { this.index = 0; }
}

class Hold {
  constructor(id) { this.id = id; this.name = id; }
  onTick(tick) { return { type: "HOLD", reason: "test", confidence: 0, timestamp: tick.timestamp }; }
  reset() {}
}

const points = (values = [100, 120, 110, 130, 120, 140, 130, 150, 140]) => values.map((close, index) => ({ timestamp: index + 1, close }));
const candidate = (id, period, kind = "round") => ({ id, parameters: { period }, strategyFactory: () => kind === "round" ? new RoundTrip(id) : new Hold(id) });
const input = () => ({ base: candidate("base", 20), neighbors: [candidate("p18", 18), candidate("p22", 22)] });
const walk = { trainSize: 3, testSize: 2, stepSize: 2, selectionPolicy: { minimumClosedTrades: 0 }, backtestConfig: { initialCash: 1000, feeRate: 0, orderQuantity: 1 } };

 test("1 deterministic replay and canonical neighbor ordering", () => {
  const first = runParameterStability(points(), { base: candidate("base", 20), neighbors: [candidate("p22", 22), candidate("p18", 18)] }, walk, { minimumOosTradeCount: 0 });
  const second = runParameterStability(points(), input(), walk, { minimumOosTradeCount: 0 });
  assert.deepEqual(first, second);
  assert.deepEqual(first.neighbors.map((row) => row.candidateId), ["p18", "p22"]);
});

test("2 parameter change changes identity", () => {
  const first = runParameterStability(points(), input(), walk, { minimumOosTradeCount: 0 });
  const second = runParameterStability(points(), { base: candidate("base", 21), neighbors: [candidate("p18", 18), candidate("p22", 22)] }, walk, { minimumOosTradeCount: 0 });
  assert.notEqual(first.identitySha256, second.identitySha256);
});

test("3 rejects duplicate candidate ids", () => {
  assert.throws(() => runParameterStability(points(), { base: candidate("base", 20), neighbors: [candidate("x", 18), candidate("x", 22)] }, walk), /unique/);
});

test("4 rejects a neighbor with identical parameters", () => {
  assert.throws(() => runParameterStability(points(), { base: candidate("base", 20), neighbors: [candidate("x", 20), candidate("y", 22)] }, walk), /differ/);
});

test("5 rejects insufficient explicit neighbors", () => {
  assert.throws(() => runParameterStability(points(), { base: candidate("base", 20), neighbors: [candidate("x", 18)] }, walk), /insufficient/);
});

test("6 preserves every adverse neighbor", () => {
  const result = runParameterStability(points(), { base: candidate("base", 20), neighbors: [candidate("hold18", 18, "hold"), candidate("hold22", 22, "hold")] }, walk, { minimumOosTradeCount: 0 });
  assert.equal(result.neighbors.length, 2);
  assert.equal(result.positiveNeighborRatio, 0);
  assert.ok(result.warnings.includes("RETURN_DEPENDS_ON_SINGLE_POINT"));
  assert.equal(result.status, "FRAGILE");
});

test("7 insufficient OOS evidence is explicit", () => {
  const result = runParameterStability(points(), input(), walk, { minimumOosTradeCount: 99 });
  assert.ok(result.warnings.includes("INSUFFICIENT_OOS_TRADES"));
  assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
});

test("8 exposes finite dispersion and OOS summaries", () => {
  const result = runParameterStability(points(), input(), walk, { minimumOosTradeCount: 0 });
  assert.ok(Number.isFinite(result.returnDispersion));
  assert.ok(Number.isFinite(result.drawdownDispersion));
  assert.ok(Number.isFinite(result.base.markedTotalReturn));
  assert.equal(result.identitySha256.length, 64);
});

test("9 rejects non-finite parameter values", () => {
  const bad = { id: "bad", parameters: { period: NaN }, strategyFactory: () => new RoundTrip("bad") };
  assert.throws(() => runParameterStability(points(), { base: candidate("base", 20), neighbors: [bad, candidate("x", 22)] }, walk), /finite/);
});

test("10 threshold validation fails closed", () => {
  assert.throws(() => runParameterStability(points(), input(), walk, { maximumReturnDrop: 2 }), /between 0 and 1/);
});
