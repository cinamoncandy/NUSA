const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateExplanationFaithfulness } = require("../dist/apps/cloud/src/ai/explanationFaithfulnessEvaluator.js");

const baseRequest = (overrides = {}) => ({
  schemaVersion: 1,
  explanationId: "exp-1",
  explanationText: "",
  evidence: { numericFacts: [91_327_000, 0.05, 5] },
  decision: { action: "BUY", confidence: 0.7 },
  evaluatedAt: 1_700_000_000_000,
  ...overrides
});

test("an empty explanation is UNFAITHFUL with EMPTY_EXPLANATION", () => {
  const result = evaluateExplanationFaithfulness(baseRequest({ explanationText: "   " }));
  assert.equal(result.strength, "UNFAITHFUL");
  assert.deepEqual(result.reasonCodes, ["EMPTY_EXPLANATION"]);
});

test("a well-grounded, complete, consistent explanation is FAITHFUL", () => {
  const text = "Price is 91,327,000 which is 5% above the recent average, supporting a BUY. "
    + "However, this could be noise -- there is real uncertainty and the move may reverse.";
  const result = evaluateExplanationFaithfulness(baseRequest({ explanationText: text }));
  assert.equal(result.strength, "FAITHFUL");
  assert.deepEqual(result.reasonCodes, []);
  assert.deepEqual(result.ungroundedNumbers, []);
});

test("a fabricated number not present in the evidence is flagged as ungrounded", () => {
  const text = "Price surged to 999,999,999 which strongly supports a BUY, but this reading may be noisy.";
  const result = evaluateExplanationFaithfulness(baseRequest({ explanationText: text }));
  assert.ok(result.reasonCodes.includes("UNGROUNDED_NUMERIC_CLAIM"));
  assert.deepEqual(result.ungroundedNumbers, [999_999_999]);
  assert.equal(result.strength, "UNFAITHFUL");
});

test("a number within 0.5% relative tolerance of an evidence fact is still grounded", () => {
  // evidence fact is 91,327,000; 91,327,400 is well within 0.5%
  const text = "Price near 91,327,400 supports the signal, though this could still be noise.";
  const result = evaluateExplanationFaithfulness(baseRequest({ explanationText: text }));
  assert.deepEqual(result.ungroundedNumbers, []);
  assert.ok(!result.reasonCodes.includes("UNGROUNDED_NUMERIC_CLAIM"));
});

test("small integers (ordinal/structural language) are never flagged as ungrounded", () => {
  const text = "This is the 1st of 3 reasons supporting the signal; still, there is uncertainty and risk, however small.";
  const result = evaluateExplanationFaithfulness(baseRequest({ explanationText: text }));
  assert.deepEqual(result.ungroundedNumbers, []);
});

test("a small DECIMAL fraction is still checked for grounding, unlike a small integer", () => {
  // Regression: the ordinal-integer exemption above must not also swallow a fabricated ratio
  // like 0.95 just because its magnitude is under 10 -- only whole small integers are exempt.
  const text = "The drawdown ratio is 0.95, extremely elevated, however this may change quickly.";
  const result = evaluateExplanationFaithfulness(baseRequest({ explanationText: text, evidence: { numericFacts: [0.02, 0.15, 0.8] } }));
  assert.deepEqual(result.ungroundedNumbers, [0.95]);
  assert.ok(result.reasonCodes.includes("UNGROUNDED_NUMERIC_CLAIM"));
});

test("missing uncertainty discussion is flagged and downgrades to PARTIALLY_FAITHFUL alone", () => {
  const text = "Price is 91,327,000, well above trend, however other signals disagree on timing.";
  const result = evaluateExplanationFaithfulness(baseRequest({ explanationText: text }));
  assert.deepEqual(result.reasonCodes, ["MISSING_UNCERTAINTY_DISCUSSION"]);
  assert.equal(result.strength, "PARTIALLY_FAITHFUL");
});

test("missing counter-evidence discussion is flagged and downgrades to PARTIALLY_FAITHFUL alone", () => {
  const text = "Price is 91,327,000, well above trend, though there is real uncertainty in this reading.";
  const result = evaluateExplanationFaithfulness(baseRequest({ explanationText: text }));
  assert.deepEqual(result.reasonCodes, ["MISSING_COUNTEREVIDENCE_DISCUSSION"]);
  assert.equal(result.strength, "PARTIALLY_FAITHFUL");
});

