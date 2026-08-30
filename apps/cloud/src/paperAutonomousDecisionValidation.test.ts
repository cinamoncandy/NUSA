import assert from "node:assert/strict";
import test from "node:test";
import type { CioDecision } from "./cioDecisionEngine";
import { validatePaperAutonomousDecisions } from "./paperAutonomousDecisionValidation";

const validDecision: CioDecision = Object.freeze({
  symbol: "KRW-BTC",
  action: "BUY",
  confidence: 0.8,
  risk: "LOW",
  allocation: 0.1,
  leverage: 1,
  score: 0.7,
  reasons: Object.freeze(["governed signal"]),
  decidedAt: 995,
});

test("accepts a canonical governed PAPER decision", () => {
  const decisions = validatePaperAutonomousDecisions(Object.freeze([validDecision]), { now: 1_000 });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0]?.symbol, "KRW-BTC");
  assert.ok(Object.isFrozen(decisions));
  assert.ok(Object.isFrozen(decisions[0]));
});

test("fails closed on invalid autonomous allocation", () => {
  const invalid = Object.freeze({ ...validDecision, allocation: 1.01 }) as CioDecision;
  assert.throws(
    () => validatePaperAutonomousDecisions(Object.freeze([invalid]), { now: 1_000 }),
    /PAPER_DECISION_ALLOCATION_INVALID/,
  );
});

test("fails closed on future-dated decisions", () => {
  const invalid = Object.freeze({ ...validDecision, decidedAt: 1_001 }) as CioDecision;
  assert.throws(
    () => validatePaperAutonomousDecisions(Object.freeze([invalid]), { now: 1_000 }),
    /PAPER_DECISION_CLOCK_INVALID/,
  );
});

test("fails closed on stale autonomous decisions", () => {
  const invalid = Object.freeze({ ...validDecision, decidedAt: 899 }) as CioDecision;
  assert.throws(
    () => validatePaperAutonomousDecisions(Object.freeze([invalid]), { now: 1_000, maxDecisionAgeMs: 100 }),
    /PAPER_DECISION_STALE/,
  );
});

test("accepts a decision exactly at the freshness boundary", () => {
  const boundary = Object.freeze({ ...validDecision, decidedAt: 900 }) as CioDecision;
  assert.doesNotThrow(() => validatePaperAutonomousDecisions(Object.freeze([boundary]), { now: 1_000, maxDecisionAgeMs: 100 }));
});

test("fails closed on invalid decision freshness policy", () => {
  assert.throws(
    () => validatePaperAutonomousDecisions(Object.freeze([validDecision]), { now: 1_000, maxDecisionAgeMs: -1 }),
    /PAPER_DECISION_MAX_AGE_INVALID/,
  );
});

test("fails closed when one market has multiple autonomous decisions in a tick", () => {
  const second = Object.freeze({ ...validDecision, action: "SELL" as const, decidedAt: 996 });
  assert.throws(
    () => validatePaperAutonomousDecisions(Object.freeze([validDecision, second]), { now: 1_000 }),
    /PAPER_DECISION_DUPLICATE_SYMBOL/,
  );
});

test("fails closed on tampered PAPER candidate authority", () => {
  const invalid = Object.freeze({
    ...validDecision,
    paperCandidateBinding: Object.freeze({
      schemaVersion: 1 as const,
      status: "BOUND_UNVERIFIED" as const,
      authority: "PAPER_RESEARCH_ONLY" as const,
      liveAuthority: "NONE" as const,
      productionMutationAllowed: true,
      candidateId: "candidate-alpha",
      datasetId: "dataset-alpha",
      datasetContentSha256: "a".repeat(64),
      advisoryGeneratedAt: 900,
      periodStartAt: 925,
      advisoryFingerprintSha256: "b".repeat(64),
      bindingFingerprintSha256: "c".repeat(64),
    }),
  }) as unknown as CioDecision;

  assert.throws(
    () => validatePaperAutonomousDecisions(Object.freeze([invalid]), { now: 1_000 }),
    /authority must remain fail-closed/,
  );
});
