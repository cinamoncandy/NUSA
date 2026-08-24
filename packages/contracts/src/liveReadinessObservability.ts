/**
 * Safe, read-only projection of the canonical LIVE readiness source.
 *
 * This wire contract deliberately contains no lease identifier, credential material,
 * account identifier, order capability, or mutation operation.  It is a visibility
 * surface for preparation state, not a LIVE execution contract.
 */
export type LiveReadinessProjectionStatus = "NOT_READY" | "READY_FOR_MANUAL_ENABLE" | "ENABLED" | "HALTED";
export type LiveReadinessProjectionFreshness = "FRESH" | "STALE" | "UNKNOWN";
export type LiveReadinessProjectionSourceId =
  | "currentHeadSha"
  | "paperAutoLearning"
  | "shadowReplay"
  | "realAccountMonitor"
  | "governance"
  | "tradePermission"
  | "riskAuthority"
  | "reconciliationTests"
  | "killSwitchTests"
  | "idempotencyTests"
  | "exchangeFaultTests"
  | "workflows"
  | "prohibitedFinancialMutationScan"
  | "environmentFingerprint"
  | "accountFingerprint"
  | "riskLimits"
  | "runtimeSafety"
  | "authority"
  | "activationState"
  | "activationLeaseState";

export interface LiveReadinessProjectionProvenanceInput {
  readonly sourceId: LiveReadinessProjectionSourceId;
  readonly fingerprint: string;
  readonly observedAt?: string;
  readonly freshness: LiveReadinessProjectionFreshness;
}

export interface LiveReadinessProjectionProvenance {
  readonly generatedAt: string;
  readonly sourceVersion: string;
  readonly sourceFingerprint: string;
  readonly inputs: readonly LiveReadinessProjectionProvenanceInput[];
}

export interface LiveReadinessProjectionWorkflowEvidence {
  readonly headSha: string;
  readonly ci: "PASS" | "FAIL" | "UNKNOWN";
  readonly mobileNative: "PASS" | "FAIL" | "UNKNOWN";
  readonly restrictedLiveSafety: "PASS" | "FAIL" | "UNKNOWN";
  readonly readOnlyBroker: "PASS" | "FAIL" | "UNKNOWN";
  readonly aiZeroAuthority: "PASS" | "FAIL" | "UNKNOWN";
}

export interface LiveReadinessProjectionRiskLimits {
  readonly maxNotionalPerOrder: number;
  readonly maxDailyLoss: number;
  readonly maxOpenExposure: number;
  readonly maxConcurrentPositions: number;
  readonly maxSlippageBps: number;
  readonly maxOrdersPerMinute: number;
  readonly marketAllowlist: readonly string[];
}

export interface LiveReadinessProjectionRuntimeSafety {
  readonly killSwitchActive: boolean;
  readonly staleMarketData: boolean;
  readonly reconciliationMismatch: boolean;
  readonly exchangeError: boolean;
  readonly abnormalBalanceDrift: boolean;
  readonly riskBudgetBreached: boolean;
  readonly strategyInvalidated: boolean;
  readonly latencyOrSlippageBreached: boolean;
}

export interface LiveReadinessProjectionIncident {
  readonly code: string;
  readonly severity: "WARNING" | "CRITICAL";
  readonly sourceId?: LiveReadinessProjectionSourceId;
  readonly observedAt?: string;
}

export interface LiveReadinessProjectionTimelineEntry {
  readonly sourceId: LiveReadinessProjectionSourceId;
  readonly freshness: LiveReadinessProjectionFreshness;
  readonly observedAt?: string;
}

