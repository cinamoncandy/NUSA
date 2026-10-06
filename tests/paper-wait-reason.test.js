"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyPaperWait, PAPER_WAIT_REASONS } = require("../dist/apps/cloud/src/paperWaitReason.js");
const { PaperFunnelCounters } = require("../dist/apps/cloud/src/paperFunnelCounters.js");

test("only WAIT decisions get a wait reason", () => {
  for (const action of ["BUY", "SELL", "HOLD", "REDUCE", "EXIT"]) assert.equal(classifyPaperWait({ action }), null);
});

test("each WAIT maps to exactly one fixed code from the decision's own fields", () => {
  const cases = [
    [{ action: "WAIT", risk: "HIGH" }, "RISK_REGIME"],
    [{ action: "WAIT", risk: "CRITICAL", paperCandidateStrategyDecision: { action: "BUY" } }, "RISK_REGIME"],
    [{ action: "WAIT", risk: "MEDIUM" }, "NO_SIGNAL"],
    [{ action: "WAIT", risk: "LOW", allocation: 0, paperCandidateStrategyDecision: { action: "WAIT", reason: "INSUFFICIENT_SMA_OBSERVATIONS:12/20" } }, "INSUFFICIENT_HISTORY"],
    [{ action: "WAIT", risk: "LOW", allocation: 0, paperCandidateStrategyDecision: { action: "WAIT", reason: "SMA_CROSSOVER:5/20:short=1:long=1" } }, "LOW_CONFIDENCE"],
    [{ action: "WAIT", risk: "LOW", allocation: 0, paperCandidateStrategyDecision: { action: "HOLD" } }, "NO_SIGNAL"],
    [{ action: "WAIT", risk: "LOW", allocation: 0, paperCandidateStrategyDecision: { action: "SELL" } }, "NO_POSITION_TO_SELL"],
    [{ action: "WAIT", risk: "LOW", allocation: 0.3, paperCandidateStrategyDecision: { action: "BUY" } }, "ALREADY_IN_POSITION"],
    [{ action: "WAIT", risk: "LOW", allocation: 0, paperCandidateStrategyDecision: { action: "BUY" } }, "TRADING_DISABLED"],
  ];
  for (const [decision, code] of cases) {
    assert.equal(classifyPaperWait(decision), code, JSON.stringify(decision));
    assert.ok(PAPER_WAIT_REASONS.includes(code));
    assert.match(code, /^[A-Z][A-Z0-9_]+$/, "a funnel-safe code");
  }
});

test("the funnel counts WAIT decisions per bounded reason", () => {
  const f = new PaperFunnelCounters(() => 1);
  f.observe({ stage: "DECISION", status: "PASS", reason: "NO_ACTIONABLE_PAPER_DECISION:WAIT:INSUFFICIENT_HISTORY", decision: { action: "WAIT" } });
  f.observe({ stage: "DECISION", status: "PASS", reason: "NO_ACTIONABLE_PAPER_DECISION:WAIT:NO_SIGNAL", decision: { action: "WAIT" } });
  const counts = f.snapshot().counts;
  assert.equal(counts["DECISION:PASS:WAIT"], 2);
  assert.equal(counts["DECISION:PASS:NO_ACTIONABLE_PAPER_DECISION"], 2);
  assert.equal(counts["DECISION:PASS:INSUFFICIENT_HISTORY"], 1);
  assert.equal(counts["DECISION:PASS:NO_SIGNAL"], 1);
});

test("the runtime records the classified reason on WAIT decisions only", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "apps", "cloud", "src", "runtime.ts"), "utf8");
  assert.match(src, /canonicalDecision\.action === "WAIT" \? `NO_ACTIONABLE_PAPER_DECISION:WAIT:\$\{classifyPaperWait\(canonicalDecision\) \?\? "NO_SIGNAL"\}`/);
});
