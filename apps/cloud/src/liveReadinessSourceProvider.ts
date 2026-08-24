import { createHash } from "node:crypto";
import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import {
  createDormantLiveAuthority,
  type LiveAuthorityState,
  type LiveRiskLimits,
  type LiveRuntimeSafetyState,
} from "./liveReadinessGate";
import {
  type EvidenceHealth,
  type ExactHeadWorkflowEvidence,
  type LiveActivationLeaseState,
  type LiveActivationState,
  type LiveReadinessFreshness,
  type LiveReadinessSourceId,
  type LiveReadinessSourceProvenanceInput,
  type LiveReadinessSourceSnapshot,
  type RealAccountMonitorHealth,
} from "./liveReadinessEvidence";

export interface LiveReadinessSourceObservation<T> {
  readonly value: T;
  readonly freshness: LiveReadinessFreshness;
  readonly observedAt?: string;
  /** A safe, non-secret source reference supplied by the canonical source. */
  readonly fingerprint?: string;
}

export interface LiveReadinessSourceReaders {
  readonly currentHeadSha?: () => string;
  readonly paperAutoLearning?: () => LiveReadinessSourceObservation<"STABLE" | "UNSTABLE" | "UNKNOWN">;
  readonly shadowReplay?: () => LiveReadinessSourceObservation<"VALID" | "INVALID" | "MISSING">;
  readonly realAccountMonitor?: () => LiveReadinessSourceObservation<RealAccountMonitorHealth>;
  readonly governance?: () => LiveReadinessSourceObservation<"APPROVED" | "REJECTED" | "UNKNOWN">;
  readonly tradePermission?: () => LiveReadinessSourceObservation<"PERMIT" | "REJECT" | "UNKNOWN">;
  readonly riskAuthority?: () => LiveReadinessSourceObservation<"HEALTHY" | "HALTED" | "UNKNOWN">;
  readonly reconciliationTests?: () => LiveReadinessSourceObservation<EvidenceHealth>;
  readonly killSwitchTests?: () => LiveReadinessSourceObservation<EvidenceHealth>;
  readonly idempotencyTests?: () => LiveReadinessSourceObservation<EvidenceHealth>;
  readonly exchangeFaultTests?: () => LiveReadinessSourceObservation<EvidenceHealth>;
  readonly workflows?: () => LiveReadinessSourceObservation<ExactHeadWorkflowEvidence>;
  readonly prohibitedFinancialMutationScan?: () => LiveReadinessSourceObservation<"ABSENT" | "PRESENT" | "UNKNOWN">;
  readonly environmentFingerprint?: () => LiveReadinessSourceObservation<string>;
  readonly accountFingerprint?: () => LiveReadinessSourceObservation<string>;
  readonly riskLimits?: () => LiveReadinessSourceObservation<LiveRiskLimits | undefined>;
  readonly runtimeSafety?: () => LiveReadinessSourceObservation<LiveRuntimeSafetyState>;
  readonly authority?: () => LiveReadinessSourceObservation<LiveAuthorityState>;
  readonly activationState?: () => LiveReadinessSourceObservation<LiveActivationState>;
  readonly activationLeaseState?: () => LiveReadinessSourceObservation<LiveActivationLeaseState>;
}

export interface LiveReadinessSourceProviderOptions {
  readonly now: () => string;
  readonly sourceVersion: string;
  readonly readers?: LiveReadinessSourceReaders;
}

export interface LiveReadinessProductionSourceSnapshot extends LiveReadinessSourceSnapshot {
  readonly freshness: Readonly<Record<LiveReadinessSourceId, LiveReadinessFreshness>>;
  readonly provenance: NonNullable<LiveReadinessSourceSnapshot["provenance"]>;
  readonly authority: LiveAuthorityState;
  readonly runtimeSafety: LiveRuntimeSafetyState;
  readonly activationState: LiveActivationState;
  readonly activationLeaseState: LiveActivationLeaseState;
}

export interface LiveReadinessSourceProvider {
  getSnapshot(): LiveReadinessProductionSourceSnapshot;
}

