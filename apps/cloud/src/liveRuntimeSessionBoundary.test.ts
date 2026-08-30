import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  engageLiveKillSwitch,
  evaluateLiveRuntimeSession,
  revokeLiveRuntimeSession,
  stopLiveRuntimeSession,
  type LiveRuntimeSession,
} from "./liveRuntimeSessionBoundary";

const activeSession = (): LiveRuntimeSession => ({
  sessionId: "session-1",
  ownerPrincipalId: "owner-1",
  investmentCapitalWeight: 0.25,
  state: "ACTIVE",
  killSwitchEngaged: false,
  activatedAtMs: 1_000,
  expiresAtMs: 2_000,
});

describe("live runtime session boundary", () => {
  it("allows only the bound owner inside an active bounded session", () => {
    assert.deepEqual(evaluateLiveRuntimeSession(activeSession(), "owner-1", 1_500), {
      allowed: true,
      investmentCapitalWeight: 0.25,
    });
    assert.deepEqual(evaluateLiveRuntimeSession(activeSession(), "other", 1_500), {
      allowed: false,
      reason: "OWNER_MISMATCH",
    });
  });

  it("fails closed on invalid capital allocation", () => {
    assert.deepEqual(
      evaluateLiveRuntimeSession({ ...activeSession(), investmentCapitalWeight: 1.01 }, "owner-1", 1_500),
      { allowed: false, reason: "CAPITAL_WEIGHT_INVALID" },
    );
    assert.deepEqual(
      evaluateLiveRuntimeSession({ ...activeSession(), investmentCapitalWeight: 0 }, "owner-1", 1_500),
      { allowed: false, reason: "CAPITAL_WEIGHT_INVALID" },
    );
  });

  it("fails closed when stopped, killed, revoked, or expired", () => {
    assert.equal(evaluateLiveRuntimeSession(stopLiveRuntimeSession(activeSession()), "owner-1", 1_500).allowed, false);
    assert.deepEqual(evaluateLiveRuntimeSession(engageLiveKillSwitch(activeSession()), "owner-1", 1_500), {
      allowed: false,
      reason: "KILL_SWITCH_ENGAGED",
    });
    assert.deepEqual(evaluateLiveRuntimeSession(revokeLiveRuntimeSession(activeSession(), 1_400), "owner-1", 1_500), {
      allowed: false,
      reason: "KILL_SWITCH_ENGAGED",
    });
    assert.deepEqual(evaluateLiveRuntimeSession(activeSession(), "owner-1", 2_000), {
      allowed: false,
      reason: "SESSION_EXPIRED",
    });
  });

  it("fails closed on malformed session windows and time", () => {
    assert.deepEqual(evaluateLiveRuntimeSession({ ...activeSession(), expiresAtMs: 1_000 }, "owner-1", 1_000), {
      allowed: false,
      reason: "SESSION_WINDOW_INVALID",
    });
    assert.deepEqual(evaluateLiveRuntimeSession(activeSession(), "owner-1", Number.NaN), {
      allowed: false,
      reason: "TIME_INVALID",
    });
  });
});
