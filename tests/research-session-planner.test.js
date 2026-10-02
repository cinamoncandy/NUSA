const test = require("node:test");
const assert = require("node:assert/strict");

const { planResearchSession, researchSessionIdFor, MAX_DAILY_RESEARCH_EXPERIMENTS } = require("../dist/apps/cloud/src/researchSessionPlanner.js");
const { ResearchMarketWindow } = require("../dist/apps/cloud/src/researchMarketWindow.js");

const NOW = Date.UTC(2026, 9, 2, 3, 0, 0); // 2026-10-02 12:00 KST
const base = { nowMs: NOW, sessions: [], dailyBudget: 288, recoveryReady: true };

test("starts one session for today with the daily budget", () => {
  const plan = planResearchSession(base);
  assert.deepEqual({ ...plan }, { action: "START", sessionId: "research-2026-10-02", maxExperiments: 288 });
  assert.equal(researchSessionIdFor(NOW), "research-2026-10-02");
});

test("session id follows the KST trading day, not UTC", () => {
  assert.equal(researchSessionIdFor(Date.UTC(2026, 9, 1, 15, 30)), "research-2026-10-02"); // 00:30 KST next day
  assert.equal(researchSessionIdFor(Date.UTC(2026, 9, 1, 14, 30)), "research-2026-10-01"); // 23:30 KST
});

test("never starts a second session today, whatever state today's session is in", () => {
  for (const state of ["RUNNING", "COMPLETED", "HALTED", "FAILED", "PAUSED", "IDLE"]) {
    const plan = planResearchSession({ ...base, sessions: [{ sessionId: "research-2026-10-02", state }] });
    assert.deepEqual({ ...plan }, { action: "NONE", reason: "TODAY_SESSION_EXISTS" }, state);
  }
});

test("waits while an earlier session is still RUNNING (runtime supports one)", () => {
  const plan = planResearchSession({ ...base, sessions: [{ sessionId: "research-2026-10-01", state: "RUNNING" }] });
  assert.deepEqual({ ...plan }, { action: "NONE", reason: "PREVIOUS_SESSION_STILL_RUNNING" });
});

test("a COMPLETED earlier session does not block today's start", () => {
  const plan = planResearchSession({ ...base, sessions: [{ sessionId: "research-2026-10-01", state: "COMPLETED" }] });
  assert.equal(plan.action, "START");
});

test("fails closed on recovery not ready, bad clock and bad budget", () => {
  assert.equal(planResearchSession({ ...base, recoveryReady: false }).reason, "RECOVERY_NOT_READY");
  assert.equal(planResearchSession({ ...base, nowMs: 0 }).reason, "INVALID_CLOCK");
  assert.equal(planResearchSession({ ...base, nowMs: NaN }).reason, "INVALID_CLOCK");
  for (const budget of [0, -1, 1.5, MAX_DAILY_RESEARCH_EXPERIMENTS + 1, NaN]) assert.equal(planResearchSession({ ...base, dailyBudget: budget }).reason, "INVALID_BUDGET", String(budget));
});

const p = (price, observedAt, market = "KRW-BTC") => ({ market, price, observedAt });

test("market window keeps a bounded, ordered history and returns only full windows", () => {
  const w = new ResearchMarketWindow(3);
  for (let i = 1; i <= 5; i += 1) assert.equal(w.push(p(100 + i, i * 1000)), "ACCEPTED");
  assert.equal(w.size("KRW-BTC"), 3);
  assert.deepEqual(w.window("KRW-BTC", 3).map((x) => x.observedAt), [3000, 4000, 5000]);
  assert.deepEqual(w.window("KRW-BTC", 2).map((x) => x.observedAt), [4000, 5000]);
  assert.equal(w.window("KRW-BTC", 4).length, 0);
  assert.equal(w.window("KRW-ETH", 1).length, 0);
});

test("market window rejects bad data instead of repairing it", () => {
  const w = new ResearchMarketWindow(5);
  assert.equal(w.push(p(100, 1000)), "ACCEPTED");
  assert.equal(w.push(p(100, 1000)), "OUT_OF_ORDER");
  assert.equal(w.push(p(100, 500)), "OUT_OF_ORDER");
  for (const bad of [p(0, 2000), p(-1, 2000), p(NaN, 2000), p(100, 0), p(100, 1.5), p(100, 2000, "BTC-KRW"), p(100, 2000, "")]) assert.equal(w.push(bad), "INVALID");
  assert.equal(w.size("KRW-BTC"), 1);
  assert.throws(() => new ResearchMarketWindow(1));
});