const FORBIDDEN = /(authorization|bearer|token|secret|password|api[_-]?key|access[_-]?key|private[_-]?key|cookie|jwt|nonce|signature|account[_-]?id|order[_-]?id|fill[_-]?id)/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FRESHNESS = new Set<LiveReadinessFreshness>(["FRESH", "STALE", "UNKNOWN"]);
const EVIDENCE_HEALTH = new Set<EvidenceHealth>(["PASS", "FAIL", "UNKNOWN"]);
const REAL_ACCOUNT_HEALTH = new Set<RealAccountMonitorHealth>(["CONNECTED", "STALE", "AUTH_ERROR", "RELAY_ERROR", "OFFLINE", "UNKNOWN"]);
const ACTIVATION_STATES = new Set<LiveActivationState>(["NOT_CONFIGURED", "PENDING", "READY_FOR_MANUAL_ENABLE", "ENABLED", "HALTED", "UNKNOWN"]);
const LEASE_STATES = new Set<LiveActivationLeaseState>(["ABSENT", "VALID", "EXPIRED", "UNKNOWN"]);

const unknownObservation = <T>(value: T): LiveReadinessSourceObservation<T> => Object.freeze({ value, freshness: "UNKNOWN" as const });

function safeText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256 || FORBIDDEN.test(trimmed)) return fallback;
  return trimmed;
}

