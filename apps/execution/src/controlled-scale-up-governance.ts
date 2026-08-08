import { createHash } from "node:crypto";

export type ScaleGovernanceVerdict = "COMPLETE_FOR_SEPARATE_MANUAL_SCALE_CHANGE_REVIEW" | "SAFE_BLOCK" | "UNKNOWN";
export type ScalePrincipalKind = "HUMAN" | "AI" | "META_AI" | "AUTOMATION" | "PROVIDER" | "SYSTEM";
export type ScaleVerificationState = "PASS" | "FAIL" | "UNKNOWN";
export type ScaleAntiReplayState = "UNUSED" | "USED" | "UNKNOWN";
export type ScaleSafetyState = "SAFE" | "UNSAFE" | "UNKNOWN";
export type ScaleReconciliationState = "MATCH" | "DIFF" | "UNKNOWN";
export type ScaleIncidentState = "CLEAR" | "OPEN" | "UNKNOWN";

export interface ScaleEnvelopeDefinition {
  readonly symbols: readonly string[];
  readonly maxOrderNotionalBps: number;
  readonly maxGrossExposureBps: number;
  readonly maxDailyLossBps: number;
  readonly maxOpenOrders: number;
  readonly maxPositionCount: number;
  readonly maxSessionOrders: number;
  readonly maxSessionDurationSeconds: number;
}

export interface ScaleChangeApproval {
  readonly principalId: string;
  readonly principalKind: ScalePrincipalKind;
  readonly policyChangeId: string;
  readonly priorPostLiveValidationFingerprint: string;
  readonly proposedEnvelopeFingerprint: string;
  readonly approvedAt: string;
  readonly signatureVerification: ScaleVerificationState;
  readonly attestationDigest: string;
}

export interface ControlledScaleUpGovernanceInput {
  readonly policyChangeId: string;
  readonly evaluatedAt: string;
  readonly reviewStartsAt: string;
  readonly reviewExpiresAt: string;
  readonly lastValidatedSessionEndedAt: string;
  readonly cooldownSeconds: number;
  readonly requester: Readonly<{ principalId: string; principalKind: ScalePrincipalKind }>;
  readonly approvers: readonly ScaleChangeApproval[];
  readonly codeRevision: string;
  readonly configurationHash: string;
  readonly priorPostLiveVerdict: "READY_FOR_HUMAN_REVIEW" | "SAFE_BLOCK" | "UNKNOWN";
  readonly priorPostLiveValidationFingerprint: string;
  readonly currentEnvelope: ScaleEnvelopeDefinition;
  readonly currentEnvelopeFingerprint: string;
  readonly proposedEnvelope: ScaleEnvelopeDefinition;
  readonly reason: string;
  readonly auditReceiptId: string;
  readonly antiReplayState: ScaleAntiReplayState;
  readonly safetyState: ScaleSafetyState;
  readonly killSwitchReady: ScaleVerificationState;
  readonly rollback: ScaleVerificationState;
  readonly reconciliation: ScaleReconciliationState;
  readonly auditChain: ScaleVerificationState;
  readonly incidentState: ScaleIncidentState;
}

export interface ControlledScaleUpGovernanceResult {
  readonly verdict: ScaleGovernanceVerdict;
  readonly blockers: readonly string[];
  readonly unknowns: readonly string[];
  readonly policyChangeId: string;
  readonly currentEnvelopeFingerprint: string;
  readonly proposedEnvelopeFingerprint: string;
  readonly reviewFingerprint: string;
  readonly requesterId: string;
  readonly approverIds: readonly string[];
  readonly scaleUpAuthority: false;
  readonly activationAuthority: false;
  readonly orderAuthorization: false;
  readonly executionAuthority: false;
  readonly authorizesLive: false;
  readonly mutationPerformed: false;
  readonly realMoneyExecutionAllowed: false;
}

