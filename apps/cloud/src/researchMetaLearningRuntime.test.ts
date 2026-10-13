import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMetaLearningStatus, shadowForwardEntry } from "./researchMetaLearningRuntime";
import { RESEARCH_LEDGER_SNAPSHOT } from "./researchLedgerSnapshot";

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
    assert.equal(status.recommended, "TRADES+INTRADAY+ALL_KRW+ML");
    assert.equal(status.recommendedPrerequisites, "COLLECT_TRADES");
  });

  it("a live shadow passes only with at least 50 round trips and a positive net after fees", () => {
    assert.equal(shadowForwardEntry({ trades: 243, grossGainBp: 1665, grossLossBp: 2034, feeBp: 2431 })?.holdoutPass, 0);
    assert.equal(shadowForwardEntry({ trades: 60, grossGainBp: 900, grossLossBp: 100, feeBp: 120 })?.holdoutPass, 1);
    assert.equal(shadowForwardEntry({ trades: 10, grossGainBp: 900, grossLossBp: 100, feeBp: 20 })?.holdoutPass, 0);
    assert.equal(shadowForwardEntry(undefined), undefined);
  });
});
