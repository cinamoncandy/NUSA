const test = require("node:test");
const assert = require("node:assert/strict");
const { explainStrategySignal } = require("../dist/apps/desktop/src/aiSignalExplainer.js");

// aiSignalExplainer.ts is the one explainer in this codebase with a genuine BUY/SELL/HOLD
// decision plus a confidence figure plus real numeric evidence (recentPrices), so it's the
// target that exercises evaluateExplanationFaithfulness's direction-consistency and
// confidence-overclaim checks end-to-end -- see ADR-0013's "remaining follow-up" note.

function signal(overrides = {}) {
  return { type: "BUY", reason: "short-SMA crossed above long-SMA", confidence: 0.7, timestamp: 1_000, ...overrides };
}

function clientReturning(text) {
  return { explain: async () => text, answerFollowUp: async () => "" };
}

test("a well-grounded, complete, direction-consistent explanation is FAITHFUL", async () => {
  const request = { market: "KRW-BTC", signal: signal(), recentPrices: [91_000_000, 91_200_000, 91_327_000] };
  const text = "Price at 91,327,000 supports a bullish BUY signal, however this could be noise -- real uncertainty remains.";
  const result = await explainStrategySignal({ request, client: clientReturning(text), nowMs: 2_000 });
  assert.equal(result.status, "OK");
  assert.equal(result.faithfulness.strength, "FAITHFUL");
  assert.deepEqual(result.faithfulness.reasonCodes, []);
});

test("a bearish-worded explanation attached to a BUY signal is direction-inconsistent", async () => {
  const request = { market: "KRW-BTC", signal: signal({ type: "BUY" }), recentPrices: [91_327_000] };
  const text = "This looks bearish and a decline seems likely, downside risk is elevated, however conditions are uncertain.";
  const result = await explainStrategySignal({ request, client: clientReturning(text), nowMs: 2_000 });
  assert.equal(result.status, "OK");
  assert.ok(result.faithfulness.reasonCodes.includes("DIRECTION_INCONSISTENT_WITH_DECISION"));
  assert.equal(result.faithfulness.strength, "UNFAITHFUL");
});

test("certainty language paired with low signal confidence overclaims", async () => {
  const request = { market: "KRW-BTC", signal: signal({ type: "BUY", confidence: 0.15 }), recentPrices: [91_327_000] };
  const text = "This is certainly going to rally, however there is some uncertainty in general.";
  const result = await explainStrategySignal({ request, client: clientReturning(text), nowMs: 2_000 });
  assert.ok(result.faithfulness.reasonCodes.includes("CONFIDENCE_LANGUAGE_OVERCLAIMS"));
});

test("a number not present in recentPrices is flagged as ungrounded", async () => {
  const request = { market: "KRW-BTC", signal: signal(), recentPrices: [91_000_000, 91_200_000] };
  const text = "Price hit 999,999,999 which strongly supports the BUY, however this may be noise.";
  const result = await explainStrategySignal({ request, client: clientReturning(text), nowMs: 2_000 });
  assert.ok(result.faithfulness.reasonCodes.includes("UNGROUNDED_NUMERIC_CLAIM"));
  assert.deepEqual(result.faithfulness.ungroundedNumbers, [999_999_999]);
});

test("HOLD signals are exempt from the bullish/bearish direction check", async () => {
  const request = { market: "KRW-BTC", signal: signal({ type: "HOLD", confidence: 0.5 }), recentPrices: [91_327_000] };
  const text = "This looks bearish and a decline seems likely, however conditions remain uncertain.";
  const result = await explainStrategySignal({ request, client: clientReturning(text), nowMs: 2_000 });
  assert.ok(!result.faithfulness.reasonCodes.includes("DIRECTION_INCONSISTENT_WITH_DECISION"));
});

test("NOT_CONFIGURED/NO_SIGNAL/UNAVAILABLE results carry no faithfulness field", async () => {
  const noClient = await explainStrategySignal({ request: undefined, client: undefined, nowMs: 1_000 });
  assert.equal(noClient.faithfulness, undefined);

  const noSignal = await explainStrategySignal({ request: undefined, client: clientReturning("x"), nowMs: 1_000 });
  assert.equal(noSignal.faithfulness, undefined);

  const failingClient = { explain: async () => { throw new Error("boom"); }, answerFollowUp: async () => "" };
  const unavailable = await explainStrategySignal({
    request: { market: "KRW-BTC", signal: signal(), recentPrices: [1] },
    client: failingClient,
    nowMs: 1_000
  });
  assert.equal(unavailable.status, "UNAVAILABLE");
  assert.equal(unavailable.faithfulness, undefined);
});