export const CONTROLLED_SCALE_UP_GOVERNANCE_DESCRIPTOR = Object.freeze({
  mode: "VALIDATION_ONLY" as const,
  actualHumanApprovalInCi: false as const,
  exactProposalBinding: true as const,
  requiredDistinctHumanApprovers: 2 as const,
  antiReplayRequired: true as const,
  automaticScaleUpAllowed: false as const,
  scaleUpAuthority: false as const,
  activationAuthority: false as const,
  orderAuthorization: false as const,
  executionAuthority: false as const,
  authorizesLive: false as const,
  mutationPerformed: false as const,
  credentialExecutionUse: false as const,
  networkDialAllowed: false as const,
  realMoneyExecutionAllowed: false as const,
});

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_SYMBOL = /^[A-Z0-9][A-Z0-9._:-]{0,31}$/;
const prohibitedMaterial = /(?:bearer\s+|private[_ -]?key|api[_ -]?secret|access[_ -]?token|authorization\s*:)/i;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function sha256(value: unknown): string { return createHash("sha256").update(canonical(value), "utf8").digest("hex"); }
function exactHash(value: string, length: 40 | 64, code: string): string { if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value)) throw new Error(code); return value; }
function instant(value: string, code: string): number { const parsed = Date.parse(value); if (Number.isNaN(parsed)) throw new Error(code); return parsed; }
function required(value: string, code: string): string { const normalized = value.trim(); if (!normalized || prohibitedMaterial.test(normalized)) throw new Error(code); return normalized; }

function normalizeEnvelope(envelope: ScaleEnvelopeDefinition): Readonly<ScaleEnvelopeDefinition> {
  if (!Array.isArray(envelope.symbols) || envelope.symbols.length === 0) throw new Error("SCALE_SYMBOLS_REQUIRED");
  const symbols = [...new Set(envelope.symbols.map((symbol) => {
    const normalized = symbol.trim().toUpperCase();
    if (!SAFE_SYMBOL.test(normalized)) throw new Error("SCALE_SYMBOL_INVALID");
    return normalized;
  }))].sort();
  if (symbols.length !== envelope.symbols.length) throw new Error("SCALE_SYMBOL_DUPLICATE");
  for (const value of [envelope.maxOrderNotionalBps, envelope.maxGrossExposureBps, envelope.maxDailyLossBps]) {
    if (!Number.isFinite(value) || value <= 0) throw new Error("SCALE_BPS_LIMIT_INVALID");
  }
  for (const value of [envelope.maxOpenOrders, envelope.maxPositionCount, envelope.maxSessionOrders, envelope.maxSessionDurationSeconds]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error("SCALE_COUNT_LIMIT_INVALID");
  }
  return Object.freeze({ ...envelope, symbols: Object.freeze(symbols) });
}

export function computeScaleEnvelopeFingerprint(envelope: ScaleEnvelopeDefinition): string {
  return sha256(normalizeEnvelope(envelope));
}

function proposalIsExplicitScaleUp(current: Readonly<ScaleEnvelopeDefinition>, proposed: Readonly<ScaleEnvelopeDefinition>): boolean {
  const currentSymbols = new Set(current.symbols);
  if (current.symbols.some((symbol) => !proposed.symbols.includes(symbol))) return false;
  const numericKeys = [
    "maxOrderNotionalBps", "maxGrossExposureBps", "maxDailyLossBps", "maxOpenOrders",
    "maxPositionCount", "maxSessionOrders", "maxSessionDurationSeconds"
  ] as const;
  if (numericKeys.some((key) => proposed[key] < current[key])) return false;
  return proposed.symbols.some((symbol) => !currentSymbols.has(symbol)) || numericKeys.some((key) => proposed[key] > current[key]);
}