function safeIso(value: unknown): string | undefined {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

function normalizeObservation<T>(value: unknown, fallback: T): LiveReadinessSourceObservation<T> {
  if (value == null || typeof value !== "object") return unknownObservation(fallback);
  const raw = value as Record<string, unknown>;
  const freshness = FRESHNESS.has(raw.freshness as LiveReadinessFreshness) ? raw.freshness as LiveReadinessFreshness : "UNKNOWN";
  const observedAt = safeIso(raw.observedAt);
  const fingerprint = raw.fingerprint === undefined ? undefined : safeText(raw.fingerprint, "");
  return Object.freeze({ value: raw.value as T, freshness, ...(observedAt === undefined ? {} : { observedAt }), ...(fingerprint ? { fingerprint } : {}) });
}

function read<T>(reader: (() => LiveReadinessSourceObservation<T>) | undefined, fallback: T): LiveReadinessSourceObservation<T> {
  if (reader == null) return unknownObservation(fallback);
  try { return normalizeObservation(reader(), fallback); } catch { return unknownObservation(fallback); }
}

function enumRead<T extends string>(reader: (() => LiveReadinessSourceObservation<T>) | undefined, allowed: ReadonlySet<T>, fallback: T): LiveReadinessSourceObservation<T> {
  const observation = read(reader, fallback);
  return allowed.has(observation.value) ? observation : unknownObservation(fallback);
}

function healthRead(reader: (() => LiveReadinessSourceObservation<EvidenceHealth>) | undefined): LiveReadinessSourceObservation<EvidenceHealth> {
  return enumRead(reader, EVIDENCE_HEALTH, "UNKNOWN");
}

function realAccountRead(reader: (() => LiveReadinessSourceObservation<RealAccountMonitorHealth>) | undefined): LiveReadinessSourceObservation<RealAccountMonitorHealth> {
  return enumRead(reader, REAL_ACCOUNT_HEALTH, "UNKNOWN");
}

function isSafeRiskLimits(value: unknown): value is LiveRiskLimits {
  if (value == null || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return ["maxNotionalPerOrder", "maxDailyLoss", "maxOpenExposure", "maxSlippageBps"].every((key) => typeof raw[key] === "number" && Number.isFinite(raw[key]))
    && Number.isSafeInteger(raw.maxConcurrentPositions) && Number(raw.maxConcurrentPositions) > 0
    && Number.isSafeInteger(raw.maxOrdersPerMinute) && Number(raw.maxOrdersPerMinute) > 0
    && Array.isArray(raw.marketAllowlist) && raw.marketAllowlist.every((market) => typeof market === "string" && /^[A-Z0-9]+-[A-Z0-9]+$/.test(market));
}

function normalizeWorkflows(value: unknown): ExactHeadWorkflowEvidence {
  if (value == null || typeof value !== "object") return { headSha: "", ci: "UNKNOWN", mobileNative: "UNKNOWN", restrictedLiveSafety: "UNKNOWN", readOnlyBroker: "UNKNOWN", aiZeroAuthority: "UNKNOWN" };
  const raw = value as Record<string, unknown>;
  const health = (entry: unknown): EvidenceHealth => EVIDENCE_HEALTH.has(entry as EvidenceHealth) ? entry as EvidenceHealth : "UNKNOWN";
  return Object.freeze({ headSha: safeText(raw.headSha, ""), ci: health(raw.ci), mobileNative: health(raw.mobileNative), restrictedLiveSafety: health(raw.restrictedLiveSafety), readOnlyBroker: health(raw.readOnlyBroker), aiZeroAuthority: health(raw.aiZeroAuthority) });
}

function normalizeRuntimeSafety(observation: LiveReadinessSourceObservation<LiveRuntimeSafetyState>): LiveReadinessSourceObservation<LiveRuntimeSafetyState> {
  const value = observation.value;
  const requiredKeys: readonly (keyof LiveRuntimeSafetyState)[] = [
    "killSwitchActive", "staleMarketData", "reconciliationMismatch", "exchangeError",
    "abnormalBalanceDrift", "riskBudgetBreached", "strategyInvalidated", "latencyOrSlippageBreached",
  ];
  if (value == null || typeof value !== "object" || !requiredKeys.every((key) => typeof (value as unknown as Record<string, unknown>)[key] === "boolean")) return unknownObservation(unknownRuntimeSafety());
  const normalized = value as LiveRuntimeSafetyState;
  return Object.freeze({
    ...observation,
    value: Object.freeze({
      killSwitchActive: normalized.killSwitchActive,
      staleMarketData: normalized.staleMarketData,
      reconciliationMismatch: normalized.reconciliationMismatch,
      exchangeError: normalized.exchangeError,
      abnormalBalanceDrift: normalized.abnormalBalanceDrift,
      riskBudgetBreached: normalized.riskBudgetBreached,
      strategyInvalidated: normalized.strategyInvalidated,
      latencyOrSlippageBreached: normalized.latencyOrSlippageBreached,
    }),
  });
}

function validateAuthority(authority: LiveAuthorityState): LiveAuthorityState {
  if (authority.liveAuthority !== "NONE" || authority.productionMutationAllowed !== false) throw new Error("live readiness source observed unexpected LIVE authority");
  if (authority.activationLease !== undefined) throw new Error("live readiness source cannot ingest an activation lease");
  return createDormantLiveAuthority();
}

function unknownRuntimeSafety(): LiveRuntimeSafetyState {
  return Object.freeze({ killSwitchActive: false, staleMarketData: false, reconciliationMismatch: false, exchangeError: false, abnormalBalanceDrift: false, riskBudgetBreached: false, strategyInvalidated: false, latencyOrSlippageBreached: false });
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalResearchJson(value === undefined ? null : value), "utf8").digest("hex");
}

function buildInput(sourceId: LiveReadinessSourceId, observation: LiveReadinessSourceObservation<unknown>, normalizedValue: unknown): LiveReadinessSourceProvenanceInput {
  return Object.freeze({ sourceId, fingerprint: safeText(observation.fingerprint, "") || fingerprint(normalizedValue), ...(observation.observedAt === undefined ? {} : { observedAt: observation.observedAt }), freshness: observation.freshness });
}

export function createLiveReadinessSourceProvider(options: LiveReadinessSourceProviderOptions): LiveReadinessSourceProvider {
  const readers = options.readers ?? {};
  const sourceVersion = safeText(options.sourceVersion, "unknown") || "unknown";
  return Object.freeze({
    getSnapshot(): LiveReadinessProductionSourceSnapshot {
      const generatedAt = safeIso(options.now());
      if (generatedAt === undefined) throw new Error("live readiness source clock must return an ISO timestamp");
      const currentHeadSha = safeText(readers.currentHeadSha?.(), "");
      const paper = enumRead(readers.paperAutoLearning, new Set(["STABLE", "UNSTABLE", "UNKNOWN"]), "UNKNOWN");
      const shadow = enumRead(readers.shadowReplay, new Set(["VALID", "INVALID", "MISSING"]), "MISSING");
      const real = realAccountRead(readers.realAccountMonitor);
      const governance = enumRead(readers.governance, new Set(["APPROVED", "REJECTED", "UNKNOWN"]), "UNKNOWN");
      const tradePermission = enumRead(readers.tradePermission, new Set(["PERMIT", "REJECT", "UNKNOWN"]), "UNKNOWN");
      const riskAuthority = enumRead(readers.riskAuthority, new Set(["HEALTHY", "HALTED", "UNKNOWN"]), "UNKNOWN");
      const reconciliationTests = healthRead(readers.reconciliationTests);
      const killSwitchTests = healthRead(readers.killSwitchTests);
      const idempotencyTests = healthRead(readers.idempotencyTests);
      const exchangeFaultTests = healthRead(readers.exchangeFaultTests);
      const workflowObservation = read(readers.workflows, normalizeWorkflows(undefined));
      const workflows = normalizeWorkflows(workflowObservation.value);
      const prohibited = enumRead(readers.prohibitedFinancialMutationScan, new Set(["ABSENT", "PRESENT", "UNKNOWN"]), "UNKNOWN");
      const environment = read(readers.environmentFingerprint, "");
      const account = read(readers.accountFingerprint, "");
      const riskLimitsObservation = read(readers.riskLimits, undefined);
      const riskLimits = isSafeRiskLimits(riskLimitsObservation.value) ? Object.freeze({ ...riskLimitsObservation.value, marketAllowlist: Object.freeze([...riskLimitsObservation.value.marketAllowlist].sort()) }) : undefined;
      const runtimeObservation = normalizeRuntimeSafety(read(readers.runtimeSafety, unknownRuntimeSafety()));
      const authorityObservation = read(readers.authority, createDormantLiveAuthority());
      const authority = validateAuthority(authorityObservation.value);
      const activationState = enumRead(readers.activationState, ACTIVATION_STATES, "UNKNOWN");
      const activationLeaseState = enumRead(readers.activationLeaseState, LEASE_STATES, "UNKNOWN");
      const freshness = Object.freeze({
        currentHeadSha: currentHeadSha ? "FRESH" : "UNKNOWN",
        paperAutoLearning: paper.freshness,
        shadowReplay: shadow.freshness,
        realAccountMonitor: real.freshness,
        governance: governance.freshness,
        tradePermission: tradePermission.freshness,
        riskAuthority: riskAuthority.freshness,
        reconciliationTests: reconciliationTests.freshness,
        killSwitchTests: killSwitchTests.freshness,
        idempotencyTests: idempotencyTests.freshness,
        exchangeFaultTests: exchangeFaultTests.freshness,
        workflows: workflowObservation.freshness,
        prohibitedFinancialMutationScan: prohibited.freshness,
        environmentFingerprint: environment.freshness,
        accountFingerprint: account.freshness,
        riskLimits: riskLimitsObservation.freshness,
        runtimeSafety: runtimeObservation.freshness,
        authority: authorityObservation.freshness,
        activationState: activationState.freshness,
        activationLeaseState: activationLeaseState.freshness,
      } satisfies Readonly<Record<LiveReadinessSourceId, LiveReadinessFreshness>>);
      const normalized = {
        currentHeadSha, paperAutoLearning: paper.value, shadowReplay: shadow.value, realAccountMonitor: real.value,
        governance: governance.value, tradePermission: tradePermission.value, riskAuthority: riskAuthority.value,
        reconciliationTests: reconciliationTests.value, killSwitchTests: killSwitchTests.value, idempotencyTests: idempotencyTests.value,
        exchangeFaultTests: exchangeFaultTests.value, workflows, prohibitedFinancialMutationScan: prohibited.value,
        environmentFingerprint: safeText(environment.value, ""), accountFingerprint: safeText(account.value, ""), riskLimits,
        activationState: activationState.value, activationLeaseState: activationLeaseState.value,
      } as const;
      const inputs = Object.freeze([
        buildInput("currentHeadSha", { value: currentHeadSha, freshness: freshness.currentHeadSha }, currentHeadSha),
        buildInput("paperAutoLearning", paper, paper.value), buildInput("shadowReplay", shadow, shadow.value), buildInput("realAccountMonitor", real, real.value),
        buildInput("governance", governance, governance.value), buildInput("tradePermission", tradePermission, tradePermission.value), buildInput("riskAuthority", riskAuthority, riskAuthority.value),
        buildInput("reconciliationTests", reconciliationTests, reconciliationTests.value), buildInput("killSwitchTests", killSwitchTests, killSwitchTests.value), buildInput("idempotencyTests", idempotencyTests, idempotencyTests.value),
        buildInput("exchangeFaultTests", exchangeFaultTests, exchangeFaultTests.value), buildInput("workflows", workflowObservation, workflows), buildInput("prohibitedFinancialMutationScan", prohibited, prohibited.value),
        buildInput("environmentFingerprint", environment, normalized.environmentFingerprint), buildInput("accountFingerprint", account, normalized.accountFingerprint), buildInput("riskLimits", riskLimitsObservation, normalized.riskLimits),
        buildInput("runtimeSafety", runtimeObservation, runtimeObservation.value), buildInput("authority", authorityObservation, authority),
        buildInput("activationState", activationState, activationState.value), buildInput("activationLeaseState", activationLeaseState, activationLeaseState.value),
      ].sort((left, right) => left.sourceId.localeCompare(right.sourceId)));
      const sourceFingerprint = fingerprint({ sourceVersion, normalized, freshness, inputs });
      return Object.freeze({
        ...normalized,
        provenance: Object.freeze({ generatedAt, sourceVersion, sourceFingerprint, inputs }),
        freshness,
        authority,
        runtimeSafety: runtimeObservation.value,
        activationState: activationState.value,
        activationLeaseState: activationLeaseState.value,
      });
    },
  });
}
