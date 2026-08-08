import { createHash } from "node:crypto";

export type CeremonyVerdict = "COMPLETE_FOR_SEPARATE_MANUAL_ACTIVATION_REVIEW" | "SAFE_BLOCK" | "UNKNOWN";
export type CeremonyPrincipalKind = "HUMAN" | "AI" | "META_AI" | "AUTOMATION" | "PROVIDER" | "SYSTEM";
export type ExternalVerification = "PASS" | "FAIL" | "UNKNOWN";
export type AntiReplayState = "UNUSED" | "USED" | "UNKNOWN";

export interface CeremonyScope {
  readonly deploymentBundleId: string;
  readonly rollbackBundleId: string;
  readonly capabilityContract: string;
  readonly strategyIdentity: string;
  readonly symbols: readonly string[];
  readonly maxOrderNotional: number;
  readonly maxPortfolioExposure: number;
  readonly startsAt: string;
  readonly expiresAt: string;
  readonly cooldownSeconds: number;
}

export interface CeremonyApproval {
  readonly principalId: string;
  readonly principalKind: CeremonyPrincipalKind;
  readonly ceremonyId: string;
  readonly preflightFingerprint: string;
  readonly scopeFingerprint: string;
  readonly approvedAt: string;
  readonly signatureVerification: ExternalVerification;
  readonly attestationDigest: string;
}

export interface RestrictedLiveCeremonyInput {
  readonly ceremonyId: string;
  readonly evaluatedAt: string;
  readonly requester: Readonly<{ principalId: string; principalKind: CeremonyPrincipalKind }>;
  readonly approvers: readonly CeremonyApproval[];
  readonly preflightVerdict: "READY_FOR_HUMAN_REVIEW" | "SAFE_BLOCK" | "UNKNOWN";
  readonly preflightFingerprint: string;
  readonly codeRevision: string;
  readonly configurationHash: string;
  readonly scope: CeremonyScope;
  readonly reason: string;
  readonly auditReceiptId: string;
  readonly antiReplayState: AntiReplayState;
  readonly executionTransportConnected: boolean;
  readonly executionCredentialUseEnabled: boolean;
  readonly realMoneyExecutionAllowed: boolean;
  readonly automaticActivationAllowed: boolean;
  readonly killSwitch: "INACTIVE" | "ACTIVE" | "UNKNOWN";
  readonly mutationCounters: Readonly<{
    brokerCalls: number;
    orders: number;
    fills: number;
    cash: number;
    positions: number;
  }>;
}

export interface RestrictedLiveCeremonyResult {
  readonly verdict: CeremonyVerdict;
  readonly blockers: readonly string[];
  readonly unknowns: readonly string[];
  readonly ceremonyId: string;
  readonly preflightFingerprint: string;
  readonly scopeFingerprint: string;
  readonly ceremonyFingerprint: string;
  readonly requesterId: string;
  readonly approverIds: readonly string[];
  readonly activationCredentialIssued: false;
  readonly executionAuthority: false;
  readonly authorizesLive: false;
  readonly actualActivationPerformed: false;
  readonly realMoneyExecutionAllowed: false;
}

export const RESTRICTED_LIVE_ACTIVATION_CEREMONY_DESCRIPTOR = Object.freeze({
  mode: "VALIDATION_ONLY" as const,
  actualCeremonyConductedByCi: false as const,
  activationCredentialIssued: false as const,
  executionAuthority: false as const,
  authorizesLive: false as const,
  actualActivationPerformed: false as const,
  automaticActivationAllowed: false as const,
  executionCredentialUse: false as const,
  networkDialAllowed: false as const,
  realMoneyExecutionAllowed: false as const,
  requiredDistinctHumanApprovers: 2 as const,
  antiReplayRequired: true as const,
  externalSignatureVerificationRequired: true as const
});

const COUNTERS = ["brokerCalls", "orders", "fills", "cash", "positions"] as const;
const prohibitedMaterial = /(?:bearer\s+|private[_ -]?key|api[_ -]?secret|access[_ -]?token|authorization\s*:)/i;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function required(value: string, code: string): string { const v = value.trim(); if (!v || prohibitedMaterial.test(v)) throw new Error(code); return v; }
function exactHash(value: string, length: 40 | 64, code: string): string { if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value)) throw new Error(code); return value; }
function instant(value: string, code: string): number { const parsed = Date.parse(value); if (Number.isNaN(parsed)) throw new Error(code); return parsed; }

