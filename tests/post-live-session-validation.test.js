"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { POST_LIVE_VALIDATION_DESCRIPTOR, evaluatePostLiveSessionEvidence } = require("../dist/apps/execution/src/index.js");
const { validatePostLiveSessionValidation } = require("../scripts/validate-post-live-session-validation.js");

const REV = "1".repeat(40);
const HASH = (char) => char.repeat(64);

function valid(overrides = {}) {
  const base = {
    sessionId: "tiny-session-1",
    codeRevision: REV,
    configurationHash: HASH("2"),
    releaseSealFingerprint: HASH("3"),
    externalReadOnlyPreflightReceiptFingerprint: HASH("4"),
    ceremonyRecordFingerprint: HASH("5"),
    boundedEnvelopeFingerprint: HASH("6"),
    auditAnchor: HASH("7"),
    startedAt: "2026-08-08T03:00:00.000Z",
    endedAt: "2026-08-08T03:30:00.000Z",
    approvedLimits: {
      maxOrderNotionalBps: 10,
      maxGrossExposureBps: 50,
      maxDailyLossBps: 10,
      maxOpenOrders: 1,
      maxPositionCount: 1,
      maxSessionOrders: 5,
      maxSessionDurationSeconds: 3600,
    },
    observed: {
      orderCount: 2,
      maxOrderNotionalBps: 8,
      maxGrossExposureBps: 20,
      realizedDailyLossBps: 1,
      maxOpenOrders: 1,
      maxPositionCount: 1,
    },
    reconciliation: { orders: "MATCH", fills: "MATCH", positions: "MATCH", cash: "MATCH" },
    checks: { hardRisk: "PASS", haltPath: "PASS", auditChain: "PASS", postTradeObservation: "PASS" },
    executionTransportAtValidation: "CLOSED",
    mutationAfterSessionClose: "NO",
  };
  return { ...base, ...overrides };
}

test("clean synthetic tiny session is ready for human review only", () => {
  const result = evaluatePostLiveSessionEvidence(valid());
  assert.equal(result.verdict, "READY_FOR_HUMAN_REVIEW");
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.unknowns, []);
  assert.match(result.validationFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(result.scaleUpAuthority, false);
  assert.equal(result.activationAuthority, false);
  assert.equal(result.orderAuthorization, false);
  assert.equal(result.executionAuthority, false);
  assert.equal(result.authorizesLive, false);
  assert.equal(result.mutationPerformed, false);
  assert.equal(result.realMoneyExecutionAllowed, false);
});

test("limit excess and hard-ceiling expansion block safely", () => {
  const excess = valid({ observed: { ...valid().observed, maxOrderNotionalBps: 11 } });
  const result = evaluatePostLiveSessionEvidence(excess);
  assert.equal(result.verdict, "SAFE_BLOCK");
  assert.ok(result.blockers.includes("ORDER_NOTIONAL_EXCEEDED"));

  const expanded = valid({ approvedLimits: { ...valid().approvedLimits, maxSessionOrders: 6 } });
  const expandedResult = evaluatePostLiveSessionEvidence(expanded);
  assert.equal(expandedResult.verdict, "SAFE_BLOCK");
  assert.ok(expandedResult.blockers.some((item) => item.includes("HARD_CEILING")));
});

test("reconciliation diff failed safety open transport and post-close mutation block", () => {
  assert.equal(evaluatePostLiveSessionEvidence(valid({ reconciliation: { ...valid().reconciliation, cash: "DIFF" } })).verdict, "SAFE_BLOCK");
  assert.equal(evaluatePostLiveSessionEvidence(valid({ checks: { ...valid().checks, hardRisk: "FAIL" } })).verdict, "SAFE_BLOCK");
  assert.equal(evaluatePostLiveSessionEvidence(valid({ executionTransportAtValidation: "OPEN" })).verdict, "SAFE_BLOCK");
  assert.equal(evaluatePostLiveSessionEvidence(valid({ mutationAfterSessionClose: "YES" })).verdict, "SAFE_BLOCK");
});

test("unknown safety or reconciliation evidence remains UNKNOWN", () => {
  const reconciliationUnknown = evaluatePostLiveSessionEvidence(valid({ reconciliation: { ...valid().reconciliation, fills: "UNKNOWN" } }));
  assert.equal(reconciliationUnknown.verdict, "UNKNOWN");
  assert.equal(reconciliationUnknown.scaleUpAuthority, false);
  const safetyUnknown = evaluatePostLiveSessionEvidence(valid({ checks: { ...valid().checks, auditChain: "UNKNOWN" } }));
  assert.equal(safetyUnknown.verdict, "UNKNOWN");
  const transportUnknown = evaluatePostLiveSessionEvidence(valid({ executionTransportAtValidation: "UNKNOWN" }));
  assert.equal(transportUnknown.verdict, "UNKNOWN");
});

test("identical normalized evidence yields identical validation fingerprint", () => {
  const first = evaluatePostLiveSessionEvidence(valid());
  const second = evaluatePostLiveSessionEvidence(valid());
  assert.equal(first.validationFingerprint, second.validationFingerprint);
  const changed = evaluatePostLiveSessionEvidence(valid({ sessionId: "tiny-session-2" }));
  assert.notEqual(first.validationFingerprint, changed.validationFingerprint);
});

test("source guard proves validator cannot trade or scale up", () => {
  const result = validatePostLiveSessionValidation();
  assert.equal(result.ok, true, result.failures.join(","));
  assert.equal(POST_LIVE_VALIDATION_DESCRIPTOR.actualLiveSessionInCi, false);
  assert.equal(POST_LIVE_VALIDATION_DESCRIPTOR.scaleUpAuthority, false);
  assert.equal(POST_LIVE_VALIDATION_DESCRIPTOR.activationAuthority, false);
  assert.equal(POST_LIVE_VALIDATION_DESCRIPTOR.orderAuthorization, false);
  assert.equal(POST_LIVE_VALIDATION_DESCRIPTOR.executionAuthority, false);
  assert.equal(POST_LIVE_VALIDATION_DESCRIPTOR.authorizesLive, false);
  assert.equal(POST_LIVE_VALIDATION_DESCRIPTOR.realMoneyExecutionAllowed, false);
});
