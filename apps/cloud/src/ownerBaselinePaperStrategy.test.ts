import test from "node:test";
import assert from "node:assert/strict";
import { validatePaperCandidateExecutionBinding } from "./cioDecisionEngine";
import { evaluatePaperCandidateStrategy } from "./paperCandidateStrategy";
import {
  OWNER_BASELINE_CANDIDATE_ID,
  OwnerBaselinePaperBindingProvider,
  ownerBaselineBinding,
  ownerBaselineStrategyEnabled,
} from "./ownerBaselinePaperStrategy";

const COMMIT = "a".repeat(40);
const NOW = Date.UTC(2026, 8, 29, 4, 0, 0);

test("the baseline binding passes the canonical execution binding validator and stays PAPER-only", () => {
  const binding = ownerBaselineBinding("krw-btc", NOW, COMMIT);
  const validated = validatePaperCandidateExecutionBinding(binding, NOW);
  assert.equal(validated.candidateId, OWNER_BASELINE_CANDIDATE_ID);
  assert.equal(validated.authority, "PAPER_RESEARCH_ONLY");
  assert.equal(validated.liveAuthority, "NONE");
  assert.equal(validated.productionMutationAllowed, false);
  assert.equal(validated.candidateStrategy?.familyId, "sma-crossover");
  assert.deepEqual(validated.candidateStrategy?.parameters, { shortPeriod: 5, longPeriod: 20 });
});

test("the binding is deterministic within a UTC day so a restart keeps the same strategy identity", () => {
  const first = ownerBaselineBinding("KRW-BTC", NOW, COMMIT);
  assert.deepEqual(ownerBaselineBinding("KRW-BTC", NOW + 60_000, COMMIT), first);
  assert.notEqual(ownerBaselineBinding("KRW-ETH", NOW, COMMIT).bindingFingerprintSha256, first.bindingFingerprintSha256);
  assert.ok(first.periodStartAt <= NOW);
});

test("the baseline strategy produces an actionable decision the execution boundary accepts", () => {
  const binding = ownerBaselineBinding("KRW-BTC", NOW, COMMIT);
  const observations = Array.from({ length: 30 }, (_, index) => ({
    id: `tick-${index}`, source: "CHART" as const, market: "KRW-BTC", price: 100 + index, sentiment: 0, confidence: 1,
    observedAt: binding.periodStartAt + 1_000 * (index + 1), expiresAt: NOW + 60_000, summary: "tick",
  }));
  const decision = evaluatePaperCandidateStrategy(binding.candidateStrategy!, observations as never, NOW, "KRW-BTC");
  assert.equal(decision.action, "BUY");
  assert.ok(decision.confidence >= 0.55, "the boundary requires confidence >= 0.55");
});

test("a bound challenger always takes precedence, and the baseline is off outside PAPER or when disabled", () => {
  const challengerBinding = { candidateId: "qualified-challenger" } as never;
  const withChallenger = new OwnerBaselinePaperBindingProvider({ challenger: { read: () => challengerBinding }, sourceCommitSha: COMMIT, enabled: true });
  assert.equal(withChallenger.read("KRW-BTC", NOW), challengerBinding);
  const idle = new OwnerBaselinePaperBindingProvider({ challenger: { read: () => undefined }, sourceCommitSha: COMMIT, enabled: true });
  assert.equal(idle.read("KRW-BTC", NOW)?.candidateId, OWNER_BASELINE_CANDIDATE_ID);
  assert.equal(new OwnerBaselinePaperBindingProvider({ sourceCommitSha: COMMIT, enabled: false }).read("KRW-BTC", NOW), undefined);
  assert.equal(new OwnerBaselinePaperBindingProvider({ sourceCommitSha: "not-a-commit", enabled: true }).read("KRW-BTC", NOW), undefined, "fails closed without an exact source identity");
  assert.equal(ownerBaselineStrategyEnabled({ NUSA_MODE: "PAPER" }), true);
  assert.equal(ownerBaselineStrategyEnabled({ NUSA_MODE: "PAPER", NUSA_PAPER_OWNER_BASELINE_STRATEGY: "DISABLED" }), false);
  assert.equal(ownerBaselineStrategyEnabled({ NUSA_MODE: "PAPER", NUSA_PAPER_OWNER_BASELINE_STRATEGY: "enabled" }), false, "a typo fails closed");
  assert.equal(ownerBaselineStrategyEnabled({ NUSA_MODE: "LIVE" }), false);
});