function normalizeScope(scope: CeremonyScope): Readonly<CeremonyScope> {
  const starts = instant(scope.startsAt, "CEREMONY_SCOPE_START_INVALID");
  const expires = instant(scope.expiresAt, "CEREMONY_SCOPE_EXPIRY_INVALID");
  if (expires <= starts) throw new Error("CEREMONY_SCOPE_WINDOW_INVALID");
  if (!Number.isFinite(scope.maxOrderNotional) || scope.maxOrderNotional <= 0) throw new Error("CEREMONY_SCOPE_ORDER_LIMIT_INVALID");
  if (!Number.isFinite(scope.maxPortfolioExposure) || scope.maxPortfolioExposure <= 0) throw new Error("CEREMONY_SCOPE_EXPOSURE_LIMIT_INVALID");
  if (!Number.isSafeInteger(scope.cooldownSeconds) || scope.cooldownSeconds <= 0) throw new Error("CEREMONY_SCOPE_COOLDOWN_INVALID");
  if (!Array.isArray(scope.symbols) || scope.symbols.length === 0) throw new Error("CEREMONY_SCOPE_SYMBOLS_REQUIRED");
  const symbols = [...new Set(scope.symbols.map((symbol) => required(symbol, "CEREMONY_SCOPE_SYMBOL_INVALID")))].sort();
  if (symbols.length !== scope.symbols.length) throw new Error("CEREMONY_SCOPE_SYMBOL_DUPLICATE");
  return Object.freeze({
    deploymentBundleId: required(scope.deploymentBundleId, "CEREMONY_DEPLOYMENT_BUNDLE_REQUIRED"),
    rollbackBundleId: required(scope.rollbackBundleId, "CEREMONY_ROLLBACK_BUNDLE_REQUIRED"),
    capabilityContract: required(scope.capabilityContract, "CEREMONY_CAPABILITY_CONTRACT_REQUIRED"),
    strategyIdentity: required(scope.strategyIdentity, "CEREMONY_STRATEGY_IDENTITY_REQUIRED"),
    symbols: Object.freeze(symbols),
    maxOrderNotional: scope.maxOrderNotional,
    maxPortfolioExposure: scope.maxPortfolioExposure,
    startsAt: scope.startsAt,
    expiresAt: scope.expiresAt,
    cooldownSeconds: scope.cooldownSeconds
  });
}

export function computeCeremonyScopeFingerprint(scope: CeremonyScope): string {
  return sha256(canonical(normalizeScope(scope)));
}

