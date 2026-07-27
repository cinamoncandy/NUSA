"use strict";

// This module intentionally does not import either pilot runtime.  Evidence is
// re-sealed and aggregates are re-derived from the complete event stream here.
const { createHash } = require("node:crypto");

const SHADOW_TYPES = new Set(["TEST_FIXTURE", "DRY_RUN", "SHADOW_OPERATIONAL"]);
const CANARY_TYPES = new Set(["TEST_FIXTURE", "DRY_RUN", "CANARY_OPERATIONAL"]);
const OPERATIONAL_TYPES = new Set(["SHADOW_OPERATIONAL", "CANARY_OPERATIONAL"]);

function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}
function hash(value) { return createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex"); }
function unique(values) { return [...new Set(values)].sort(); }
function seal(value, omitted) { const copy = { ...value }; for (const key of omitted) delete copy[key]; return hash(copy); }
function number(value) { return Number.isFinite(value) ? value : 0; }
function result(kind, evidence, errors, aggregate) {
  const raw = { schemaVersion: 1, kind, evidenceType: evidence?.evidenceType ?? "INVALID", sessionId: evidence?.session?.sessionId ?? "", sourceCommitSha: evidence?.session?.sourceCommitSha ?? "", verifierStatus: errors.length ? "FAIL" : "PASS", reasonCodes: unique(errors), aggregate };
  return Object.freeze({ ...raw, verifierResultSha256: hash(raw) });
}
function verifyCommon(evidence, allowed, expected) {
  const errors = [];
  if (!evidence || typeof evidence !== "object") return ["EVIDENCE_MISSING"];
  if (!allowed.has(evidence.evidenceType)) errors.push("EVIDENCE_TYPE_INVALID");
  if (evidence.schemaVersion !== 1) errors.push("SCHEMA_VERSION_INVALID");
  const session = evidence.session;
  if (!session || !session.sessionId || !session.sourceCommitSha || !session.symbol || !session.strategyId) errors.push("SESSION_IDENTITY_INVALID");
  if (!session?.fingerprints || !Object.values(session.fingerprints).every(Boolean)) errors.push("FINGERPRINTS_INVALID");
  if (expected?.sourceCommitSha && session?.sourceCommitSha !== expected.sourceCommitSha) errors.push("SOURCE_COMMIT_MISMATCH");
  if (expected?.fingerprints && JSON.stringify(canonicalize(session?.fingerprints)) !== JSON.stringify(canonicalize(expected.fingerprints))) errors.push("FINGERPRINT_MISMATCH");
  if (!Array.isArray(evidence.events)) errors.push("EVENTS_INVALID");
  if (session?.resultSha256 && session.resultSha256 !== seal(session, ["resultSha256"])) errors.push("SESSION_HASH_MISMATCH");
  if (evidence.resultSha256 && evidence.resultSha256 !== seal(evidence, ["resultSha256"])) errors.push("EVIDENCE_HASH_MISMATCH");
  return errors;
}
function verifyChain(events, sessionId) {
  const errors = []; let previous = "GENESIS"; const hashes = new Set(); const sequences = new Set();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index] || {};
    if (event.sequence !== index + 1 || sequences.has(event.sequence)) errors.push("EVENT_SEQUENCE_INVALID");
    sequences.add(event.sequence);
    if (event.sessionId !== sessionId) errors.push("EVENT_SESSION_MISMATCH");
    if (event.previousEventSha256 !== previous) errors.push("PREVIOUS_EVENT_HASH_MISMATCH");
    if (!event.eventSha256 || hashes.has(event.eventSha256) || event.eventSha256 !== seal(event, ["eventSha256"])) errors.push("EVENT_HASH_MISMATCH");
    hashes.add(event.eventSha256); previous = event.eventSha256;
  }
  return errors;
}
function verifyShadowPilotEvidence(evidence, expected = {}) {
  const errors = verifyCommon(evidence, SHADOW_TYPES, expected); const session = evidence?.session ?? {}; const events = evidence?.events ?? [];
  errors.push(...verifyChain(events, session.sessionId));
  const aggregate = { signalCount: 0, allowCount: 0, rejectCount: 0, haltCount: 0, hypotheticalOrderCount: 0, hypotheticalFillCount: 0, actualOrderCount: 0, actualFillCount: 0, cashMutationCount: 0, positionMutationCount: 0, alertCount: 0, observationMinutes: Math.max(0, number(session.stoppedAt) - number(session.startedAt)) / 60000 };
  for (const event of events) {
    aggregate.signalCount += event.eventType === "SIGNAL_OBSERVED" || event.eventType === "HYPOTHETICAL_FILL" || event.eventType === "BLOCKED" ? 1 : 0;
    aggregate.allowCount += event.riskDecision === "ALLOW" ? 1 : 0; aggregate.rejectCount += event.riskDecision === "REJECT" ? 1 : 0; aggregate.haltCount += event.riskDecision === "HALT" ? 1 : 0;
    aggregate.hypotheticalOrderCount += event.hypotheticalOrderId ? 1 : 0; aggregate.hypotheticalFillCount += event.hypotheticalFillId ? 1 : 0;
    aggregate.actualOrderCount += number(event.actualOrderDelta); aggregate.actualFillCount += number(event.actualFillDelta); aggregate.cashMutationCount += Math.abs(number(event.actualCashDelta)); aggregate.positionMutationCount += Math.abs(number(event.actualPositionDelta));
    aggregate.alertCount += event.eventType === "BLOCKED" ? 1 : 0;
    if (number(event.actualBrokerCallCount) !== 0 || number(event.actualOrderDelta) !== 0 || number(event.actualFillDelta) !== 0 || number(event.actualCashDelta) !== 0 || number(event.actualPositionDelta) !== 0) errors.push("SHADOW_MUTATION");
    if ((event.marketDataStatus && event.marketDataStatus !== "HEALTHY") || event.killSwitchActive || event.openP0 || event.reconciliationStatus === "FAIL" || event.restartAutomaticResume) {
      if (event.hypotheticalOrderId || event.hypotheticalFillId) errors.push("SHADOW_UNSAFE_EXECUTION");
    }
    if ((event.hypotheticalOrderId && !String(event.hypotheticalOrderId).startsWith("shadow-order-")) || (event.hypotheticalFillId && !String(event.hypotheticalFillId).startsWith("shadow-fill-"))) errors.push("SHADOW_NAMESPACE_INVALID");
  }
  const counters = session.counters ?? {};
  for (const key of ["signalCount", "allowCount", "rejectCount", "haltCount", "hypotheticalOrderCount", "hypotheticalFillCount", "actualOrderCount", "actualFillCount", "cashMutationCount", "positionMutationCount"]) if (counters[key] !== undefined && counters[key] !== aggregate[key]) errors.push(`SUMMARY_MISMATCH_${key}`);
  if (evidence?.evidenceType === "SHADOW_OPERATIONAL" && (!Number.isFinite(session.startedAt) || !Number.isFinite(session.stoppedAt) || session.stoppedAt < session.startedAt)) errors.push("OPERATIONAL_OBSERVATION_INVALID");
  return result("SHADOW", evidence, errors, aggregate);
}
function verifyCanaryPilotEvidence(evidence, expected = {}) {
  const errors = verifyCommon(evidence, CANARY_TYPES, expected); const session = evidence?.session ?? {}; const events = evidence?.events ?? []; const approval = evidence?.approval;
  errors.push(...verifyChain(events, session.sessionId));
  if (!approval || !approval.approvalId || !approval.approvedBy || approval.mode !== "PAPER_CANARY" || !Number.isFinite(approval.approvedAt) || !Number.isFinite(approval.expiresAt) || approval.approvedAt >= approval.expiresAt || approval.approvalSha256 !== seal(approval, ["approvalSha256"])) errors.push("APPROVAL_INVALID");
  if (approval && (approval.sourceCommitSha !== session.sourceCommitSha || approval.allowedSymbol !== session.symbol || approval.allowedStrategyId !== session.strategyId || JSON.stringify(canonicalize(approval.fingerprints)) !== JSON.stringify(canonicalize(session.fingerprints)))) errors.push("APPROVAL_BINDING_MISMATCH");
  if (approval && !["maxDurationMinutes", "maxOrders", "maxTrades", "maxOpenPositions", "maxOrderQuantity", "maxOrderNotional", "maxGrossExposure", "maxDailyLoss", "maxSessionLoss", "maxDrawdown", "maxConsecutiveLosses"].every((key) => Number.isFinite(approval[key]) && approval[key] > 0)) errors.push("APPROVAL_LIMIT_INVALID");
  const aggregate = { orderCount: 0, fillCount: 0, completedTradeCount: 0, unauthorizedOrderCount: 0, duplicateFillCount: 0, orphanFillCount: 0, reconciliationFailureCount: 0, automaticRestartViolationCount: 0, reconnectAutoResumeViolationCount: 0, persistenceContinuationViolationCount: 0, p0Count: 0, observationMinutes: Math.max(0, number(session.stoppedAt) - number(session.startedAt)) / 60000 };
  const commands = new Set(), clientOrders = new Set(), orders = new Set(), fills = new Set();
  for (const event of events) {
    if (event.eventType === "ORDER_FILLED") { aggregate.orderCount += 1; aggregate.fillCount += event.fillId ? 1 : 0; if (event.riskDecision !== "ALLOW" || event.canaryDecision !== "ALLOW" || number(event.actualBrokerCallCount) <= 0) aggregate.unauthorizedOrderCount += 1; if (!event.orderId || !event.fillId) aggregate.orphanFillCount += 1; }
    if (event.commandId && commands.has(event.commandId)) errors.push("DUPLICATE_COMMAND"); if (event.commandId) commands.add(event.commandId);
    if (event.clientOrderId && clientOrders.has(event.clientOrderId)) errors.push("DUPLICATE_CLIENT_ORDER"); if (event.clientOrderId) clientOrders.add(event.clientOrderId);
    if (event.orderId && orders.has(event.orderId)) errors.push("DUPLICATE_ORDER"); if (event.orderId) orders.add(event.orderId);
    if (event.fillId && fills.has(event.fillId)) { aggregate.duplicateFillCount += 1; errors.push("DUPLICATE_FILL"); } if (event.fillId) fills.add(event.fillId);
    if (event.reconciliationStatus && event.reconciliationStatus !== "PASS") aggregate.reconciliationFailureCount += 1;
    if (event.restartAutomaticResume) aggregate.automaticRestartViolationCount += 1;
    if (event.reconnectAutomaticResume) aggregate.reconnectAutoResumeViolationCount += 1;
    if (event.persistenceFailure && event.eventType === "ORDER_FILLED") aggregate.persistenceContinuationViolationCount += 1;
    if (event.openP0) aggregate.p0Count += 1;
    if (event.eventType === "ORDER_FILLED" && (event.killSwitchActive || event.openP0 || event.marketDataStatus && event.marketDataStatus !== "HEALTHY" || event.reconciliationStatus && event.reconciliationStatus !== "PASS" || event.restartAutomaticResume || event.reconnectAutomaticResume)) errors.push("CANARY_UNSAFE_ORDER");
  }
  if (aggregate.unauthorizedOrderCount) errors.push("UNAUTHORIZED_ORDER"); if (aggregate.orphanFillCount) errors.push("ORPHAN_FILL"); if (aggregate.reconciliationFailureCount) errors.push("RECONCILIATION_FAILURE"); if (aggregate.automaticRestartViolationCount || aggregate.reconnectAutoResumeViolationCount) errors.push("AUTO_RESUME_VIOLATION"); if (aggregate.persistenceContinuationViolationCount) errors.push("PERSISTENCE_CONTINUATION");
  if (evidence?.evidenceType === "CANARY_OPERATIONAL" && (!Number.isFinite(session.startedAt) || !Number.isFinite(session.stoppedAt) || session.stoppedAt < session.startedAt)) errors.push("OPERATIONAL_OBSERVATION_INVALID");
  return result("CANARY", evidence, errors, aggregate);
}
function createOwnerReviewEvidence(input) { const raw = { schemaVersion: 1, reviewId: input.reviewId, reviewedBy: input.reviewedBy, reviewedAt: input.reviewedAt, sourceCommitSha: input.sourceCommitSha, pilotEvidenceSha256: input.pilotEvidenceSha256, decision: input.decision, notes: input.notes ?? [] }; return Object.freeze({ ...raw, reviewSha256: hash(raw) }); }
function verifyOwnerReviewEvidence(review, expected = {}) { const errors = []; if (!review || review.schemaVersion !== 1 || !review.reviewId || !review.reviewedBy || !Number.isFinite(review.reviewedAt) || !["APPROVED_FOR_EXTENDED_PAPER", "REJECTED", "MORE_OBSERVATION_REQUIRED"].includes(review.decision) || review.reviewSha256 !== seal(review, ["reviewSha256"])) errors.push("OWNER_REVIEW_INVALID"); if (expected.sourceCommitSha && review?.sourceCommitSha !== expected.sourceCommitSha) errors.push("OWNER_REVIEW_COMMIT_MISMATCH"); if (expected.pilotEvidenceSha256 && review?.pilotEvidenceSha256 !== expected.pilotEvidenceSha256) errors.push("OWNER_REVIEW_EVIDENCE_MISMATCH"); return Object.freeze({ verifierStatus: errors.length ? "FAIL" : "PASS", reasonCodes: unique(errors), reviewSha256: review?.reviewSha256 ?? "" }); }
module.exports = { hash, verifyShadowPilotEvidence, verifyCanaryPilotEvidence, createOwnerReviewEvidence, verifyOwnerReviewEvidence, OPERATIONAL_TYPES };
