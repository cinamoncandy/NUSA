import { createHash } from "node:crypto";

export type RestrictedLivePreflightVerdict = "READY_FOR_HUMAN_REVIEW" | "SAFE_BLOCK" | "UNKNOWN";
export type PreflightPassState = "PASS" | "FAIL" | "UNKNOWN";
export type PreflightOperationalState = "SAFE" | "DEGRADED" | "RESTRICTED" | "HALT" | "UNKNOWN";

export interface RestrictedLivePreflightInput {
  readonly codeRevision: string;
  readonly configurationHash: string;
  readonly evidenceRefs: readonly string[];
  readonly restoreVerification: PreflightPassState;
  readonly auditReplay: "VALID" | "UNKNOWN" | "FAIL";
  readonly readOnlyBroker: PreflightPassState;
  readonly reconciliation: "MATCH" | "DIFF" | "UNKNOWN";
  readonly marketDataHealth: "HEALTHY" | "STALE" | "UNAVAILABLE" | "UNKNOWN";
  readonly hardRisk: "PASS" | "REJECT" | "BLOCK" | "UNKNOWN";
  readonly killSwitch: "INACTIVE" | "ACTIVE" | "UNKNOWN";
  readonly governanceState: "RESTRICTED" | "DISABLED" | "ARMED" | "AUTHORIZED" | "ACTIVE" | "COOLDOWN" | "HALT" | "UNKNOWN";
  readonly operationalState: PreflightOperationalState;
  readonly capabilitySurface: PreflightPassState;
  readonly executionTransportConnected: boolean;
  readonly executionCredentialUseEnabled: boolean;
  readonly realMoneyExecutionAllowed: boolean;
  readonly automaticActivationAllowed: boolean;
  readonly mutationCapabilityPresent: boolean;
  readonly readOnlyTransportMode: "DISCONNECTED" | "OPERATOR_INITIATED" | "UNKNOWN";
  readonly requiredHumanApprovers: number;
  readonly distinctHumanApproversRequired: boolean;
  readonly rollbackTargetPresent: boolean;
  readonly expiryRequired: boolean;
  readonly cooldownRequired: boolean;
  readonly exactScopeRequired: boolean;
  readonly mutationCounters: Readonly<{
    brokerCalls: number;
    orders: number;
    fills: number;
    cash: number;
    positions: number;
  }>;
}

export interface RestrictedLivePreflightResult {
  readonly verdict: RestrictedLivePreflightVerdict;
  readonly blockers: readonly string[];
  readonly unknowns: readonly string[];
  readonly codeRevision: string;
  readonly configurationHash: string;
  readonly evidenceRefs: readonly string[];
  readonly fingerprint: string;
  readonly executionAuthority: false;
  readonly authorizesLive: false;
  readonly networkDialPerformed: false;
  readonly executionCredentialUse: false;
  readonly realMoneyExecutionAllowed: false;
}

export const RESTRICTED_LIVE_ENVIRONMENT_PREFLIGHT_DESCRIPTOR = Object.freeze({
  mode: "EVIDENCE_ONLY_PREFLIGHT" as const,
  verdicts: Object.freeze(["READY_FOR_HUMAN_REVIEW", "SAFE_BLOCK", "UNKNOWN"] as const),
  safetyCriticalUnknown: "fail_closed" as const,
  networkDialAllowed: false as const,
  executionTransportRequired: "DISCONNECTED" as const,
  executionCredentialUse: false as const,
  executionAuthority: false as const,
  authorizesLive: false as const,
  automaticActivationAllowed: false as const,
  realMoneyExecutionAllowed: false as const
});

const forbiddenEvidenceMaterial = /(?:bearer\s+|private[_ -]?key|api[_ -]?secret|access[_ -]?token|authorization\s*:)/i;
const COUNTERS = ["brokerCalls", "orders", "fills", "cash", "positions"] as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requireIdentity(value: string, length: 40 | 64, code: string): string {
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value)) throw new Error(code);
  return value;
}

function normalizeEvidenceRefs(refs: readonly string[]): readonly string[] {
  if (!Array.isArray(refs) || refs.length === 0) throw new Error("PREFLIGHT_EVIDENCE_REFS_REQUIRED");
  const normalized = refs.map((ref) => ref.trim()).sort();
  if (normalized.some((ref) => !ref || forbiddenEvidenceMaterial.test(ref))) throw new Error("PREFLIGHT_EVIDENCE_REF_INVALID");
  if (new Set(normalized).size !== normalized.length) throw new Error("PREFLIGHT_EVIDENCE_REF_DUPLICATE");
  return Object.freeze(normalized);
}

function unknownIf(condition: boolean, code: string, unknowns: string[]): void {
  if (condition) unknowns.push(code);
}

function blockIf(condition: boolean, code: string, blockers: string[]): void {
  if (condition) blockers.push(code);
}

