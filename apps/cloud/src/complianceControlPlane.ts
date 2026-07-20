import { createHash } from "node:crypto";
import { ComplianceCaseState, ComplianceDecisionType, ComplianceEventType, type ComplianceCase, type ComplianceDecision, type ComplianceIntent, type ComplianceLedgerEvent, type ComplianceLedgerRecord, type ComplianceRule, type RegulatoryReport, type SurveillanceAlert, type SurveillanceObservation } from "../../../packages/contracts/src/compliance";

const genesis = "0".repeat(64);
const hash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const canonical = (value: unknown): string => JSON.stringify(value);
const freezeArray = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);
const requireText = (value: string, name: string): string => { if (value.trim() === "") throw new Error(`${name} is required`); return value.trim(); };
const requireTime = (value: number, name: string): number => { if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`); return value; };

export function createComplianceRule(rule: ComplianceRule): ComplianceRule {
  requireText(rule.ruleId, "ruleId"); requireText(rule.version, "version"); requireText(rule.jurisdiction, "jurisdiction"); requireTime(rule.effectiveAt, "effectiveAt");
  return Object.freeze({ ...rule, prohibitedSymbols: freezeArray(rule.prohibitedSymbols.map(value => requireText(value, "prohibited symbol"))), restrictedPartyIds: freezeArray(rule.restrictedPartyIds.map(value => requireText(value, "restricted party"))), sanctionedPartyIds: freezeArray(rule.sanctionedPartyIds.map(value => requireText(value, "sanctioned party"))), requiredEvidenceTypes: freezeArray(rule.requiredEvidenceTypes.map(value => requireText(value, "evidence type"))) });
}

export function evaluateCompliance(rule: ComplianceRule | undefined, intent: ComplianceIntent, decisionId: string): ComplianceDecision {
  requireText(intent.intentId, "intentId"); requireText(intent.tenantId, "tenantId"); requireText(intent.jurisdiction, "jurisdiction"); requireText(intent.symbol, "symbol"); requireTime(intent.evaluatedAt, "evaluatedAt"); requireText(decisionId, "decisionId");
  if (rule == null || rule.jurisdiction !== intent.jurisdiction) return Object.freeze({ decisionId, intentId: intent.intentId, ruleId: rule?.ruleId ?? "UNVERIFIED", ruleVersion: rule?.version ?? "UNVERIFIED", decision: ComplianceDecisionType.UNKNOWN, reasonCodes: freezeArray(["RULE_UNAVAILABLE"]), evidenceReferences: freezeArray(intent.evidenceReferences), decidedAt: intent.evaluatedAt });
  const requiredEvidenceMissing = rule.requiredEvidenceTypes.some(type => !intent.evidenceReferences.includes(type));
  const party = intent.partyId;
  const reasonCodes: string[] = [];
  let decision = ComplianceDecisionType.ALLOW;
  if (rule.prohibitedSymbols.includes(intent.symbol)) { decision = ComplianceDecisionType.BLOCK; reasonCodes.push("INSTRUMENT_RESTRICTED"); }
  else if (party != null && rule.sanctionedPartyIds.includes(party)) { decision = ComplianceDecisionType.BLOCK; reasonCodes.push("SANCTIONED_PARTY"); }
  else if (party == null || party.trim() === "") { decision = ComplianceDecisionType.UNKNOWN; reasonCodes.push("PARTY_UNKNOWN"); }
  else if (rule.restrictedPartyIds.includes(party)) { decision = ComplianceDecisionType.REQUIRE_REVIEW; reasonCodes.push("RESTRICTED_PARTY"); }
  else if (requiredEvidenceMissing) { decision = ComplianceDecisionType.REQUIRE_REVIEW; reasonCodes.push("EVIDENCE_INCOMPLETE"); }
  else reasonCodes.push("RULES_SATISFIED");
  return Object.freeze({ decisionId, intentId: intent.intentId, ruleId: rule.ruleId, ruleVersion: rule.version, decision, reasonCodes: freezeArray(reasonCodes), evidenceReferences: freezeArray(intent.evidenceReferences), decidedAt: intent.evaluatedAt });
}

export function analyzeSurveillance(observations: readonly SurveillanceObservation[]): readonly SurveillanceAlert[] {
  const sorted = [...observations].sort((a, b) => a.occurredAt - b.occurredAt || a.observationId.localeCompare(b.observationId));
  const ids = new Set<string>(); const alerts: SurveillanceAlert[] = [];
  for (const observation of sorted) {
    if (ids.has(observation.observationId)) throw new Error("duplicate surveillance observation"); ids.add(observation.observationId); requireTime(observation.occurredAt, "observation time");
    const sameOwner = observation.beneficialOwnerId != null && observation.beneficialOwnerId === observation.counterpartyAccountId;
    if (observation.type === "FILL" && (observation.accountId === observation.counterpartyAccountId || sameOwner)) alerts.push(Object.freeze({ alertId: `wash:${observation.observationId}`, pattern: "WASH_TRADING", observationIds: freezeArray([observation.observationId]), reason: "Self or common-beneficial-owner fill", evidenceReferences: freezeArray(observation.evidenceReferences), raisedAt: observation.occurredAt }));
  }
  const cancellations = sorted.filter(value => value.type === "CANCEL");
  if (cancellations.length >= 5) alerts.push(Object.freeze({ alertId: `cancel:${cancellations[0]!.observationId}`, pattern: "EXCESSIVE_CANCELLATIONS", observationIds: freezeArray(cancellations.map(value => value.observationId)), reason: "Cancellation threshold reached", evidenceReferences: freezeArray(cancellations.flatMap(value => value.evidenceReferences)), raisedAt: cancellations.at(-1)!.occurredAt }));
  return freezeArray(alerts);
}

function normalizeEvent(event: ComplianceLedgerEvent): ComplianceLedgerEvent {
  requireText(event.eventId, "eventId"); requireTime(event.occurredAt, "occurredAt");
  if (event.evidenceReferences.length === 0) throw new Error("compliance events require evidence");
  return Object.freeze({ ...event, payload: Object.freeze({ ...event.payload }), evidenceReferences: freezeArray(event.evidenceReferences.map(value => requireText(value, "evidence reference"))) });
}
const recordHash = (sequence: number, previousHash: string, event: ComplianceLedgerEvent): string => hash(`${sequence}\n${previousHash}\n${canonical(event)}`);

export function appendComplianceEvent(records: readonly ComplianceLedgerRecord[], event: ComplianceLedgerEvent): readonly ComplianceLedgerRecord[] {
  replayComplianceLedger(records); const normalized = normalizeEvent(event); const previousHash = records.at(-1)?.hash ?? genesis; const record = Object.freeze({ sequence: records.length + 1, previousHash, event: normalized, hash: recordHash(records.length + 1, previousHash, normalized) }); const next = Object.freeze([...records, record]); replayComplianceLedger(next); return next;
}

export interface ComplianceReplayState { readonly hash: string; readonly decisions: ReadonlyMap<string, ComplianceDecision>; readonly cases: ReadonlyMap<string, ComplianceCase>; readonly alerts: readonly SurveillanceAlert[]; }
export function replayComplianceLedger(records: readonly ComplianceLedgerRecord[]): ComplianceReplayState {
  let previous = genesis; let lastTime = -1; const decisions = new Map<string, ComplianceDecision>(); const cases = new Map<string, ComplianceCase>(); const alerts: SurveillanceAlert[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!; if (record.sequence !== index + 1 || record.previousHash !== previous || record.hash !== recordHash(record.sequence, record.previousHash, normalizeEvent(record.event))) throw new Error("compliance ledger integrity violation"); if (record.event.occurredAt < lastTime) throw new Error("compliance ledger timestamp regression");
    const payload = record.event.payload;
    if (record.event.type === ComplianceEventType.COMPLIANCE_EVALUATED) { const decision = payload.decision as ComplianceDecision; if (decision == null || decisions.has(decision.decisionId) || decision.ruleVersion === "" || decision.evidenceReferences.length === 0) throw new Error("invalid compliance decision event"); decisions.set(decision.decisionId, Object.freeze({ ...decision, reasonCodes: freezeArray(decision.reasonCodes), evidenceReferences: freezeArray(decision.evidenceReferences) })); }
    if (record.event.type === ComplianceEventType.SURVEILLANCE_ALERT_RAISED) { const alert = payload.alert as SurveillanceAlert; if (alert == null) throw new Error("invalid surveillance alert"); alerts.push(Object.freeze({ ...alert, observationIds: freezeArray(alert.observationIds), evidenceReferences: freezeArray(alert.evidenceReferences) })); }
    if (record.event.type === ComplianceEventType.COMPLIANCE_CASE_CREATED) { const entry = payload.case as ComplianceCase; if (entry == null || cases.has(entry.caseId)) throw new Error("invalid compliance case"); cases.set(entry.caseId, Object.freeze({ ...entry, evidenceReferences: freezeArray(entry.evidenceReferences) })); }
    if (record.event.type === ComplianceEventType.EVIDENCE_ATTACHED) { const caseId = String(payload.caseId); const current = cases.get(caseId); if (current == null) throw new Error("evidence attached to unknown case"); cases.set(caseId, Object.freeze({ ...current, evidenceReferences: freezeArray([...current.evidenceReferences, ...record.event.evidenceReferences]), updatedAt: record.event.occurredAt })); }
    if (record.event.type === ComplianceEventType.COMPLIANCE_CASE_CLOSED) { const caseId = String(payload.caseId); const current = cases.get(caseId); if (current == null || current.evidenceReferences.length === 0) throw new Error("case cannot close without evidence"); cases.set(caseId, Object.freeze({ ...current, state: ComplianceCaseState.CLOSED, updatedAt: record.event.occurredAt })); }
    previous = record.hash; lastTime = record.event.occurredAt;
  }
  return Object.freeze({ hash: previous, decisions, cases, alerts: freezeArray(alerts) });
}

export function buildRegulatoryReport(reportId: string, jurisdiction: string, records: readonly ComplianceLedgerRecord[], generatedAt: number): RegulatoryReport {
  requireText(reportId, "reportId"); requireText(jurisdiction, "jurisdiction"); requireTime(generatedAt, "generatedAt"); const state = replayComplianceLedger(records); const eventHashes = freezeArray(records.map(record => record.hash)); return Object.freeze({ reportId, jurisdiction, eventHashes, generatedAt, reportHash: hash(canonical({ reportId, jurisdiction, eventHashes, ledgerHash: state.hash })) });
}
