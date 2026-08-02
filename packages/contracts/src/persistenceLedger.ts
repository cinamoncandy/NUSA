import { createHash } from "node:crypto";
import { ComplianceCaseState, ComplianceEventType, type ComplianceCase, type ComplianceDecision, type ComplianceLedgerEvent, type ComplianceLedgerRecord, type SurveillanceAlert } from "./compliance";
import { type ResilienceLedgerEvent, type ResilienceLedgerRecord } from "./resilience";
import { type RulesLedgerEvent, type RulesLedgerRecord } from "./rules";
import { MultiAgentGovernanceEventType, type MultiAgentGovernanceEvent, type MultiAgentGovernanceRecord } from "./multiAgentGovernance";
export type PaperScenarioEventType = "SESSION_OBSERVED" | "ORDER_COMPLETED" | "REGIME_OBSERVED" | "RECOVERY_COMPLETED" | "DUPLICATE_ORDER_CHECKED" | "FAULT_SCENARIO_PASSED";
export interface PaperScenarioEvent { readonly eventId: string; readonly type: PaperScenarioEventType; readonly occurredAt: number; readonly sessionId?: string; readonly scenario?: string; }
export interface PaperScenarioRecord { readonly sequence: number; readonly previousHash: string; readonly event: PaperScenarioEvent; readonly hash: string; }

const zeroHash = "0".repeat(64);
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const freeze = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);
const validHash = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);

function canonical(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (entry == null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") return entry;
    if (Array.isArray(entry)) return entry.map(normalize);
    if (typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map(key => [key, normalize(record[key])]));
    }
    throw new Error("canonical serialization rejected unsupported value");
  };
  return JSON.stringify(normalize(value));
}

function requireTime(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
}

function complianceEvent(event: ComplianceLedgerEvent): ComplianceLedgerEvent {
  if (!event.eventId.trim()) throw new Error("eventId is required");
  requireTime(event.occurredAt, "occurredAt");
  if (event.evidenceReferences.length === 0) throw new Error("compliance events require evidence");
  return Object.freeze({ ...event, payload: Object.freeze({ ...event.payload }), evidenceReferences: freeze(event.evidenceReferences.map(value => value.trim())) });
}
const complianceHash = (sequence: number, previousHash: string, event: ComplianceLedgerEvent): string => sha256(`${sequence}\n${previousHash}\n${JSON.stringify(event)}`);
export interface ComplianceReplayState { readonly hash: string; readonly decisions: ReadonlyMap<string, ComplianceDecision>; readonly cases: ReadonlyMap<string, ComplianceCase>; readonly alerts: readonly SurveillanceAlert[]; }
export function replayComplianceLedger(records: readonly ComplianceLedgerRecord[]): ComplianceReplayState {
  let previous = zeroHash; let lastTime = -1;
  const decisions = new Map<string, ComplianceDecision>(); const cases = new Map<string, ComplianceCase>(); const alerts: SurveillanceAlert[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!; const event = complianceEvent(record.event);
    if (record.sequence !== index + 1 || record.previousHash !== previous || record.hash !== complianceHash(record.sequence, record.previousHash, event)) throw new Error("compliance ledger integrity violation");
    if (event.occurredAt < lastTime) throw new Error("compliance ledger timestamp regression");
    const payload = event.payload;
    if (event.type === ComplianceEventType.COMPLIANCE_EVALUATED) { const decision = payload.decision as ComplianceDecision; if (decision == null || decisions.has(decision.decisionId) || decision.ruleVersion === "" || decision.evidenceReferences.length === 0) throw new Error("invalid compliance decision event"); decisions.set(decision.decisionId, Object.freeze({ ...decision, reasonCodes: freeze(decision.reasonCodes), evidenceReferences: freeze(decision.evidenceReferences) })); }
    if (event.type === ComplianceEventType.SURVEILLANCE_ALERT_RAISED) { const alert = payload.alert as SurveillanceAlert; if (alert == null) throw new Error("invalid surveillance alert"); alerts.push(Object.freeze({ ...alert, observationIds: freeze(alert.observationIds), evidenceReferences: freeze(alert.evidenceReferences) })); }
    if (event.type === ComplianceEventType.COMPLIANCE_CASE_CREATED) { const entry = payload.case as ComplianceCase; if (entry == null || cases.has(entry.caseId)) throw new Error("invalid compliance case"); cases.set(entry.caseId, Object.freeze({ ...entry, evidenceReferences: freeze(entry.evidenceReferences) })); }
    if (event.type === ComplianceEventType.EVIDENCE_ATTACHED) { const caseId = String(payload.caseId); const current = cases.get(caseId); if (current == null) throw new Error("evidence attached to unknown case"); cases.set(caseId, Object.freeze({ ...current, evidenceReferences: freeze([...current.evidenceReferences, ...event.evidenceReferences]), updatedAt: event.occurredAt })); }
    if (event.type === ComplianceEventType.COMPLIANCE_CASE_CLOSED) { const caseId = String(payload.caseId); const current = cases.get(caseId); if (current == null || current.evidenceReferences.length === 0) throw new Error("case cannot close without evidence"); cases.set(caseId, Object.freeze({ ...current, state: ComplianceCaseState.CLOSED, updatedAt: event.occurredAt })); }
    previous = record.hash; lastTime = event.occurredAt;
  }
  return Object.freeze({ hash: previous, decisions, cases, alerts: freeze(alerts) });
}
export function appendComplianceEvent(records: readonly ComplianceLedgerRecord[], event: ComplianceLedgerEvent): readonly ComplianceLedgerRecord[] {
  replayComplianceLedger(records); const normalized = complianceEvent(event); const previousHash = records.at(-1)?.hash ?? zeroHash; const record = Object.freeze({ sequence: records.length + 1, previousHash, event: normalized, hash: complianceHash(records.length + 1, previousHash, normalized) }); const next = Object.freeze([...records, record]); replayComplianceLedger(next); return next;
}

