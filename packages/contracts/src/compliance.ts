export enum ComplianceDecisionType { ALLOW = "ALLOW", DENY = "DENY", REQUIRE_REVIEW = "REQUIRE_REVIEW", BLOCK = "BLOCK", REPORT_REQUIRED = "REPORT_REQUIRED", UNKNOWN = "UNKNOWN" }
export enum ComplianceCaseState { OPEN = "OPEN", TRIAGED = "TRIAGED", INVESTIGATING = "INVESTIGATING", EVIDENCE_COLLECTION = "EVIDENCE_COLLECTION", ESCALATED = "ESCALATED", REGULATORY_REVIEW = "REGULATORY_REVIEW", CLOSED = "CLOSED", REOPENED = "REOPENED" }
export enum ComplianceEventType { COMPLIANCE_EVALUATED = "COMPLIANCE_EVALUATED", COMPLIANCE_BLOCKED = "COMPLIANCE_BLOCKED", COMPLIANCE_APPROVED = "COMPLIANCE_APPROVED", SURVEILLANCE_ALERT_RAISED = "SURVEILLANCE_ALERT_RAISED", COMPLIANCE_CASE_CREATED = "COMPLIANCE_CASE_CREATED", EVIDENCE_ATTACHED = "EVIDENCE_ATTACHED", REGULATORY_REPORT_GENERATED = "REGULATORY_REPORT_GENERATED", REGULATORY_REPORT_SUBMITTED = "REGULATORY_REPORT_SUBMITTED", COMPLIANCE_CERTIFICATION_ISSUED = "COMPLIANCE_CERTIFICATION_ISSUED", COMPLIANCE_CASE_CLOSED = "COMPLIANCE_CASE_CLOSED" }

export interface ComplianceRule {
  readonly ruleId: string;
  readonly version: string;
  readonly jurisdiction: string;
  readonly effectiveAt: number;
  readonly prohibitedSymbols: readonly string[];
  readonly restrictedPartyIds: readonly string[];
  readonly sanctionedPartyIds: readonly string[];
  readonly requiredEvidenceTypes: readonly string[];
}

export interface ComplianceIntent {
  readonly intentId: string;
  readonly tenantId: string;
  readonly jurisdiction: string;
  readonly symbol: string;
  readonly partyId?: string;
  readonly evidenceReferences: readonly string[];
  readonly evaluatedAt: number;
}

export interface ComplianceDecision {
  readonly decisionId: string;
  readonly intentId: string;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly decision: ComplianceDecisionType;
  readonly reasonCodes: readonly string[];
  readonly evidenceReferences: readonly string[];
  readonly decidedAt: number;
}

export interface SurveillanceObservation {
  readonly observationId: string;
  readonly occurredAt: number;
  readonly accountId: string;
  readonly counterpartyAccountId?: string;
  readonly beneficialOwnerId?: string;
  readonly symbol: string;
  readonly type: "ORDER" | "CANCEL" | "FILL" | "QUOTE";
  readonly side?: "BUY" | "SELL";
  readonly quantityRaw?: bigint;
  readonly evidenceReferences: readonly string[];
}

export type SurveillancePattern = "WASH_TRADING" | "SPOOFING" | "LAYERING" | "QUOTE_STUFFING" | "MOMENTUM_IGNITION" | "CROSS_ACCOUNT_MANIPULATION" | "EXCESSIVE_CANCELLATIONS" | "ABNORMAL_FILL_BEHAVIOR" | "SUSPICIOUS_TIMING";
export interface SurveillanceAlert { readonly alertId: string; readonly pattern: SurveillancePattern; readonly observationIds: readonly string[]; readonly reason: string; readonly evidenceReferences: readonly string[]; readonly raisedAt: number; }
export interface ComplianceCase { readonly caseId: string; readonly state: ComplianceCaseState; readonly alertId: string; readonly evidenceReferences: readonly string[]; readonly updatedAt: number; }
export interface RegulatoryReport { readonly reportId: string; readonly jurisdiction: string; readonly eventHashes: readonly string[]; readonly generatedAt: number; readonly reportHash: string; }
export interface ComplianceLedgerEvent { readonly eventId: string; readonly type: ComplianceEventType; readonly occurredAt: number; readonly payload: Readonly<Record<string, unknown>>; readonly evidenceReferences: readonly string[]; }
export interface ComplianceLedgerRecord { readonly sequence: number; readonly previousHash: string; readonly event: ComplianceLedgerEvent; readonly hash: string; }