export function evaluateControlledScaleUpGovernance(input: ControlledScaleUpGovernanceInput): ControlledScaleUpGovernanceResult {
  const policyChangeId = required(input.policyChangeId, "SCALE_POLICY_CHANGE_ID_REQUIRED");
  if (!SAFE_ID.test(policyChangeId)) throw new Error("SCALE_POLICY_CHANGE_ID_INVALID");
  const evaluatedAt = instant(input.evaluatedAt, "SCALE_EVALUATED_AT_INVALID");
  const reviewStartsAt = instant(input.reviewStartsAt, "SCALE_REVIEW_START_INVALID");
  const reviewExpiresAt = instant(input.reviewExpiresAt, "SCALE_REVIEW_EXPIRY_INVALID");
  const lastSessionEndedAt = instant(input.lastValidatedSessionEndedAt, "SCALE_LAST_SESSION_END_INVALID");
  if (reviewExpiresAt <= reviewStartsAt) throw new Error("SCALE_REVIEW_WINDOW_INVALID");
  if (!Number.isSafeInteger(input.cooldownSeconds) || input.cooldownSeconds <= 0) throw new Error("SCALE_COOLDOWN_INVALID");
  const codeRevision = exactHash(input.codeRevision, 40, "SCALE_CODE_REVISION_INVALID");
  const configurationHash = exactHash(input.configurationHash, 64, "SCALE_CONFIGURATION_HASH_INVALID");
  const priorFingerprint = exactHash(input.priorPostLiveValidationFingerprint, 64, "SCALE_PRIOR_VALIDATION_FINGERPRINT_INVALID");
  const currentEnvelope = normalizeEnvelope(input.currentEnvelope);
  const proposedEnvelope = normalizeEnvelope(input.proposedEnvelope);
  const computedCurrentFingerprint = computeScaleEnvelopeFingerprint(currentEnvelope);
  const currentEnvelopeFingerprint = exactHash(input.currentEnvelopeFingerprint, 64, "SCALE_CURRENT_ENVELOPE_FINGERPRINT_INVALID");
  const proposedEnvelopeFingerprint = computeScaleEnvelopeFingerprint(proposedEnvelope);
  const reason = required(input.reason, "SCALE_REASON_REQUIRED");
  const auditReceiptId = required(input.auditReceiptId, "SCALE_AUDIT_RECEIPT_REQUIRED");
  const blockers: string[] = [];
  const unknowns: string[] = [];

  if (computedCurrentFingerprint !== currentEnvelopeFingerprint) blockers.push("CURRENT_ENVELOPE_FINGERPRINT_MISMATCH");
  if (!proposalIsExplicitScaleUp(currentEnvelope, proposedEnvelope)) blockers.push("PROPOSAL_NOT_MONOTONIC_EXPLICIT_SCALE_UP");
  if (evaluatedAt < reviewStartsAt) blockers.push("SCALE_REVIEW_NOT_YET_VALID");
  if (evaluatedAt > reviewExpiresAt) blockers.push("SCALE_REVIEW_EXPIRED");
  if (evaluatedAt < lastSessionEndedAt + input.cooldownSeconds * 1000) blockers.push("SCALE_COOLDOWN_NOT_ELAPSED");

  const requesterId = required(input.requester.principalId, "SCALE_REQUESTER_REQUIRED");
  if (input.requester.principalKind !== "HUMAN") blockers.push("SCALE_REQUESTER_NOT_HUMAN");
  if (input.approvers.length !== 2) blockers.push("EXACTLY_TWO_SCALE_APPROVERS_REQUIRED");
  const approverIds: string[] = [];
  const normalizedApprovals: Array<Readonly<Record<string, string>>> = [];
  for (const approval of input.approvers) {
    const principalId = required(approval.principalId, "SCALE_APPROVER_ID_REQUIRED");
    approverIds.push(principalId);
    const approvedAt = instant(approval.approvedAt, `SCALE_APPROVAL_TIME_INVALID:${principalId}`);
    const attestationDigest = exactHash(approval.attestationDigest, 64, `SCALE_ATTESTATION_DIGEST_INVALID:${principalId}`);
    normalizedApprovals.push(Object.freeze({
      principalId,
      principalKind: approval.principalKind,
      policyChangeId: approval.policyChangeId,
      priorPostLiveValidationFingerprint: approval.priorPostLiveValidationFingerprint,
      proposedEnvelopeFingerprint: approval.proposedEnvelopeFingerprint,
      approvedAt: approval.approvedAt,
      signatureVerification: approval.signatureVerification,
      attestationDigest,
    }));
    if (approval.principalKind !== "HUMAN") blockers.push(`SCALE_APPROVER_NOT_HUMAN:${principalId}`);
    if (approval.policyChangeId !== policyChangeId) blockers.push(`SCALE_POLICY_ID_MISMATCH:${principalId}`);
    if (approval.priorPostLiveValidationFingerprint !== priorFingerprint) blockers.push(`SCALE_PRIOR_VALIDATION_MISMATCH:${principalId}`);
    if (approval.proposedEnvelopeFingerprint !== proposedEnvelopeFingerprint) blockers.push(`SCALE_PROPOSAL_MISMATCH:${principalId}`);
    if (approvedAt < reviewStartsAt || approvedAt > reviewExpiresAt || approvedAt > evaluatedAt) blockers.push(`SCALE_APPROVAL_OUTSIDE_WINDOW:${principalId}`);
    if (approval.signatureVerification === "FAIL") blockers.push(`SCALE_SIGNATURE_FAILED:${principalId}`);
    if (approval.signatureVerification === "UNKNOWN") unknowns.push(`SCALE_SIGNATURE_UNKNOWN:${principalId}`);
  }
  if (new Set(approverIds).size !== approverIds.length) blockers.push("DUPLICATE_SCALE_APPROVER");
  if (approverIds.some((id) => id === requesterId)) blockers.push("SCALE_REQUESTER_APPROVER_NOT_SEPARATED");

  if (input.priorPostLiveVerdict === "SAFE_BLOCK") blockers.push("PRIOR_POST_LIVE_BLOCKED");
  else if (input.priorPostLiveVerdict === "UNKNOWN") unknowns.push("PRIOR_POST_LIVE_UNKNOWN");
  if (input.antiReplayState === "USED") blockers.push("SCALE_POLICY_CHANGE_ID_ALREADY_USED");
  else if (input.antiReplayState === "UNKNOWN") unknowns.push("SCALE_ANTI_REPLAY_UNKNOWN");
  if (input.safetyState === "UNSAFE") blockers.push("SCALE_SAFETY_UNSAFE");
  else if (input.safetyState === "UNKNOWN") unknowns.push("SCALE_SAFETY_UNKNOWN");
  for (const [name, state] of Object.entries({ killSwitchReady: input.killSwitchReady, rollback: input.rollback, auditChain: input.auditChain })) {
    if (state === "FAIL") blockers.push(`${name.toUpperCase()}_FAIL`);
    else if (state === "UNKNOWN") unknowns.push(`${name.toUpperCase()}_UNKNOWN`);
  }
  if (input.reconciliation === "DIFF") blockers.push("SCALE_RECONCILIATION_DIFF");
  else if (input.reconciliation === "UNKNOWN") unknowns.push("SCALE_RECONCILIATION_UNKNOWN");
  if (input.incidentState === "OPEN") blockers.push("UNRESOLVED_INCIDENT");
  else if (input.incidentState === "UNKNOWN") unknowns.push("INCIDENT_STATE_UNKNOWN");

  const normalizedBlockers = Object.freeze([...new Set(blockers)].sort());
  const normalizedUnknowns = Object.freeze([...new Set(unknowns)].sort());
  const normalizedApproverIds = Object.freeze([...approverIds].sort());
  const approvalEvidence = Object.freeze([...normalizedApprovals].sort((a, b) => a.principalId.localeCompare(b.principalId)));
  const verdict: ScaleGovernanceVerdict = normalizedBlockers.length > 0
    ? "SAFE_BLOCK"
    : normalizedUnknowns.length > 0
      ? "UNKNOWN"
      : "COMPLETE_FOR_SEPARATE_MANUAL_SCALE_CHANGE_REVIEW";
  const reviewFingerprint = sha256({
    policyChangeId,
    evaluatedAt: input.evaluatedAt,
    reviewStartsAt: input.reviewStartsAt,
    reviewExpiresAt: input.reviewExpiresAt,
    lastValidatedSessionEndedAt: input.lastValidatedSessionEndedAt,
    cooldownSeconds: input.cooldownSeconds,
    requesterId,
    approverIds: normalizedApproverIds,
    approvalEvidence,
    codeRevision,
    configurationHash,
    priorPostLiveVerdict: input.priorPostLiveVerdict,
    priorPostLiveValidationFingerprint: priorFingerprint,
    currentEnvelope,
    currentEnvelopeFingerprint,
    proposedEnvelope,
    proposedEnvelopeFingerprint,
    reason,
    auditReceiptId,
    antiReplayState: input.antiReplayState,
    safetyState: input.safetyState,
    killSwitchReady: input.killSwitchReady,
    rollback: input.rollback,
    reconciliation: input.reconciliation,
    auditChain: input.auditChain,
    incidentState: input.incidentState,
    verdict,
    blockers: normalizedBlockers,
    unknowns: normalizedUnknowns,
    scaleUpAuthority: false,
    activationAuthority: false,
    executionAuthority: false,
    authorizesLive: false,
  });

  return Object.freeze({
    verdict,
    blockers: normalizedBlockers,
    unknowns: normalizedUnknowns,
    policyChangeId,
    currentEnvelopeFingerprint,
    proposedEnvelopeFingerprint,
    reviewFingerprint,
    requesterId,
    approverIds: normalizedApproverIds,
    scaleUpAuthority: false,
    activationAuthority: false,
    orderAuthorization: false,
    executionAuthority: false,
    authorizesLive: false,
    mutationPerformed: false,
    realMoneyExecutionAllowed: false,
  });
}
