import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateLiveSessionBoundPreExecution } from "./liveSessionBoundPreExecution";
import type { LiveRuntimeSession } from "./liveRuntimeSessionBoundary";

const session = (overrides: Partial<LiveRuntimeSession> = {}): LiveRuntimeSession => ({
  sessionId: "session-1",
  ownerPrincipalId: "owner-1",
  investmentCapitalWeight: 0.25,
  state: "ACTIVE",
  killSwitchEngaged: false,
  activatedAtMs: 1_000,
  expiresAtMs: 10_000,
  ...overrides,
});

const request = (overrides: Record<string, unknown> = {}) => ({
  ownerPrincipalId: "owner-1",
  policyOwnerPrincipalId: "owner-1",
  market: "BTC-USDT",
  side: "BUY" as const,
  requestedNotionalUsd: 100,
  totalEquityUsd: 1_000,
  riskApprovedNotionalUsd: 200,
  riskDecision: "ALLOW" as const,
  tradingAllowed: true,
  overallHealth: "HEALTHY" as const,
  marketTrusted: true,
  observedAt: 1_500,
  decidedAt: 1_500,
  now: 1_600,
  session: session(),
  ...overrides,
});

describe("live session-bound pre-execution", () => {
  it("derives the owner capital ceiling from the active session", () => {
    const result = evaluateLiveSessionBoundPreExecution(request());
    assert.equal(result.status, "READY");
    assert.equal(result.ownerCapitalCeilingUsd, 250);
    assert.equal(result.maxAuthorizedNotionalUsd, 200);
    assert.equal(result.liveAuthority, "NONE");
    assert.equal(result.productionMutationAllowed, false);
  });

  it("fails closed when the session owner mismatches", () => {
    const result = evaluateLiveSessionBoundPreExecution(request({ session: session({ ownerPrincipalId: "other" }) }));
    assert.equal(result.status, "REJECTED");
    assert.ok(result.blockers.includes("RUNTIME_INACTIVE"));
    assert.ok(result.blockers.includes("OWNER_CAPITAL_DISABLED"));
  });

  it("fails closed when the session is expired", () => {
    const result = evaluateLiveSessionBoundPreExecution(request({ now: 10_000 }));
    assert.equal(result.status, "REJECTED");
    assert.ok(result.blockers.includes("RUNTIME_INACTIVE"));
    assert.ok(result.blockers.includes("OWNER_CAPITAL_DISABLED"));
  });

  it("propagates an engaged session kill switch", () => {
    const result = evaluateLiveSessionBoundPreExecution(request({
      session: session({ killSwitchEngaged: true, state: "STOPPED" }),
    }));
    assert.equal(result.status, "REJECTED");
    assert.ok(result.blockers.includes("KILL_SWITCH_ACTIVE"));
    assert.ok(result.blockers.includes("RUNTIME_INACTIVE"));
  });

  it("cannot exceed the session capital allocation even when risk allows more", () => {
    const result = evaluateLiveSessionBoundPreExecution(request({
      requestedNotionalUsd: 300,
      riskApprovedNotionalUsd: 500,
    }));
    assert.equal(result.status, "REJECTED");
    assert.ok(result.blockers.includes("NOTIONAL_EXCEEDS_OWNER_CEILING"));
  });
});