const resilienceHash = (sequence: number, previousHash: string, event: ResilienceLedgerEvent): string => sha256(`${sequence}\n${previousHash}\n${JSON.stringify(event)}`);
export function replayResilienceLedger(records: readonly ResilienceLedgerRecord[]): ReadonlyMap<string, ResilienceLedgerEvent> {
  const plans = new Map<string, ResilienceLedgerEvent>(); let previous = zeroHash; let last = -1;
  for (let index = 0; index < records.length; index += 1) { const record = records[index]!; if (record.sequence !== index + 1 || record.previousHash !== previous || record.hash !== resilienceHash(record.sequence, record.previousHash, record.event) || record.event.occurredAt < last) throw new Error("resilience ledger integrity violation"); if (!record.event.eventId.trim() || !record.event.plan.planId.trim() || !record.event.plan.version.trim() || !validHash(record.event.evidenceHash)) throw new Error("invalid resilience event"); plans.set(`${record.event.plan.planId}|${record.event.plan.version}`, record.event); previous = record.hash; last = record.event.occurredAt; }
  return plans;
}
export function appendResilienceEvent(records: readonly ResilienceLedgerRecord[], event: ResilienceLedgerEvent): readonly ResilienceLedgerRecord[] {
  replayResilienceLedger(records); requireTime(event.occurredAt, "occurredAt"); if (!event.eventId.trim() || !event.plan.planId.trim() || !event.plan.version.trim() || !validHash(event.evidenceHash)) throw new Error("invalid resilience event"); const previousHash = records.at(-1)?.hash ?? zeroHash; const record = Object.freeze({ sequence: records.length + 1, previousHash, event: Object.freeze({ ...event }), hash: resilienceHash(records.length + 1, previousHash, event) }); const next = Object.freeze([...records, record]); replayResilienceLedger(next); return next;
}

const rulesHash = (sequence: number, previousHash: string, event: RulesLedgerEvent): string => sha256(`${sequence}\n${previousHash}\n${canonical(event)}`);
export interface RulesReplayState { readonly hash: string; }
export function replayRulesLedger(records: readonly RulesLedgerRecord[]): RulesReplayState {
  let previous = zeroHash; let last = -1;
  for (let index = 0; index < records.length; index += 1) { const record = records[index]!; const event = Object.freeze({ ...record.event, payload: Object.freeze({ ...record.event.payload }) }); if (!event.eventId.trim() || !Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0 || !validHash(event.evidenceHash) || record.sequence !== index + 1 || record.previousHash !== previous || record.hash !== rulesHash(record.sequence, record.previousHash, event) || event.occurredAt < last) throw new Error("rules ledger integrity violation"); previous = record.hash; last = event.occurredAt; }
  return Object.freeze({ hash: previous });
}
export function appendRulesEvent(records: readonly RulesLedgerRecord[], event: RulesLedgerEvent): readonly RulesLedgerRecord[] {
  replayRulesLedger(records); if (!event.eventId.trim() || !Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0 || !validHash(event.evidenceHash)) throw new Error("rules event is invalid"); const normalized = Object.freeze({ ...event, payload: Object.freeze({ ...event.payload }) }); const previousHash = records.at(-1)?.hash ?? zeroHash; const record = Object.freeze({ sequence: records.length + 1, previousHash, event: normalized, hash: rulesHash(records.length + 1, previousHash, normalized) }); const next = Object.freeze([...records, record]); replayRulesLedger(next); return next;
}

