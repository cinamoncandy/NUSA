import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMetaLearningStatus, paperLedgerForwardEntry, shadowForwardEntry } from "./researchMetaLearningRuntime";
import { RESEARCH_LEDGER_SNAPSHOT } from "./researchLedgerSnapshot";
import { META_DEPRIORITIZED_TICK_EVERY, META_STEERING_NORMAL, metaLearningSteering } from "../../../packages/contracts/src/researchMetaLearning";

describe("runtime research meta-learning", () => {
  it("evaluates the compiled ledger plus live runtime Research and the live shadow, without counting the shadow twice", () => {
    const status = buildMetaLearningStatus({
      ledger: RESEARCH_LEDGER_SNAPSHOT,
      runtimeTicksByInterval: { "1m": { counts: { FAIL_NO_EDGE: 19, FAIL_EXCESSIVE_DRAWDOWN: 55 } } },
      researchMarkets: 1,
      shadow: { trades: 243, grossGainBp: 1665, grossLossBp: 2034, feeBp: 2431 },
    });
    const ledgerConfigs = RESEARCH_LEDGER_SNAPSHOT.filter((e) => e.source !== "PAPER_FORWARD").reduce((a, e) => a + e.configs, 0);
    assert.equal(status.configurations, ledgerConfigs + 74 + 1);
    assert.equal(status.runtimeEntries, 1);
    assert.equal(status.liveForwardEntries, 1);
    assert.equal(status.holdoutPasses, 0);
    assert.match(status.exhausted, /dataType=CLOSE/);
    assert.equal(status.recommended, "ORDERBOOK+INTRADAY+ALL_KRW+ML", "TRADES+INTRADAY+ALL_KRW+ML was tried on 2026-10-13 and failed its holdout");
    assert.equal(status.recommendedPrerequisites, "COLLECT_ORDERBOOK");
    assert.equal(status.steeringMode, "DEPRIORITIZE_EXHAUSTED", "the runtime grid is exhausted and a recommendation exists");
    assert.equal(status.longBarTickEvery, META_DEPRIORITIZED_TICK_EVERY);
  });

  it("steering deprioritizes only when every runtime-grid value is exhausted and something else is recommended", () => {
    const all = ["dataType=CLOSE", "timeframe=INTRADAY", "universe=FIVE", "methodClass=RULE"];
    assert.equal(metaLearningSteering({ exhausted: all, recommended: "TRADES+INTRADAY+ALL_KRW+ML" }, 1).mode, "DEPRIORITIZE_EXHAUSTED");
    assert.equal(metaLearningSteering({ exhausted: all.slice(1), recommended: "TRADES+INTRADAY+ALL_KRW+ML" }, 1).mode, "NORMAL");
    assert.equal(metaLearningSteering({ exhausted: all }, 1).mode, "NORMAL", "no recommendation: keep every tick");
    assert.equal(metaLearningSteering({ exhausted: all, recommended: "TRADES+INTRADAY+ALL_KRW+ML" }, 10).mode, "NORMAL", "an all-KRW runtime grid is a different universe");
    assert.deepEqual(metaLearningSteering(undefined, 1), META_STEERING_NORMAL);
  });

  it("realized canonical PAPER periods feed meta-learning with an identifying fingerprint and no extra configuration", () => {
    const periods = Array.from({ length: 12 }, (_, i) => ({ recordId: `p${i}`, netReturn: -0.001, benchmarkReturn: 0.0005, outcomeFingerprint: "f".repeat(64) }));
    const base = { ledger: RESEARCH_LEDGER_SNAPSHOT, researchMarkets: 1 };
    const without = buildMetaLearningStatus(base);
    const status = buildMetaLearningStatus({ ...base, paperPeriods: periods });
    assert.equal(status.paperPeriodsConsumed, 12);
    assert.equal(status.paperNetBp, -10);
    assert.equal(status.paperExcessBp, -15);
    assert.match(status.paperEvidenceFingerprint ?? "", /^[a-f0-9]{64}$/);
    assert.equal(status.configurations, without.configurations, "the ledger is the same rule: no configuration added");
    assert.equal(status.experiments, without.experiments + 1);
    assert.equal(buildMetaLearningStatus({ ...base, paperPeriods: [...periods].reverse() }).paperEvidenceFingerprint, status.paperEvidenceFingerprint, "order-independent identity");
    const winning = Array.from({ length: 20 }, (_, i) => ({ recordId: `w${i}`, netReturn: 0.002, benchmarkReturn: 0.001 }));
    assert.equal(paperLedgerForwardEntry(winning)?.entry.holdoutPass, 1);
    assert.equal(paperLedgerForwardEntry(winning.slice(1))?.entry.holdoutPass, 0, "fewer than 20 periods never pass");
    assert.equal(paperLedgerForwardEntry([{ recordId: "x", netReturn: Number.NaN, benchmarkReturn: 0 }]), undefined);
  });

  it("a live shadow passes only with at least 50 round trips and a positive net after fees", () => {
    assert.equal(shadowForwardEntry({ trades: 243, grossGainBp: 1665, grossLossBp: 2034, feeBp: 2431 })?.holdoutPass, 0);
    assert.equal(shadowForwardEntry({ trades: 60, grossGainBp: 900, grossLossBp: 100, feeBp: 120 })?.holdoutPass, 1);
    assert.equal(shadowForwardEntry({ trades: 10, grossGainBp: 900, grossLossBp: 100, feeBp: 20 })?.holdoutPass, 0);
    assert.equal(shadowForwardEntry(undefined), undefined);
  });
});
