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
  for (const code of ["BLOCKED:OPEN_P0_ALERT", "BLOCKED:P0_STATE_UNVERIFIABLE", "BLOCKED:STRATEGY_APPROVAL_REJECTED", "REJECTED:MAX_ORDER_NOTIONAL"]) {
    assert.equal(describePaperOrderReason(code).category, "RISK_BLOCKED", code);
  }
  assert.equal(describePaperOrderReason("BLOCKED:PAPER_CANDIDATE_BINDING_REQUIRED").category, "INSUFFICIENT_EVIDENCE");
  assert.equal(describePaperOrderReason("FILLED:FILLED").category, "FILLED");
});

test("an unrecognised code is shown verbatim, and malformed or absent values produce no reason", () => {
  assert.equal(describePaperOrderReason("BLOCKED:SOME_NEW_REASON").text, "직전 판단 결과: BLOCKED:SOME_NEW_REASON");
  for (const value of [null, undefined, "", "hold", "balance is 9,999 KRW", "blocked:lower_case"]) assert.equal(describePaperOrderReason(value), null, String(value));
});

test("every code the cloud can emit is either described or shown verbatim, never dropped", () => {
  for (const result of [{ status: "WAIT", reason: "no actionable paper decision" }, { status: "BLOCKED", reason: "PAPER_INVESTMENT_ALLOCATION_EXCEEDED" }, { status: "REJECTED", risk: { status: "REJECT", reasonCodes: ["A_CODE"] } }, { status: "FILLED" }]) {
    const reason = describePaperOrderReason(codePaperDecisionOutcome(result));
    assert.ok(reason != null && reason.text.length > 0);
  }
});

test("HOME renders the reason from the heartbeat outcome and the contract validates its shape", () => {
  const view = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "src", "homeView.tsx"), "utf8");
  assert.match(view, /describePaperOrderReason\(snapshot\?\.operations\.heartbeat\?\.lastPaperDecisionOutcome\)/);
  assert.match(view, /disconnected \|\| readOnlyError != null \? null : describePaperOrderReason/, "hidden while disconnected or recovering");
  assert.match(view, /testID="home-no-order-reason"/);
  const contract = fs.readFileSync(path.join(__dirname, "..", "packages", "contracts", "src", "personalPaperOperations.ts"), "utf8");
  assert.match(contract, /lastPaperDecisionOutcome must be a coded STATUS:REASON when present/);
});