test("a bearish-dominated explanation attached to a BUY decision is direction-inconsistent", () => {
  const text = "This looks bearish, downside risk is high and a decline seems likely, however things are uncertain.";
  const result = evaluateExplanationFaithfulness(baseRequest({ explanationText: text, decision: { action: "BUY", confidence: 0.6 } }));
  assert.ok(result.reasonCodes.includes("DIRECTION_INCONSISTENT_WITH_DECISION"));
  assert.equal(result.strength, "UNFAITHFUL");
});

test("a bullish-dominated explanation attached to a SELL decision is direction-inconsistent", () => {
  const text = "This looks bullish, upside potential is strong and a rally seems likely, however things are uncertain.";
  const result = evaluateExplanationFaithfulness(baseRequest({ explanationText: text, decision: { action: "SELL", confidence: 0.6 } }));
  assert.ok(result.reasonCodes.includes("DIRECTION_INCONSISTENT_WITH_DECISION"));
});

test("HOLD/WAIT decisions are exempt from the bullish/bearish direction check", () => {
  const text = "This looks bearish and downside risk is elevated, however conditions remain uncertain.";
  const result = evaluateExplanationFaithfulness(baseRequest({ explanationText: text, decision: { action: "HOLD", confidence: 0.5 } }));
  assert.ok(!result.reasonCodes.includes("DIRECTION_INCONSISTENT_WITH_DECISION"));
});

test("certainty language paired with low decision confidence overclaims", () => {
  const text = "This is certainly going to rally, however there is some uncertainty in general.";
  const result = evaluateExplanationFaithfulness(baseRequest({ explanationText: text, decision: { action: "BUY", confidence: 0.2 } }));
  assert.ok(result.reasonCodes.includes("CONFIDENCE_LANGUAGE_OVERCLAIMS"));
  assert.equal(result.strength, "UNFAITHFUL");
});

test("certainty language is fine when decision confidence is actually high", () => {
  const text = "This is certainly a strong bullish signal, however markets can always surprise and there is uncertainty.";
  const result = evaluateExplanationFaithfulness(baseRequest({ explanationText: text, decision: { action: "BUY", confidence: 0.95 } }));
  assert.ok(!result.reasonCodes.includes("CONFIDENCE_LANGUAGE_OVERCLAIMS"));
});

test("evaluation is a pure, deterministic function of its input (replay-safe)", () => {
  const request = baseRequest({ explanationText: "Price 91,327,000 supports a BUY, however this may reverse -- real uncertainty remains." });
  const first = evaluateExplanationFaithfulness(request);
  const second = evaluateExplanationFaithfulness(request);
  assert.deepEqual(first, second);
  assert.equal(first.requestSha256, second.requestSha256);
  assert.equal(first.resultSha256, second.resultSha256);
});

test("a differently-worded but substantively different request produces a different resultSha256", () => {
  const good = evaluateExplanationFaithfulness(baseRequest({ explanationText: "Price 91,327,000 supports a BUY, however this may reverse -- real uncertainty remains." }));
  const bad = evaluateExplanationFaithfulness(baseRequest({ explanationText: "Price 999,999,999 certainly supports a BUY." }));
  assert.notEqual(good.resultSha256, bad.resultSha256);
  assert.notEqual(good.requestSha256, bad.requestSha256);
});

test("invalid requests are rejected rather than silently coerced", () => {
  assert.throws(() => evaluateExplanationFaithfulness(baseRequest({ schemaVersion: 2 })), /invalid explanation faithfulness request/);
  assert.throws(() => evaluateExplanationFaithfulness(baseRequest({ explanationId: "" })), /explanationId/);
  assert.throws(() => evaluateExplanationFaithfulness(baseRequest({ decision: { action: "INVALID", confidence: 0.5 } })), /decision\.action/);
  assert.throws(() => evaluateExplanationFaithfulness(baseRequest({ decision: { action: "BUY", confidence: 1.5 } })), /decision\.confidence/);
  assert.throws(() => evaluateExplanationFaithfulness(baseRequest({ evidence: { numericFacts: ["not-a-number"] } })), /numericFacts/);
  assert.throws(() => evaluateExplanationFaithfulness(baseRequest({ evaluatedAt: -1 })), /evaluatedAt/);
});

test("a percent figure is checked for grounding even though it is a small number", () => {
  const text = "This move is up 5%, however conditions remain uncertain.";
  const grounded = evaluateExplanationFaithfulness(baseRequest({ explanationText: text }));
  assert.deepEqual(grounded.ungroundedNumbers, []);

  const fabricated = evaluateExplanationFaithfulness(baseRequest({ explanationText: "This move is up 47%, however conditions remain uncertain." }));
  assert.deepEqual(fabricated.ungroundedNumbers, [47]);
});