export function evaluateRestrictedLiveEnvironmentPreflight(input: RestrictedLivePreflightInput): RestrictedLivePreflightResult {
  const codeRevision = requireIdentity(input.codeRevision, 40, "PREFLIGHT_CODE_REVISION_INVALID");
  const configurationHash = requireIdentity(input.configurationHash, 64, "PREFLIGHT_CONFIGURATION_HASH_INVALID");
  const evidenceRefs = normalizeEvidenceRefs(input.evidenceRefs);
  const blockers: string[] = [];
  const unknowns: string[] = [];

  blockIf(input.executionTransportConnected, "EXECUTION_TRANSPORT_CONNECTED", blockers);
  blockIf(input.executionCredentialUseEnabled, "EXECUTION_CREDENTIAL_USE_ENABLED", blockers);
  blockIf(input.realMoneyExecutionAllowed, "REAL_MONEY_EXECUTION_ALLOWED", blockers);
  blockIf(input.automaticActivationAllowed, "AUTOMATIC_ACTIVATION_ALLOWED", blockers);
  blockIf(input.mutationCapabilityPresent, "MUTATION_CAPABILITY_PRESENT", blockers);
  blockIf(input.reconciliation === "DIFF", "RECONCILIATION_DIFF", blockers);
  blockIf(input.marketDataHealth === "STALE" || input.marketDataHealth === "UNAVAILABLE", "MARKET_DATA_UNSAFE", blockers);
  blockIf(input.hardRisk === "REJECT" || input.hardRisk === "BLOCK", "HARD_RISK_BLOCKING", blockers);
  blockIf(input.killSwitch === "ACTIVE", "KILL_SWITCH_ACTIVE", blockers);
  blockIf(input.governanceState !== "RESTRICTED" && input.governanceState !== "UNKNOWN", "GOVERNANCE_NOT_RESTRICTED", blockers);
  blockIf(input.operationalState !== "SAFE" && input.operationalState !== "UNKNOWN", "OPERATIONAL_STATE_NOT_SAFE", blockers);
  blockIf(input.restoreVerification === "FAIL", "RESTORE_VERIFICATION_FAILED", blockers);
  blockIf(input.auditReplay === "FAIL", "AUDIT_REPLAY_FAILED", blockers);
  blockIf(input.readOnlyBroker === "FAIL", "READ_ONLY_BROKER_FAILED", blockers);
  blockIf(input.capabilitySurface === "FAIL", "CAPABILITY_SURFACE_FAILED", blockers);
  blockIf(input.requiredHumanApprovers !== 2 || !input.distinctHumanApproversRequired, "TWO_DISTINCT_HUMANS_NOT_REQUIRED", blockers);
  blockIf(!input.rollbackTargetPresent, "ROLLBACK_TARGET_MISSING", blockers);
  blockIf(!input.expiryRequired, "EXPIRY_NOT_REQUIRED", blockers);
  blockIf(!input.cooldownRequired, "COOLDOWN_NOT_REQUIRED", blockers);
  blockIf(!input.exactScopeRequired, "EXACT_SCOPE_NOT_REQUIRED", blockers);

  for (const key of COUNTERS) {
    const value = input.mutationCounters[key];
    if (!Number.isSafeInteger(value) || value < 0) blockers.push(`MUTATION_COUNTER_INVALID:${key}`);
    else if (value !== 0) blockers.push(`MUTATION_COUNTER_NONZERO:${key}`);
  }

  unknownIf(input.restoreVerification === "UNKNOWN", "RESTORE_VERIFICATION_UNKNOWN", unknowns);
  unknownIf(input.auditReplay === "UNKNOWN", "AUDIT_REPLAY_UNKNOWN", unknowns);
  unknownIf(input.readOnlyBroker === "UNKNOWN", "READ_ONLY_BROKER_UNKNOWN", unknowns);
  unknownIf(input.reconciliation === "UNKNOWN", "RECONCILIATION_UNKNOWN", unknowns);
  unknownIf(input.marketDataHealth === "UNKNOWN", "MARKET_DATA_UNKNOWN", unknowns);
  unknownIf(input.hardRisk === "UNKNOWN", "HARD_RISK_UNKNOWN", unknowns);
  unknownIf(input.killSwitch === "UNKNOWN", "KILL_SWITCH_UNKNOWN", unknowns);
  unknownIf(input.governanceState === "UNKNOWN", "GOVERNANCE_UNKNOWN", unknowns);
  unknownIf(input.operationalState === "UNKNOWN", "OPERATIONAL_STATE_UNKNOWN", unknowns);
  unknownIf(input.capabilitySurface === "UNKNOWN", "CAPABILITY_SURFACE_UNKNOWN", unknowns);
  unknownIf(input.readOnlyTransportMode === "UNKNOWN", "READ_ONLY_TRANSPORT_UNKNOWN", unknowns);

  const normalizedBlockers = Object.freeze([...new Set(blockers)].sort());
  const normalizedUnknowns = Object.freeze([...new Set(unknowns)].sort());
  const verdict: RestrictedLivePreflightVerdict = normalizedBlockers.length > 0
    ? "SAFE_BLOCK"
    : normalizedUnknowns.length > 0
      ? "UNKNOWN"
      : "READY_FOR_HUMAN_REVIEW";

  const normalizedInput = {
    ...input,
    evidenceRefs,
    mutationCounters: Object.freeze({ ...input.mutationCounters })
  };
  const fingerprint = sha256(canonical({
    input: normalizedInput,
    verdict,
    blockers: normalizedBlockers,
    unknowns: normalizedUnknowns,
    executionAuthority: false,
    authorizesLive: false,
    networkDialPerformed: false
  }));

  return Object.freeze({
    verdict,
    blockers: normalizedBlockers,
    unknowns: normalizedUnknowns,
    codeRevision,
    configurationHash,
    evidenceRefs,
    fingerprint,
    executionAuthority: false,
    authorizesLive: false,
    networkDialPerformed: false,
    executionCredentialUse: false,
    realMoneyExecutionAllowed: false
  });
}
