const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describePaperOrderReason } = require("../dist/apps/mobile/src/paperOrderReason.js");
const { codePaperDecisionOutcome } = require("../dist/apps/cloud/src/paperDecisionOutcome.js");

test("the no-signal outcome explains that the strategy simply produced no order", () => {
  const reason = describePaperOrderReason("WAIT:NO_ACTIONABLE_PAPER_DECISION");
  assert.equal(reason.category, "WAITING");
  assert.match(reason.text, /신호를 내지 않아 주문하지 않았습니다/);
});

test("exchange-minimum and allocation blocks are execution constraints, risk and P0 blocks are risk blocks", () => {
  for (const code of ["BLOCKED:PAPER_EXECUTION_INTENT_MINIMUM_ORDER_EXCEEDS_CASH", "BLOCKED:PAPER_EXECUTION_INTENT_MINIMUM_ORDER_EXCEEDS_EQUITY_CEILING", "BLOCKED:PAPER_EXECUTION_INTENT_EXECUTABLE_QUOTE_BELOW_MINIMUM", "BLOCKED:PAPER_INVESTMENT_ALLOCATION_EXCEEDED"]) {
    assert.equal(describePaperOrderReason(code).category, "EXECUTION_BLOCKED", code);
  }
  for (const code of ["BLOCKED:OPEN_P0_ALERT", "BLOCKED:P0_STATE_UNVERIFIABLE", "BLOCKED:STRATEGY_APPROVAL_REJECTED", "REJECTED:PAPER_RISK_REJECT:MAX_ORDER_NOTIONAL", "BLOCKED:PAPER_RISK_HALT:KILL_SWITCH_ACTIVE"]) {
    assert.equal(describePaperOrderReason(code).category, "RISK_BLOCKED", code);
  }
  assert.equal(describePaperOrderReason("BLOCKED:PAPER_CANDIDATE_BINDING_REQUIRED").category, "INSUFFICIENT_EVIDENCE");
  assert.equal(describePaperOrderReason("REJECTED:INSUFFICIENT_PAPER_POSITION").category, "EXECUTION_BLOCKED", "an execution rejection is not a risk failure");
  assert.equal(describePaperOrderReason("REJECTED:DECISION_ALLOCATION_IS_ZERO").category, "EXECUTION_BLOCKED");
  const unknownRejection = describePaperOrderReason("REJECTED:SOMETHING_NEW");
  assert.equal(unknownRejection.category, "UNKNOWN", "an unrecognised rejection is neutral, not labelled as risk");
  assert.doesNotMatch(unknownRejection.text, /위험/);
  assert.equal(describePaperOrderReason("FILLED:FILLED").category, "FILLED");
});

test("an unrecognised code is shown verbatim, and malformed or absent values produce no reason", () => {
  assert.equal(describePaperOrderReason("BLOCKED:SOME_NEW_REASON").text, "직전 판단 결과: BLOCKED:SOME_NEW_REASON");
  for (const value of [null, undefined, "", "hold", "balance is 9,999 KRW", "blocked:lower_case"]) assert.equal(describePaperOrderReason(value), null, String(value));
});

test("every code the cloud can emit is either described or shown verbatim, never dropped", () => {
  for (const result of [{ status: "WAIT", reason: "no actionable paper decision" }, { status: "BLOCKED", reason: "PAPER_INVESTMENT_ALLOCATION_EXCEEDED" }, { status: "REJECTED", reason: "insufficient paper position" }, { status: "REJECTED", reason: "decision allocation is zero" }, { status: "REJECTED", reason: "PAPER_RISK_REJECT:MAX_ORDER_NOTIONAL,FAMILY_EXPOSURE" }, { status: "FILLED" }]) {
    const reason = describePaperOrderReason(codePaperDecisionOutcome(result));
    assert.ok(reason != null && reason.text.length > 0);
  }
});

test("HOME renders the reason from the heartbeat outcome and the contract validates its shape", () => {
  const view = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "homeView.tsx"), "utf8");
  assert.match(view, /describePaperOrderReason\(snapshot\?\.operations\.heartbeat\?\.lastPaperDecisionOutcome\)/);
  assert.match(view, /disconnected \|\| readOnlyError != null \|\| sessionRecovering \? null : describePaperOrderReason/, "hidden while disconnected, errored or recovering");
  assert.match(view, /testID="home-no-order-reason"/);
  const contract = fs.readFileSync(path.join(__dirname, "..", "packages", "contracts", "src", "personalPaperOperations.ts"), "utf8");
  assert.match(contract, /lastPaperDecisionOutcome must be a coded STATUS:REASON when present/);
});

test("the operations validator rejects a non-string decision outcome before testing the pattern", () => {
  const { buildPersonalPaperOperationsSnapshot, validatePersonalPaperOperationsSnapshot } = require("../dist/packages/contracts/src/personalPaperOperations.js");
  const heartbeat = (value) => ({ startedAt: 1_000, lastHeartbeatAt: 1_000, lastMarketEventAt: null, lastPaperDecisionAt: null, lastPaperOrderAt: null, lastPaperFillAt: null, eventCount: 0, decisionCount: 0, paperOrderCount: 0, paperFillCount: 0, lastError: null, lastPaperDecisionOutcome: value });
  const dashboard = { apiVersion: "1", generatedAt: 1_000, mode: "PAPER", killSwitchActive: false, overallHealth: "HEALTHY", tradingAllowed: true, headline: "PAPER healthy", issues: [], deployableCapital: 1_000, deployedCapital: 500, cashCapital: 500, reservedCapital: 0, spotCapital: 500, futuresCapital: 0, positions: [], decisions: [], liveAuthority: "NONE", productionMutationAllowed: false };
  const operations = { runtimeState: "READY", schedulerRunning: true, schedulerMode: "OBSERVE", pipelineStage: "MONITORING", transport: "ONLINE", killSwitchActive: false, accountHalted: false, pendingWrites: 0, lastEventAt: 1_000, updatedAt: 1_000 };
  const attempt = (value) => validatePersonalPaperOperationsSnapshot(buildPersonalPaperOperationsSnapshot({ dashboard, research: null, operations: { ...operations, heartbeat: heartbeat(value) }, paperLearning: null }, 1_000), 1_100, 500);
  assert.equal(attempt("WAIT:NO_ACTIONABLE_PAPER_DECISION").operations.heartbeat.lastPaperDecisionOutcome, "WAIT:NO_ACTIONABLE_PAPER_DECISION");
  assert.equal(attempt(null).operations.heartbeat.lastPaperDecisionOutcome, null);
  assert.throws(() => attempt(["WAIT:NO_ACTIONABLE_PAPER_DECISION"]), /lastPaperDecisionOutcome must be a coded/);
  assert.throws(() => attempt({ toString: () => "WAIT:X" }), /lastPaperDecisionOutcome must be a coded/);
  assert.throws(() => attempt("balance is 9,999 KRW"), /lastPaperDecisionOutcome must be a coded/);
});