const governanceHash = (sequence: number, previousHash: string, event: MultiAgentGovernanceEvent): string => sha256(`${sequence}\n${previousHash}\n${canonical(event)}`);
export interface MultiAgentGovernanceReplayState { readonly hash: string; }
export function replayMultiAgentGovernance(records: readonly MultiAgentGovernanceRecord[]): MultiAgentGovernanceReplayState {
  let previous = zeroHash; let last = -1;
  for (let index = 0; index < records.length; index += 1) { const record = records[index]!; const event = Object.freeze({ ...record.event, payload: Object.freeze({ ...record.event.payload }) }); if (!event.eventId.trim() || !Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0 || !validHash(event.evidenceHash) || record.sequence !== index + 1 || record.previousHash !== previous || record.hash !== governanceHash(record.sequence, record.previousHash, event) || event.occurredAt < last) throw new Error("multi-agent ledger integrity violation"); if (event.type === MultiAgentGovernanceEventType.MULTI_AGENT_DECISION_EVALUATED || event.type === MultiAgentGovernanceEventType.MULTI_AGENT_DECISION_DENIED) { const decision = event.payload.decision as { readonly productionMutationAllowed?: boolean; readonly realOrderAuthority?: boolean; readonly realTransferAuthority?: boolean; }; if (decision == null || decision.productionMutationAllowed !== false || decision.realOrderAuthority !== false || decision.realTransferAuthority !== false) throw new Error("invalid multi-agent decision event"); } previous = record.hash; last = event.occurredAt; }
  return Object.freeze({ hash: previous });
}
export function appendMultiAgentGovernanceEvent(records: readonly MultiAgentGovernanceRecord[], event: MultiAgentGovernanceEvent): readonly MultiAgentGovernanceRecord[] {
  replayMultiAgentGovernance(records); if (!event.eventId.trim() || !Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0 || !validHash(event.evidenceHash)) throw new Error("event is invalid"); const normalized = Object.freeze({ ...event, payload: Object.freeze({ ...event.payload }) }); const previousHash = records.at(-1)?.hash ?? zeroHash; const record = Object.freeze({ sequence: records.length + 1, previousHash, event: normalized, hash: governanceHash(records.length + 1, previousHash, normalized) }); const next = Object.freeze([...records, record]); replayMultiAgentGovernance(next); return next;
}

const paperHash = (sequence: number, previousHash: string, event: PaperScenarioEvent): string => sha256(JSON.stringify({ sequence, previousHash, event }));
const validatePaperEvent = (event: PaperScenarioEvent): void => { if (!event.eventId.trim() || !event.type) throw new Error("scenario event identity is required"); requireTime(event.occurredAt, "scenario event timestamp"); if (event.sessionId !== undefined && !event.sessionId.trim()) throw new Error("scenario event session is invalid"); if (event.scenario !== undefined && !event.scenario.trim()) throw new Error("scenario event scenario is invalid"); };
export interface PaperScenarioEvidenceSummary { readonly sessionCount: number; readonly completedOrderCount: number; readonly regimeCount: number; readonly recoveryPassCount: number; readonly duplicateOrderCheckCount: number; readonly passedFaultScenarios: readonly string[]; readonly firstOccurredAt: number | null; readonly lastOccurredAt: number | null; }
export function appendPaperScenarioEvent(records: readonly PaperScenarioRecord[], event: PaperScenarioEvent): readonly PaperScenarioRecord[] { validatePaperEvent(event); const ids = new Set(records.map(record => record.event.eventId)); if (ids.has(event.eventId)) throw new Error("duplicate scenario event"); const previous = records.at(-1); if (previous && event.occurredAt < previous.event.occurredAt) throw new Error("scenario event timestamps must be non-decreasing"); const sequence = records.length + 1; const previousHash = previous?.hash ?? zeroHash; const record = Object.freeze({ sequence, previousHash, event: Object.freeze({ ...event }), hash: paperHash(sequence, previousHash, event) }); return Object.freeze([...records, record]); }
export function replayPaperScenarioEvidence(records: readonly PaperScenarioRecord[]): PaperScenarioEvidenceSummary { let sessions = 0; let orders = 0; let regimes = 0; let recoveries = 0; let duplicateChecks = 0; let previous = zeroHash; let previousAt = -1; const ids = new Set<string>(); const regimeIds = new Set<string>(); const faults = new Set<string>(); for (const [index, record] of records.entries()) { validatePaperEvent(record.event); if (record.sequence !== index + 1 || record.previousHash !== previous || record.hash !== paperHash(record.sequence, record.previousHash, record.event)) throw new Error("scenario evidence hash chain mismatch"); if (ids.has(record.event.eventId)) throw new Error("duplicate scenario event"); ids.add(record.event.eventId); if (record.event.occurredAt < previousAt) throw new Error("scenario event timestamps must be non-decreasing"); previous = record.hash; previousAt = record.event.occurredAt; if (record.event.type === "SESSION_OBSERVED") sessions++; if (record.event.type === "ORDER_COMPLETED") orders++; if (record.event.type === "REGIME_OBSERVED") regimeIds.add(record.event.scenario!); if (record.event.type === "RECOVERY_COMPLETED") recoveries++; if (record.event.type === "DUPLICATE_ORDER_CHECKED") duplicateChecks++; if (record.event.type === "FAULT_SCENARIO_PASSED") faults.add(record.event.scenario!); } regimes = regimeIds.size; return Object.freeze({ sessionCount: sessions, completedOrderCount: orders, regimeCount: regimes, recoveryPassCount: recoveries, duplicateOrderCheckCount: duplicateChecks, passedFaultScenarios: Object.freeze([...faults].sort()), firstOccurredAt: records[0]?.event.occurredAt ?? null, lastOccurredAt: records.at(-1)?.event.occurredAt ?? null }); }