export interface LiveReadinessObservabilitySnapshot {
  readonly schemaVersion: 1;
  readonly mode: "LIVE_READY";
  readonly readOnly: true;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly status: LiveReadinessProjectionStatus;
  readonly blockers: readonly string[];
  readonly currentHeadSha: string;
  readonly paperAutoLearning: "STABLE" | "UNSTABLE" | "UNKNOWN";
  readonly shadowReplay: "VALID" | "INVALID" | "MISSING";
  readonly realAccountMonitor: "CONNECTED" | "STALE" | "AUTH_ERROR" | "RELAY_ERROR" | "OFFLINE" | "UNKNOWN";
  readonly credentialReadiness: "READY" | "NOT_READY" | "UNKNOWN";
  readonly governance: "APPROVED" | "REJECTED" | "UNKNOWN";
  readonly tradePermission: "PERMIT" | "REJECT" | "UNKNOWN";
  readonly riskAuthority: "HEALTHY" | "HALTED" | "UNKNOWN";
  readonly reconciliationTests: "PASS" | "FAIL" | "UNKNOWN";
  readonly killSwitchTests: "PASS" | "FAIL" | "UNKNOWN";
  readonly idempotencyTests: "PASS" | "FAIL" | "UNKNOWN";
  readonly exchangeFaultTests: "PASS" | "FAIL" | "UNKNOWN";
  readonly workflows: LiveReadinessProjectionWorkflowEvidence;
  readonly prohibitedFinancialMutationScan: "ABSENT" | "PRESENT" | "UNKNOWN";
  readonly environmentFingerprint: string;
  readonly accountFingerprint: string;
  readonly riskLimits?: LiveReadinessProjectionRiskLimits;
  readonly runtimeSafety: LiveReadinessProjectionRuntimeSafety;
  readonly activationState: "NOT_CONFIGURED" | "PENDING" | "READY_FOR_MANUAL_ENABLE" | "ENABLED" | "HALTED" | "UNKNOWN";
  readonly activationLeaseState: "ABSENT" | "VALID" | "EXPIRED" | "UNKNOWN";
  readonly freshness: Readonly<Record<LiveReadinessProjectionSourceId, LiveReadinessProjectionFreshness>>;
  readonly provenance: LiveReadinessProjectionProvenance;
  readonly incidents: readonly LiveReadinessProjectionIncident[];
  /** Empty unless canonical mock/rehearsal lifecycle evidence exists. */
  readonly timeline: readonly LiveReadinessProjectionTimelineEntry[];
  readonly lastRefresh: string;
}

const SOURCE_IDS: readonly LiveReadinessProjectionSourceId[] = Object.freeze([
  "currentHeadSha", "paperAutoLearning", "shadowReplay", "realAccountMonitor", "governance", "tradePermission", "riskAuthority",
  "reconciliationTests", "killSwitchTests", "idempotencyTests", "exchangeFaultTests", "workflows", "prohibitedFinancialMutationScan",
  "environmentFingerprint", "accountFingerprint", "riskLimits", "runtimeSafety", "authority", "activationState", "activationLeaseState",
]);
const FRESHNESS = new Set<LiveReadinessProjectionFreshness>(["FRESH", "STALE", "UNKNOWN"]);
const FORBIDDEN_KEY = /(authorization|bearer|token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|cookie|jwt|nonce|signature|account[_-]?id|order[_-]?id|fill[_-]?id|lease[_-]?id)/i;
const FORBIDDEN_VALUE = /(bearer\s|eyJ[A-Za-z0-9_-]{8,}|-----BEGIN)/i;
const SAFE_REFERENCE = /^[A-Za-z0-9._:-]{0,256}$/;

function safeText(value: unknown, name: string, maximum = 256): void {
  if (typeof value !== "string" || value.length > maximum || FORBIDDEN_VALUE.test(value)) throw new Error(`${name} is not safe`);
}

