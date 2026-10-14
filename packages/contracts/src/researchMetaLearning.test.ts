import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateMetaLearning, runtimeResearchEntries, type ResearchLedgerEntry } from "./researchMetaLearning";

const entry = (id: string, patch: Partial<ResearchLedgerEntry>): ResearchLedgerEntry => ({ id, dataType: "CLOSE", timeframe: "60m", universe: 5, methodClass: "RULE", configs: 10, discoveryPass: 0, holdoutPass: 0, ...patch });

describe("research meta-learning policy", () => {
  it("marks a value exhausted at 50 configurations without a holdout pass and steers away from it", () => {
    const report = evaluateMetaLearning([entry("a", { configs: 60, discoveryPass: 4 })]);
    assert.deepEqual([...report.exhausted], ["dataType=CLOSE", "timeframe=INTRADAY", "universe=FIVE", "methodClass=RULE"]);
    assert.equal(report.overfitRatePercent, 100);
    assert.equal(report.validKnowledgePer100Configs, 0);
    assert.ok(report.recommended !== undefined && !report.recommended.startsWith("CLOSE+"));
    assert.ok(Math.abs(report.nextHoldoutBar - 0.05 / 61) < 1e-15, "the bar is cumulative");
  });

  it("a holdout pass keeps the value open and counts as valid knowledge", () => {
    const report = evaluateMetaLearning([entry("a", { configs: 60, discoveryPass: 2, holdoutPass: 1 })]);
    assert.ok(!report.exhausted.includes("dataType=CLOSE"));
    assert.equal(report.overfitRatePercent, 50);
    assert.equal(report.validKnowledgePer100Configs, 1.67);
  });

  it("charges a collection cost for data with no history and lists the prerequisite", () => {
    const report = evaluateMetaLearning([entry("a", { configs: 60 }), entry("b", { dataType: "OHLCV", methodClass: "ML", universe: 100, configs: 60 }), entry("c", { dataType: "EXTERNAL", methodClass: "ML", universe: 100, timeframe: "1d", configs: 60 })]);
    const trades = report.ranked.find((r) => r.combination.startsWith("TRADES+"));
    assert.ok(trades != null && trades.prerequisites.includes("COLLECT_TRADES"));
  });

  it("a design-flawed experiment leaves its combination re-triable exactly once", () => {
    const flawed = entry("v1", { dataType: "OHLCV", methodClass: "ML", universe: 100, designFlaw: true, configs: 3 });
    assert.ok(evaluateMetaLearning([flawed]).ranked.some((r) => r.combination === "OHLCV+INTRADAY+ALL_KRW+ML"));
    const retry = entry("v2", { dataType: "OHLCV", methodClass: "ML", universe: 100, retryOf: "v1", configs: 3 });
    assert.ok(!evaluateMetaLearning([flawed, retry]).ranked.some((r) => r.combination === "OHLCV+INTRADAY+ALL_KRW+ML"));
  });

  it("rejects a malformed entry instead of guessing", () => {
    assert.throws(() => evaluateMetaLearning([entry("bad", { configs: -1 })]), /META_LEDGER_ENTRY_INVALID/);
  });

  it("turns runtime Research counters into entries: failures are configurations, passes are discoveries, waits are ignored", () => {
    const entries = runtimeResearchEntries({ "1m": { counts: { NOT_DUE: 160, FAIL_NO_EDGE: 19, REPEAT_NO_EDGE: 3, PASS_CANDIDATE_GATE: 2 } }, "15m": null, weird: { counts: { FAIL_X: 1 } } }, 5);
    assert.deepEqual(entries.map((e) => [e.id, e.configs, e.discoveryPass, e.holdoutPass, e.timeframe]), [["RUNTIME_RESEARCH_1m", 24, 2, 0, "1m"]]);
  });
});
