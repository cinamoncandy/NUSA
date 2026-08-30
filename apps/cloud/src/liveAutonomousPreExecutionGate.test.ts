import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateLiveAutonomousPreExecution,
  type LiveAutonomousPreExecutionRequest,
} from "./liveAutonomousPreExecutionGate";

const baseRequest: LiveAutonomousPreExecutionRequest = Object.freeze({
  ownerPrincipalId: "owner-alpha",
  policyOwnerPrincipalId: "owner-alpha",
  market: "KRW-BTC",
  side: "BUY",
  requestedNotionalUsd: 10_000,
  totalEquityUsd: 100_000,
  investmentCapitalWeight: 0.2,
  riskApprovedNotionalUsd: 12_000,
  riskDecision: "ALLOW",
  runtimeActive: true,
  killSwitchActive: false,
  tradingAllowed: true,
  overallHealth: "HEALTHY",
  marketTrusted: true,
  observedAt: 990_000,
  decidedAt: 995_000,
  now: 1_000_000,
});

function evaluate(overrides: Partial<LiveAutonomousPreExecutionRequest> = {}) {
  return evaluateLiveAutonomousPreExecution(Object.freeze({ ...baseRequest, ...overrides }));
}

test("creates a bounded readiness envelope without granting production mutation authority", () => {
  const result = evaluate();
  assert.equal(result.status, "READY");
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.ownerCapitalCeilingUsd, 20_000);
  assert.equal(result.riskApprovedNotionalUsd, 12_000);
  assert.equal(result.maxAuthorizedNotionalUsd, 12_000);
  assert.deepEqual(result.blockers, []);
  assert.match(result.authorizationFingerprintSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.expiresAt, result.issuedAt + 15_000);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.blockers));
});

test("rejects notional above the owner's investment-capital ceiling", () => {
  const result = evaluate({ requestedNotionalUsd: 25_000, riskApprovedNotionalUsd: 50_000 });
  assert.equal(result.status, "REJECTED");
  assert.ok(result.blockers.includes("NOTIONAL_EXCEEDS_OWNER_CEILING"));
  assert.equal(result.maxAuthorizedNotionalUsd, 20_000);
});

test("rejects notional above the independently risk-approved amount", () => {
  const result = evaluate({ requestedNotionalUsd: 13_000 });
  assert.equal(result.status, "REJECTED");
  assert.ok(result.blockers.includes("NOTIONAL_EXCEEDS_RISK_LIMIT"));
});

test("zero owner investment allocation disables autonomous LIVE readiness", () => {
  const result = evaluate({ investmentCapitalWeight: 0, requestedNotionalUsd: 1, riskApprovedNotionalUsd: 10_000 });
  assert.equal(result.status, "REJECTED");
  assert.ok(result.blockers.includes("OWNER_CAPITAL_DISABLED"));
  assert.ok(result.blockers.includes("NOTIONAL_EXCEEDS_OWNER_CEILING"));
  assert.equal(result.maxAuthorizedNotionalUsd, 0);
});

test("kill switch, inactive runtime, and unhealthy runtime fail closed", () => {
  const result = evaluate({ runtimeActive: false, killSwitchActive: true, overallHealth: "DEGRADED" });
  assert.equal(result.status, "REJECTED");
  assert.ok(result.blockers.includes("RUNTIME_INACTIVE"));
  assert.ok(result.blockers.includes("KILL_SWITCH_ACTIVE"));
  assert.ok(result.blockers.includes("RUNTIME_UNHEALTHY"));
});

test("rejects stale or untrusted market evidence", () => {
  const result = evaluate({ marketTrusted: false, observedAt: 969_999 });
  assert.equal(result.status, "REJECTED");
  assert.ok(result.blockers.includes("MARKET_INPUT_UNTRUSTED"));
  assert.ok(result.blockers.includes("MARKET_INPUT_STALE"));
});

test("rejects stale autonomous decisions", () => {
  const result = evaluate({ decidedAt: 969_999 });
  assert.equal(result.status, "REJECTED");
  assert.ok(result.blockers.includes("DECISION_STALE"));
});

test("rejects owner principal mismatch and risk rejection", () => {
  const result = evaluate({ policyOwnerPrincipalId: "owner-beta", riskDecision: "REJECT" });
  assert.equal(result.status, "REJECTED");
  assert.ok(result.blockers.includes("OWNER_PRINCIPAL_MISMATCH"));
  assert.ok(result.blockers.includes("RISK_REJECTED"));
});

test("fingerprint is deterministic and exact-request bound", () => {
  const first = evaluate();
  const second = evaluate();
  const changed = evaluate({ requestedNotionalUsd: 9_999 });
  assert.equal(first.authorizationFingerprintSha256, second.authorizationFingerprintSha256);
  assert.notEqual(first.authorizationFingerprintSha256, changed.authorizationFingerprintSha256);
});

test("custom freshness and expiry bounds are enforced", () => {
  const ready = evaluate({ maxInputAgeMs: 5_001, observedAt: 995_000, decidedAt: 995_000, ttlMs: 1_000 });
  assert.equal(ready.status, "READY");
  assert.equal(ready.expiresAt, 1_001_000);

  const invalidTtl = evaluate({ ttlMs: 60_001 });
  assert.equal(invalidTtl.status, "REJECTED");
  assert.ok(invalidTtl.blockers.includes("INVALID_INPUT"));
});

test("malformed numeric input fails closed with zero executable bound", () => {
  const result = evaluate({ requestedNotionalUsd: Number.NaN });
  assert.equal(result.status, "REJECTED");
  assert.ok(result.blockers.includes("INVALID_INPUT"));
  assert.equal(result.requestedNotionalUsd, 0);
  assert.equal(result.maxAuthorizedNotionalUsd, 0);
  assert.equal(result.productionMutationAllowed, false);
});