function finite(value: unknown, name: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function assertSafeObject(value: unknown, path = "liveReadiness"): void {
  if (value == null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error(`${path}.${key} is prohibited`);
    if (typeof child === "string" && FORBIDDEN_VALUE.test(child)) throw new Error(`${path}.${key} contains prohibited material`);
    assertSafeObject(child, `${path}.${key}`);
  }
}

export function validateLiveReadinessObservabilitySnapshot(snapshot: LiveReadinessObservabilitySnapshot): LiveReadinessObservabilitySnapshot {
  if (snapshot.schemaVersion !== 1 || snapshot.mode !== "LIVE_READY" || snapshot.readOnly !== true || snapshot.liveAuthority !== "NONE" || snapshot.productionMutationAllowed !== false || snapshot.aiAuthority !== "ZERO_AUTHORITY") throw new Error("LIVE_READY authority invariant violated");
  if (!["NOT_READY", "READY_FOR_MANUAL_ENABLE", "ENABLED", "HALTED"].includes(snapshot.status)) throw new Error("invalid LIVE_READY status");
  if (!Array.isArray(snapshot.blockers) || snapshot.blockers.some((value) => typeof value !== "string" || !value.trim() || FORBIDDEN_VALUE.test(value))) throw new Error("invalid LIVE_READY blockers");
  for (const name of ["currentHeadSha", "environmentFingerprint", "accountFingerprint"] as const) {
    safeText(snapshot[name], name);
    if (!SAFE_REFERENCE.test(snapshot[name])) throw new Error(`${name} is not a safe reference`);
  }
  if (!["STABLE", "UNSTABLE", "UNKNOWN"].includes(snapshot.paperAutoLearning)) throw new Error("invalid PAPER readiness");
  if (!["VALID", "INVALID", "MISSING"].includes(snapshot.shadowReplay)) throw new Error("invalid SHADOW readiness");
  if (!["CONNECTED", "STALE", "AUTH_ERROR", "RELAY_ERROR", "OFFLINE", "UNKNOWN"].includes(snapshot.realAccountMonitor)) throw new Error("invalid REAL_READ_ONLY readiness");
  if (!["READY", "NOT_READY", "UNKNOWN"].includes(snapshot.credentialReadiness)) throw new Error("invalid credential readiness");
  if (!["APPROVED", "REJECTED", "UNKNOWN"].includes(snapshot.governance)) throw new Error("invalid governance readiness");
  if (!["PERMIT", "REJECT", "UNKNOWN"].includes(snapshot.tradePermission)) throw new Error("invalid TradePermission readiness");
  if (!["HEALTHY", "HALTED", "UNKNOWN"].includes(snapshot.riskAuthority)) throw new Error("invalid RiskAuthority readiness");
  for (const name of ["reconciliationTests", "killSwitchTests", "idempotencyTests", "exchangeFaultTests"] as const) if (!["PASS", "FAIL", "UNKNOWN"].includes(snapshot[name])) throw new Error(`invalid ${name}`);
  for (const name of ["prohibitedFinancialMutationScan"] as const) if (!["ABSENT", "PRESENT", "UNKNOWN"].includes(snapshot[name])) throw new Error(`invalid ${name}`);
  const workflow = snapshot.workflows;
  safeText(workflow.headSha, "workflows.headSha");
  for (const name of ["ci", "mobileNative", "restrictedLiveSafety", "readOnlyBroker", "aiZeroAuthority"] as const) if (!["PASS", "FAIL", "UNKNOWN"].includes(workflow[name])) throw new Error(`invalid workflows.${name}`);
  if (snapshot.riskLimits != null) {
    for (const name of ["maxNotionalPerOrder", "maxDailyLoss", "maxOpenExposure", "maxSlippageBps"] as const) finite(snapshot.riskLimits[name], `riskLimits.${name}`);
    if (!Number.isSafeInteger(snapshot.riskLimits.maxConcurrentPositions) || snapshot.riskLimits.maxConcurrentPositions < 1) throw new Error("invalid risk limits");
    if (!Number.isSafeInteger(snapshot.riskLimits.maxOrdersPerMinute) || snapshot.riskLimits.maxOrdersPerMinute < 1) throw new Error("invalid risk limits");
    if (!Array.isArray(snapshot.riskLimits.marketAllowlist) || snapshot.riskLimits.marketAllowlist.some((market) => typeof market !== "string" || !/^[A-Z0-9]+-[A-Z0-9]+$/.test(market))) throw new Error("invalid risk market allowlist");
  }
  const runtimeSafety = snapshot.runtimeSafety;
  for (const name of ["killSwitchActive", "staleMarketData", "reconciliationMismatch", "exchangeError", "abnormalBalanceDrift", "riskBudgetBreached", "strategyInvalidated", "latencyOrSlippageBreached"] as const) if (typeof runtimeSafety[name] !== "boolean") throw new Error(`invalid runtimeSafety.${name}`);
  if (!["NOT_CONFIGURED", "PENDING", "READY_FOR_MANUAL_ENABLE", "ENABLED", "HALTED", "UNKNOWN"].includes(snapshot.activationState)) throw new Error("invalid activation state");
  if (!["ABSENT", "VALID", "EXPIRED", "UNKNOWN"].includes(snapshot.activationLeaseState)) throw new Error("invalid activation lease state");
  for (const sourceId of SOURCE_IDS) if (!FRESHNESS.has(snapshot.freshness[sourceId])) throw new Error(`invalid freshness.${sourceId}`);
  if (!snapshot.provenance || !ISO_DATE.test(snapshot.provenance.generatedAt) || !Number.isFinite(Date.parse(snapshot.provenance.generatedAt))) throw new Error("invalid LIVE_READY provenance timestamp");
  safeText(snapshot.provenance.sourceVersion, "provenance.sourceVersion");
  if (!/^[a-f0-9]{64}$/.test(snapshot.provenance.sourceFingerprint)) throw new Error("invalid LIVE_READY source fingerprint");
  if (!Array.isArray(snapshot.provenance.inputs)) throw new Error("invalid LIVE_READY provenance inputs");
  const inputIds = new Set<string>();
  for (const input of snapshot.provenance.inputs) {
    if (!SOURCE_IDS.includes(input.sourceId) || inputIds.has(input.sourceId)) throw new Error("invalid LIVE_READY provenance source id");
    inputIds.add(input.sourceId);
    if (!SAFE_REFERENCE.test(input.fingerprint) || !input.fingerprint || !FRESHNESS.has(input.freshness)) throw new Error("invalid LIVE_READY provenance input");
    if (input.observedAt !== undefined && (!ISO_DATE.test(input.observedAt) || !Number.isFinite(Date.parse(input.observedAt)))) throw new Error("invalid LIVE_READY observedAt");
  }
  for (const incident of snapshot.incidents) {
    safeText(incident.code, "incident.code", 128);
    if (!["WARNING", "CRITICAL"].includes(incident.severity)) throw new Error("invalid LIVE_READY incident severity");
    if (incident.sourceId !== undefined && !SOURCE_IDS.includes(incident.sourceId)) throw new Error("invalid LIVE_READY incident source");
    if (incident.observedAt !== undefined && (!ISO_DATE.test(incident.observedAt) || !Number.isFinite(Date.parse(incident.observedAt)))) throw new Error("invalid LIVE_READY incident time");
  }
  for (const entry of snapshot.timeline) {
    if (!SOURCE_IDS.includes(entry.sourceId) || !FRESHNESS.has(entry.freshness)) throw new Error("invalid LIVE_READY timeline entry");
    if (entry.observedAt !== undefined && (!ISO_DATE.test(entry.observedAt) || !Number.isFinite(Date.parse(entry.observedAt)))) throw new Error("invalid LIVE_READY timeline time");
  }
  if (!ISO_DATE.test(snapshot.lastRefresh) || !Number.isFinite(Date.parse(snapshot.lastRefresh))) throw new Error("invalid LIVE_READY last refresh");
  assertSafeObject(snapshot);
  return Object.freeze(structuredClone(snapshot));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
