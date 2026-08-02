const test = require("node:test");
const assert = require("node:assert/strict");
const { buildTradeHistoryJournalScreen } = require("../dist/apps/mobile/src/tradeHistoryJournalScreen.js");

const trade = (id, pnl, overrides = {}) => ({ id, timestamp: Number(id), symbol: "KRW-BTC", strategy: "sma", direction: "LONG", entryPrice: 100, exitPrice: 110, quantity: 1, holdingTimeMs: 3_600_000, pnl, rMultiple: pnl / 10, fees: 1, slippage: 0.1, status: "FILLED", mae: -2, mfe: 12, maximumProfit: 12, maximumLoss: -2, exitEfficiency: 0.8, ruleViolations: [], entryCondition: "SMA_CROSS", exitCondition: "TARGET", executionTimeline: ["accepted"], fillTimeline: ["filled"], riskTimeline: ["approved"], ledgerEvents: ["ledger-1"], ...overrides });
const input = (overrides = {}) => ({ generatedAt: 100, period: "30D", trades: [trade("1", 10), trade("2", -4, { ruleViolations: ["OVERSIZED_ENTRY"], entryCondition: "LATE_ENTRY" })], journals: [{ tradeId: "1", reason: "cross", marketContext: "uptrend", confidence: 0.8, emotion: "calm", lessons: "keep plan", improvementNotes: "maintain size", tags: ["planned"], screenshotCount: 1, chartSnapshot: "chart-1", voiceMemoAvailable: false }], selectedTradeId: "1", ...overrides });

test("history projection explains performance and keeps evidence-linked review", () => {
  const result = buildTradeHistoryJournalScreen(input());
  assert.equal(result.header.totalTrades, 2);
  assert.equal(result.header.winRate, 0.5);
  assert.equal(result.header.netProfit, 6);
  assert.equal(result.tradeList[0].result, "LOSS");
  assert.equal(result.selectedDetail.journal.reason, "cross");
  assert.deepEqual(result.patterns.repeatedMistakes, ["OVERSIZED_ENTRY"]);
  assert.equal(result.journalMutation.affectsLedger, false);
  assert.match(result.export.csv, /id,timestamp/);
  assert.doesNotThrow(() => JSON.parse(result.export.json));
});

test("history projection rejects orphan journals and invalid trade metrics", () => {
  assert.throws(() => buildTradeHistoryJournalScreen(input({ journals: [{ ...input().journals[0], tradeId: "missing" }] })), /unavailable/);
  assert.throws(() => buildTradeHistoryJournalScreen(input({ trades: [trade("1", Number.NaN)] })), /trade metric/);
});
