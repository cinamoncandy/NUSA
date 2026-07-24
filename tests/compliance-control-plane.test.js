const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ComplianceDecisionType,
  ComplianceEventType,
  ComplianceCaseState
} = require("../dist/packages/contracts/src/compliance.js");
const {
  createComplianceRule,
  evaluateCompliance,
  analyzeSurveillance,
  appendComplianceEvent,
  replayComplianceLedger,
  buildRegulatoryReport
} = require("../dist/apps/cloud/src/complianceControlPlane.js");
const { SqliteDatabase, SqliteComplianceControlPlaneStore } = require("../dist/packages/storage/src/index.js");

const rule = () => createComplianceRule({ ruleId: "kr-trading", version: "1.0.0", jurisdiction: "KR", effectiveAt: 1, prohibitedSymbols: ["KRW-X"], restrictedPartyIds: ["review"], sanctionedPartyIds: ["sanctioned"], requiredEvidenceTypes: ["KYC"] });
const intent = (overrides = {}) => ({ intentId: "intent-1", tenantId: "tenant-1", jurisdiction: "KR", symbol: "KRW-BTC", partyId: "party-1", evidenceReferences: ["KYC"], evaluatedAt: 10, ...overrides });
const event = (type, payload, occurredAt = 10) => ({ eventId: `${type}-${occurredAt}`, type, occurredAt, payload, evidenceReferences: ["evidence-1"] });

test("unknown or incomplete compliance evidence never permits an order", () => {
  assert.equal(evaluateCompliance(undefined, intent(), "d-unknown").decision, ComplianceDecisionType.UNKNOWN);
  assert.equal(evaluateCompliance(rule(), intent({ partyId: undefined }), "d-party").decision, ComplianceDecisionType.UNKNOWN);
  assert.equal(evaluateCompliance(rule(), intent({ symbol: "KRW-X" }), "d-symbol").decision, ComplianceDecisionType.BLOCK);
  assert.equal(evaluateCompliance(rule(), intent({ partyId: "review" }), "d-review").decision, ComplianceDecisionType.REQUIRE_REVIEW);
  assert.equal(evaluateCompliance(rule(), intent(), "d-allow").decision, ComplianceDecisionType.ALLOW);
});

test("immutable event replay verifies rule-versioned decisions and case evidence", () => {
  const decision = evaluateCompliance(rule(), intent(), "decision-1");
  const first = appendComplianceEvent([], event(ComplianceEventType.COMPLIANCE_EVALUATED, { decision }));
  const second = appendComplianceEvent(first, event(ComplianceEventType.COMPLIANCE_CASE_CREATED, { case: { caseId: "case-1", state: ComplianceCaseState.OPEN, alertId: "alert-1", evidenceReferences: [], updatedAt: 11 } }, 11));
  const third = appendComplianceEvent(second, event(ComplianceEventType.EVIDENCE_ATTACHED, { caseId: "case-1" }, 12));
  const closed = appendComplianceEvent(third, event(ComplianceEventType.COMPLIANCE_CASE_CLOSED, { caseId: "case-1" }, 13));
  const replay = replayComplianceLedger(closed);
  assert.equal(replay.decisions.get("decision-1").ruleVersion, "1.0.0");
  assert.equal(replay.cases.get("case-1").state, ComplianceCaseState.CLOSED);
  assert.ok(Object.isFrozen(closed));
  assert.throws(() => replayComplianceLedger([{ ...closed[0], hash: "0".repeat(64) }]), /integrity/);
  assert.throws(() => appendComplianceEvent(second, event(ComplianceEventType.COMPLIANCE_CASE_CLOSED, { caseId: "case-1" }, 12)), /case cannot close/);
});

test("surveillance is deterministic and raises append-only wash and cancellation alerts", () => {
  const observations = [
    { observationId: "fill-1", occurredAt: 1, accountId: "a", counterpartyAccountId: "a", symbol: "KRW-BTC", type: "FILL", evidenceReferences: ["fill-proof"] },
    ...[2, 3, 4, 5, 6].map((occurredAt) => ({ observationId: `cancel-${occurredAt}`, occurredAt, accountId: "a", symbol: "KRW-BTC", type: "CANCEL", evidenceReferences: ["order-proof"] }))
  ];
  const first = analyzeSurveillance(observations);
  assert.deepEqual(first, analyzeSurveillance([...observations].reverse()));
  assert.deepEqual(first.map(alert => alert.pattern), ["WASH_TRADING", "EXCESSIVE_CANCELLATIONS"]);
  const record = appendComplianceEvent([], event(ComplianceEventType.SURVEILLANCE_ALERT_RAISED, { alert: first[0] }));
  assert.equal(replayComplianceLedger(record).alerts.length, 1);
});

test("regulatory reports and SQLite state are deterministic, durable, and tamper-evident", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const store = new SqliteComplianceControlPlaneStore(db);
    const decision = evaluateCompliance(rule(), intent(), "decision-sqlite");
    store.append(event(ComplianceEventType.COMPLIANCE_EVALUATED, { decision }));
    store.verify();
    const report = buildRegulatoryReport("report-1", "KR", store.list(), 20);
    assert.equal(report.reportHash, buildRegulatoryReport("report-1", "KR", store.list(), 20).reportHash);
    db.connection.prepare("UPDATE compliance_state SET ledger_hash=? WHERE id=1").run("0".repeat(64));
    assert.throws(() => store.verify(), /snapshot mismatch/);
  } finally { db.close(); }
});
