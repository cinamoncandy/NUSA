import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMetaLearningStatus, shadowForwardEntry } from "./researchMetaLearningRuntime";
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

  it("a live shadow passes only with at least 50 round trips and a positive net after fees", () => {
    assert.equal(shadowForwardEntry({ trades: 243, grossGainBp: 1665, grossLossBp: 2034, feeBp: 2431 })?.holdoutPass, 0);
    assert.equal(shadowForwardEntry({ trades: 60, grossGainBp: 900, grossLossBp: 100, feeBp: 120 })?.holdoutPass, 1);
    assert.equal(shadowForwardEntry({ trades: 10, grossGainBp: 900, grossLossBp: 100, feeBp: 20 })?.holdoutPass, 0);
    assert.equal(shadowForwardEntry(undefined), undefined);
  });
});
