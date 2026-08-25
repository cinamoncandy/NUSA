import { accessSync, constants, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { ShadowEvidenceBusDiagnostics } from "../shadow/shadowEvidenceBus";
import type { OperationalPreflightState } from "../paper/paperOperationalPreflight";
import type { ShadowOperationalDiagnostics } from "../shadow/shadowOperationalRuntime";
import { verifyShadowEvidenceDirectory } from "../shadow/shadowEvidenceArchive";
import type { CrashRecoveryDiagnostic } from "../crashRecoveryMarker";

export interface A4MutationCounters {
  readonly broker: number;
  readonly orders: number;
  readonly fills: number;
  readonly cash: number;
  readonly position: number;
}

export interface A4RuntimeDiagnostics {
  readonly schemaVersion: 1;
  readonly generatedAt: number;
  readonly deployment: OperationalPreflightState["deployment"];
  readonly reconciliation: OperationalPreflightState["reconciliation"];
  readonly riskGate: OperationalPreflightState["riskGate"];
  readonly market: Readonly<{
    symbol: string;
    strategyId: string;
    interval: "1m";
    status: string;
    connected: boolean;
    fresh: boolean;
    lastHeartbeatAt: number | null;
    source: "UPBIT_PUBLIC_CLOSED_CANDLE";
  }>;
  readonly safety: Readonly<{
    killSwitchActive: boolean;
    openP0Count: number;
    openP0Codes: readonly string[];
    reasonCode: string | null;
    activatedAt: number | null;
    activationSource: "PERSISTED_PAPER_SAFETY_SNAPSHOT" | null;
  }>;
  readonly shadow: Readonly<{
    state: ShadowOperationalDiagnostics["state"];
    sessionId: string | null;
    recoveryRequired: boolean;
    observationStarted: boolean;
    startedAt: number | null;
    elapsedMs: number;
    queueDepth: number;
    queueHighWaterMark: number;
    duplicateCandleCount: number;
    staleCandleCount: number;
    outOfOrderCandleCount: number;
    marketConnection: ShadowOperationalDiagnostics["marketConnection"];
  }>;
  readonly evidence: Readonly<{
    rootWritable: boolean;
    markerlessArchiveCount: number;
    activeArchivePresent: boolean;
    lastVerifierResult: "PASS" | "FAIL" | "NOT_RUN" | "ERROR";
    completedMarkerPresent: boolean;
    busStatus: "OPEN" | "HALTED" | "NOT_CREATED";
    published: number;
    delivered: number;
    queueDepth: number;
    queueHighWaterMark: number;
    haltReason: string | null;
  }>;
  readonly capabilities: Readonly<{ liveTrading: false; privateApi: false; credentialStorage: false }>;
  readonly mutationCounters: A4MutationCounters;
  readonly crashRecovery: CrashRecoveryDiagnostic;
  /** Exact blockers returned by the same read-only precheck used by shadow:start. */
  readonly startPrecheckBlockers: readonly string[];
  readonly verdict: "READY_FOR_OBSERVATION" | "BLOCKED" | "ERROR";
  readonly blockers: readonly string[];
}

function canWrite(root: string): boolean {
  try {
    accessSync(root, constants.W_OK);
    return true;
  } catch {
    try { accessSync(path.dirname(root), constants.W_OK); return true; } catch { return false; }
  }
}

function markerlessCount(root: string, known: readonly string[]): number {
  if (known.length > 0) return known.length;
  try {
    return readdirSync(root, { withFileTypes: true }).filter((entry) => {
      if (!entry.isDirectory()) return false;
      const files = new Set(readdirSync(path.join(root, entry.name)));
      return !files.has("completed.marker") && !files.has("aborted.marker");
    }).length;
  } catch { return 0; }
}

function latestArchive(root: string): string | null {
  try {
    const entries = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const directory = path.join(root, entry.name);
        return { directory, mtime: statSync(directory).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    return entries[0]?.directory ?? null;
  } catch { return null; }
}

export async function buildA4RuntimeDiagnostics(input: Readonly<{
  preflight: OperationalPreflightState;
  shadow: ShadowOperationalDiagnostics;
  evidenceRoot: string;
  incompleteArchives: readonly string[];
  evidenceBus: ShadowEvidenceBusDiagnostics | null;
  mutationCounters: A4MutationCounters;
  startPrecheckBlockers: readonly string[];
  market?: Readonly<{
    connected: boolean;
    lastHeartbeatAt: number | null;
    source: "UPBIT_PUBLIC_CLOSED_CANDLE";
  }>;
  safety?: Readonly<{
    killSwitchActive: boolean;
    openP0Count: number;
    openP0Codes: readonly string[];
    reasonCode: string | null;
    activatedAt: number | null;
    activationSource: "PERSISTED_PAPER_SAFETY_SNAPSHOT" | null;
  }>;
  crashRecovery?: CrashRecoveryDiagnostic;
  generatedAt?: number;
}>): Promise<A4RuntimeDiagnostics> {
  const generatedAt = input.generatedAt ?? Date.now();
  const marketInput = input.market ?? {
    connected: input.shadow.marketDataStatus === "HEALTHY",
    lastHeartbeatAt: null,
    source: "UPBIT_PUBLIC_CLOSED_CANDLE" as const
  };
  const marketAge = marketInput.lastHeartbeatAt === null ? Number.POSITIVE_INFINITY : generatedAt - marketInput.lastHeartbeatAt;
  const market = Object.freeze({
    symbol: input.shadow.symbol,
    strategyId: input.shadow.strategyId,
    interval: "1m" as const,
    status: input.shadow.marketDataStatus,
    connected: marketInput.connected,
    fresh: marketInput.connected && Number.isFinite(marketAge) && marketAge >= 0 && marketAge <= 30_000,
    lastHeartbeatAt: marketInput.lastHeartbeatAt,
    source: marketInput.source
  });
  const safetyInput = input.safety;
  const safety = Object.freeze({
    killSwitchActive: safetyInput?.killSwitchActive ?? false,
    openP0Count: safetyInput?.openP0Count ?? 0,
    openP0Codes: Object.freeze([...(safetyInput?.openP0Codes ?? [])]),
    reasonCode: safetyInput?.reasonCode ?? null,
    activatedAt: safetyInput?.activatedAt ?? null,
    activationSource: safetyInput?.activationSource ?? null
  });
  const rootWritable = canWrite(input.evidenceRoot);
  const markerlessArchiveCount = markerlessCount(input.evidenceRoot, input.incompleteArchives);
  const activeArchivePresent = input.shadow.sessionId !== null;
  const archive = latestArchive(input.evidenceRoot);
  let lastVerifierResult: A4RuntimeDiagnostics["evidence"]["lastVerifierResult"] = "NOT_RUN";
  let completedMarkerPresent = false;
  if (archive !== null) {
    try {
      const verification = await verifyShadowEvidenceDirectory(archive, input.generatedAt ?? Date.now());
      lastVerifierResult = verification.status === "PASS" ? "PASS" : "FAIL";
      try { completedMarkerPresent = readdirSync(archive).includes("completed.marker"); } catch { /* status is already captured */ }
    } catch { lastVerifierResult = "ERROR"; }
  }
  const bus = input.evidenceBus;
  const evidence = Object.freeze({
    rootWritable,
    markerlessArchiveCount,
    activeArchivePresent,
    lastVerifierResult,
    completedMarkerPresent,
    busStatus: bus?.status ?? "NOT_CREATED",
    published: bus?.published ?? 0,
    delivered: bus?.delivered ?? 0,
    queueDepth: bus?.queueDepth ?? 0,
    queueHighWaterMark: bus?.highWaterMark ?? 0,
    haltReason: bus?.haltReason ?? null
  });
  const startBlockers = [...new Set(input.startPrecheckBlockers)];
  const blockers = new Set<string>();
  if (input.preflight.deployment.status !== "PASS") input.preflight.deployment.blockers.forEach((code) => blockers.add(code));
  if (input.preflight.reconciliation.status !== "PASS") input.preflight.reconciliation.blockers.forEach((code) => blockers.add(code));
  if (input.preflight.riskGate.status !== "PASS") input.preflight.riskGate.blockers.forEach((code) => blockers.add(code));
  if (!rootWritable) blockers.add("EVIDENCE_ROOT_UNWRITABLE");
  if (markerlessArchiveCount > 0) blockers.add("MARKERLESS_ARCHIVE_PRESENT");
  if (input.shadow.state !== "IDLE") blockers.add("SHADOW_SESSION_NOT_IDLE");
  if (input.shadow.blockers.includes("EVIDENCE_RECOVERY_REQUIRED")) blockers.add("RECOVERY_REQUIRED");
  if (input.crashRecovery?.recoveryRequired) blockers.add("RECOVERY_REQUIRED");
  if (bus?.status === "HALTED") blockers.add(`EVIDENCE_BUS_${bus.haltReason ?? "HALTED"}`);
  if (lastVerifierResult === "FAIL" || lastVerifierResult === "ERROR") blockers.add("LAST_EVIDENCE_VERIFICATION_FAILED");
  for (const [name, value] of Object.entries(input.mutationCounters)) if (value !== 0) blockers.add(`${name.toUpperCase()}_MUTATION:${value}`);
  // The start precheck is authoritative. Preserve its canonical order so the UI and
  // diagnostics cannot claim a different blocker precedence than shadow:start.
  const diagnosticBlockers = [...blockers].filter((code) => !startBlockers.includes(code)).sort();
  const orderedBlockers = Object.freeze([...startBlockers, ...diagnosticBlockers]);
  const verdict = orderedBlockers.length === 0 ? "READY_FOR_OBSERVATION" : "BLOCKED";
  return Object.freeze({
    schemaVersion: 1,
    generatedAt,
    deployment: input.preflight.deployment,
    reconciliation: input.preflight.reconciliation,
    riskGate: input.preflight.riskGate,
    market,
    safety,
    shadow: Object.freeze({
      state: input.shadow.state,
      sessionId: input.shadow.sessionId,
      recoveryRequired: input.shadow.blockers.includes("EVIDENCE_RECOVERY_REQUIRED"),
      observationStarted: input.shadow.startedAt !== null,
      startedAt: input.shadow.startedAt,
      elapsedMs: input.shadow.elapsedMs,
      queueDepth: evidence.queueDepth,
      queueHighWaterMark: evidence.queueHighWaterMark,
      duplicateCandleCount: input.shadow.duplicateCandleCount,
      staleCandleCount: input.shadow.staleCandleCount,
      outOfOrderCandleCount: input.shadow.outOfOrderCandleCount,
      marketConnection: input.shadow.marketConnection
    }),
    evidence,
    capabilities: Object.freeze({ liveTrading: false, privateApi: false, credentialStorage: false }),
    mutationCounters: Object.freeze({ ...input.mutationCounters }),
    crashRecovery: input.crashRecovery ?? Object.freeze({ runId: null, recoveryRequired: false, previousRunId: null, previousSessionId: null, previousSessionState: null, lastEvidenceId: null, detectedAt: null, cleanShutdown: false, reasonCodes: Object.freeze([]), recoveryState: null, failClosed: false }),
    startPrecheckBlockers: Object.freeze(startBlockers),
    verdict,
    blockers: orderedBlockers
  });
}
