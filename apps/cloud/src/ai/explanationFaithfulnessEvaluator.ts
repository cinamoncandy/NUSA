import { aiSha256 } from "../../../../packages/contracts/src/aiInference";
import type {
  ExplanationFaithfulnessReasonCode,
  ExplanationFaithfulnessRequest,
  ExplanationFaithfulnessResult,
  ExplanationFaithfulnessStrength
} from "../../../../packages/contracts/src/aiExplanationFaithfulness";

/**
 * Deterministic evaluator for ExplanationFaithfulnessRequest -- see the contract file's module
 * doc for why this is lexical/numeric rather than another model call. Pure function of its
 * input: same request always produces the same result, which is what makes it replay-safe and
 * auditable (requestSha256/resultSha256 below).
 */

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value;
};

const unitInterval = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be within [0,1]`);
  return value;
};

const finiteTimestamp = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
  return value;
};

function assertValidRequest(request: ExplanationFaithfulnessRequest): void {
  if (request == null || typeof request !== "object" || request.schemaVersion !== 1) throw new Error("invalid explanation faithfulness request");
  requiredText(request.explanationId, "explanationId");
  if (typeof request.explanationText !== "string") throw new Error("explanationText must be a string");
  if (!Array.isArray(request.evidence?.numericFacts) || !request.evidence.numericFacts.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("evidence.numericFacts must be an array of finite numbers");
  }
  const actions = ["BUY", "SELL", "HOLD", "REDUCE", "EXIT", "WAIT"];
  if (!actions.includes(request.decision?.action)) throw new Error("decision.action must be one of " + actions.join(","));
  unitInterval(request.decision?.confidence, "decision.confidence");
  finiteTimestamp(request.evaluatedAt, "evaluatedAt");
}

// Matches integers and decimals, with optional thousands separators and a trailing "%". Doesn't
// need to parse every possible numeric format a human could write -- it only needs to catch the
// kind of concrete figures ("91,327,000", "0.05", "12.3%") an AI explanation would state to
// support a quantitative claim.
const NUMBER_PATTERN = /-?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?/g;

function extractClaimedNumbers(text: string): number[] {
  const matches = text.match(NUMBER_PATTERN) ?? [];
  const values: number[] = [];
  for (const match of matches) {
    const isPercent = match.endsWith("%");
    const cleaned = (isPercent ? match.slice(0, -1) : match).replace(/,/g, "");
    const value = Number(cleaned);
    if (!Number.isFinite(value)) continue;
    // Small integers (0-9) are overwhelmingly ordinal/structural in natural language ("첫 번째
    // 이유", "one of three signals") rather than a quantitative claim about the evidence, and
    // flagging them produces noise without catching real fabrication. Percent figures are kept
    // regardless of magnitude since "5%" is very often exactly the kind of claim that needs
    // grounding.
    if (!isPercent && Math.abs(value) < 10) continue;
    values.push(value);
  }
  return values;
}

function isGrounded(claimed: number, facts: readonly number[]): boolean {
  return facts.some((fact) => {
    if (fact === 0) return claimed === 0;
    return Math.abs(claimed - fact) / Math.abs(fact) <= 0.005; // 0.5% relative tolerance for rounding in prose
  });
}

const UNCERTAINTY_KEYWORDS = [
  "uncertain", "uncertainty", "may", "might", "could", "risk", "unclear", "not guaranteed",
  "불확실", "위험", "가능성", "장담할 수 없", "변동"
];
const COUNTEREVIDENCE_KEYWORDS = [
  "however", "but ", "on the other hand", "that said", "counter", "against this",
  "반면", "다만", "그러나", "하지만", "단,"
];
const BULLISH_KEYWORDS = ["buy", "bullish", "upside", "rally", "매수", "상승", "강세"];
const BEARISH_KEYWORDS = ["sell", "bearish", "downside", "decline", "매도", "하락", "약세"];
const CERTAINTY_KEYWORDS = ["certain", "guaranteed", "definitely", "sure thing", "no doubt", "확실", "틀림없", "장담"];

function countMatches(text: string, keywords: readonly string[]): number {
  const lower = text.toLowerCase();
  return keywords.reduce((count, keyword) => count + (lower.includes(keyword.toLowerCase()) ? 1 : 0), 0);
}

function deriveStrength(reasonCodes: readonly ExplanationFaithfulnessReasonCode[]): ExplanationFaithfulnessStrength {
  if (reasonCodes.length === 0) return "FAITHFUL";
  const groundingOrConsistencyViolations: readonly ExplanationFaithfulnessReasonCode[] = [
    "EMPTY_EXPLANATION",
    "UNGROUNDED_NUMERIC_CLAIM",
    "DIRECTION_INCONSISTENT_WITH_DECISION",
    "CONFIDENCE_LANGUAGE_OVERCLAIMS"
  ];
  const hasSeriousViolation = reasonCodes.some((code) => groundingOrConsistencyViolations.includes(code));
  return hasSeriousViolation ? "UNFAITHFUL" : "PARTIALLY_FAITHFUL";
}

export function evaluateExplanationFaithfulness(request: ExplanationFaithfulnessRequest): ExplanationFaithfulnessResult {
  assertValidRequest(request);
  const requestSha256 = aiSha256(request);
  const text = request.explanationText.trim();
  const reasonCodes: ExplanationFaithfulnessReasonCode[] = [];
  let ungroundedNumbers: number[] = [];

  if (text === "") {
    reasonCodes.push("EMPTY_EXPLANATION");
  } else {
    ungroundedNumbers = extractClaimedNumbers(text).filter((value) => !isGrounded(value, request.evidence.numericFacts));
    if (ungroundedNumbers.length > 0) reasonCodes.push("UNGROUNDED_NUMERIC_CLAIM");

    if (countMatches(text, UNCERTAINTY_KEYWORDS) === 0) reasonCodes.push("MISSING_UNCERTAINTY_DISCUSSION");
    if (countMatches(text, COUNTEREVIDENCE_KEYWORDS) === 0) reasonCodes.push("MISSING_COUNTEREVIDENCE_DISCUSSION");

    const bullish = countMatches(text, BULLISH_KEYWORDS);
    const bearish = countMatches(text, BEARISH_KEYWORDS);
    if (request.decision.action === "BUY" && bearish > bullish) reasonCodes.push("DIRECTION_INCONSISTENT_WITH_DECISION");
    if (request.decision.action === "SELL" && bullish > bearish) reasonCodes.push("DIRECTION_INCONSISTENT_WITH_DECISION");

    if (request.decision.confidence < 0.4 && countMatches(text, CERTAINTY_KEYWORDS) > 0) {
      reasonCodes.push("CONFIDENCE_LANGUAGE_OVERCLAIMS");
    }
  }

  const strength = deriveStrength(reasonCodes);
  const withoutResultHash = {
    explanationId: request.explanationId,
    strength,
    reasonCodes: Object.freeze(reasonCodes),
    ungroundedNumbers: Object.freeze(ungroundedNumbers),
    evaluatedAt: request.evaluatedAt,
    requestSha256
  };
  const resultSha256 = aiSha256(withoutResultHash);
  return Object.freeze({ ...withoutResultHash, resultSha256 });
}