export function evaluateRestrictedLiveActivationCeremony(input: RestrictedLiveCeremonyInput): RestrictedLiveCeremonyResult {
  const ceremonyId = required(input.ceremonyId, "CEREMONY_ID_REQUIRED");
  const evaluatedAtMs = instant(input.evaluatedAt, "CEREMONY_EVALUATED_AT_INVALID");
  const preflightFingerprint = exactHash(input.preflightFingerprint, 64, "CEREMONY_PREFLIGHT_FINGERPRINT_INVALID");
  const codeRevision = exactHash(input.codeRevision, 40, "CEREMONY_CODE_REVISION_INVALID");
  const configurationHash = exactHash(input.configurationHash, 64, "CEREMONY_CONFIGURATION_HASH_INVALID");
  const reason = required(input.reason, "CEREMONY_REASON_REQUIRED");
  const auditReceiptId = required(input.auditReceiptId, "CEREMONY_AUDIT_RECEIPT_REQUIRED");
  const scope = normalizeScope(input.scope);
  const scopeFingerprint = sha256(canonical(scope));
  const blockers: string[] = [];
  const unknowns: string[] = [];

  const requesterId = required(input.requester.principalId, "CEREMONY_REQUESTER_REQUIRED");
  if (input.requester.principalKind !== "HUMAN") blockers.push("REQUESTER_NOT_HUMAN");
  if (input.approvers.length !== 2) blockers.push("EXACTLY_TWO_APPROVERS_REQUIRED");

  const approverIds: string[] = [];
  for (const approval of input.approvers) {
    const principalId = required(approval.principalId, "CEREMONY_APPROVER_ID_REQUIRED");
    approverIds.push(principalId);
    if (approval.principalKind !== "HUMAN") blockers.push(`APPROVER_NOT_HUMAN:${principalId}`);
    if (approval.ceremonyId !== ceremonyId) blockers.push(`APPROVER_CEREMONY_MISMATCH:${principalId}`);
    if (approval.preflightFingerprint !== preflightFingerprint) blockers.push(`APPROVER_PREFLIGHT_MISMATCH:${principalId}`);
    if (approval.scopeFingerprint !== scopeFingerprint) blockers.push(`APPROVER_SCOPE_MISMATCH:${principalId}`);
    if (!/^[0-9a-f]{64}$/.test(approval.attestationDigest)) blockers.push(`APPROVER_ATTESTATION_DIGEST_INVALID:${principalId}`);
    const approvedAtMs = instant(approval.approvedAt, `CEREMONY_APPROVAL_TIME_INVALID:${principalId}`);
    if (approvedAtMs < Date.parse(scope.startsAt) || approvedAtMs > Date.parse(scope.expiresAt) || approvedAtMs > evaluatedAtMs) blockers.push(`APPROVAL_OUTSIDE_WINDOW:${principalId}`);
    if (approval.signatureVerification === "FAIL") blockers.push(`SIGNATURE_VERIFICATION_FAILED:${principalId}`);
    if (approval.signatureVerification === "UNKNOWN") unknowns.push(`SIGNATURE_VERIFICATION_UNKNOWN:${principalId}`);
  }

  if (new Set(approverIds).size !== approverIds.length) blockers.push("DUPLICATE_APPROVER");
  if (approverIds.some((id) => id === requesterId)) blockers.push("REQUESTER_APPROVER_NOT_SEPARATED");
  if (evaluatedAtMs < Date.parse(scope.startsAt)) blockers.push("CEREMONY_NOT_YET_VALID");
  if (evaluatedAtMs > Date.parse(scope.expiresAt)) blockers.push("CEREMONY_EXPIRED");

  if (input.preflightVerdict === "SAFE_BLOCK") blockers.push("PREFLIGHT_BLOCKED");
  if (input.preflightVerdict === "UNKNOWN") unknowns.push("PREFLIGHT_UNKNOWN");
  if (input.antiReplayState === "USED") blockers.push("CEREMONY_ID_ALREADY_USED");
  if (input.antiReplayState === "UNKNOWN") unknowns.push("ANTI_REPLAY_STATE_UNKNOWN");
  if (input.executionTransportConnected) blockers.push("EXECUTION_TRANSPORT_CONNECTED");
  if (input.executionCredentialUseEnabled) blockers.push("EXECUTION_CREDENTIAL_USE_ENABLED");
  if (input.realMoneyExecutionAllowed) blockers.push("REAL_MONEY_EXECUTION_ALREADY_ALLOWED");
  if (input.automaticActivationAllowed) blockers.push("AUTOMATIC_ACTIVATION_ALLOWED");
  if (input.killSwitch === "ACTIVE") blockers.push("KILL_SWITCH_ACTIVE");
  if (input.killSwitch === "UNKNOWN") unknowns.push("KILL_SWITCH_UNKNOWN");
  for (const key of COUNTERS) {
    const value = input.mutationCounters[key];
    if (!Number.isSafeInteger(value) || value < 0) blockers.push(`MUTATION_COUNTER_INVALID:${key}`);
    else if (value !== 0) blockers.push(`MUTATION_COUNTER_NONZERO:${key}`);
  }

  const normalizedApproverIds = Object.freeze([...approverIds].sort());
  const normalizedBlockers = Object.freeze([...new Set(blockers)].sort());
  const normalizedUnknowns = Object.freeze([...new Set(unknowns)].sort());
  const verdict: CeremonyVerdict = normalizedBlockers.length > 0
    ? "SAFE_BLOCK"
    : normalizedUnknowns.length > 0
      ? "UNKNOWN"
      : "COMPLETE_FOR_SEPARATE_MANUAL_ACTIVATION_REVIEW";

  const ceremonyFingerprint = sha256(canonical({
    ceremonyId,
    evaluatedAt: input.evaluatedAt,
    requesterId,
    approverIds: normalizedApproverIds,
    preflightFingerprint,
    codeRevision,
    configurationHash,
    scope,
    scopeFingerprint,
    reason,
    auditReceiptId,
    antiReplayState: input.antiReplayState,
    verdict,
    blockers: normalizedBlockers,
    unknowns: normalizedUnknowns,
    activationCredentialIssued: false,
    executionAuthority: false,
    authorizesLive: false,
    actualActivationPerformed: false
  }));

  return Object.freeze({
    verdict,
    blockers: normalizedBlockers,
    unknowns: normalizedUnknowns,
    ceremonyId,
    preflightFingerprint,
    scopeFingerprint,
    ceremonyFingerprint,
    requesterId,
    approverIds: normalizedApproverIds,
    activationCredentialIssued: false,
    executionAuthority: false,
    authorizesLive: false,
    actualActivationPerformed: false,
    realMoneyExecutionAllowed: false
  });
}
