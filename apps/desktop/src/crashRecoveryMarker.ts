import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

export type CrashRecoveryReason =
  | "PREVIOUS_RUN_INTERRUPTED"
  | "PREVIOUS_RECONNECT_INTERRUPTED"
  | "COMPLETION_REVIEW_REQUIRED"
  | "EVIDENCE_RECONCILIATION_REQUIRED"
  | "CRASH_MARKER_MISSING"
  | "CRASH_MARKER_INVALID"
  | "CRASH_MARKER_HASH_MISMATCH";

export interface CrashMarker {
  readonly runId: string;
  readonly startedAt: number;
  readonly shutdownStartedAt: number | null;
  readonly shutdownCompletedAt: number | null;
  readonly lastKnownSessionId: string | null;
  readonly lastKnownSessionState: string | null;
  readonly lastEvidenceId: string | null;
  readonly lastMarketConnectionState: string;
  readonly cleanShutdown: boolean;
  readonly checksum: string;
}

export interface CrashRecoveryRecord {
  readonly recoveryRecordId: string;
  readonly detectedAt: number;
  readonly previousRunId: string | null;
  readonly previousSessionId: string | null;
  readonly previousSessionState: string | null;
  readonly previousEvidenceId: string | null;
  readonly reasonCodes: readonly CrashRecoveryReason[];
  readonly recoveryState: "INTERRUPTED" | "COMPLETION_REVIEW_REQUIRED" | "EVIDENCE_RECONCILIATION_REQUIRED";
  readonly status: "OPEN";
  readonly checksum: string;
}

export interface CrashRecoveryStartup {
  readonly marker: CrashMarker;
  readonly previousMarker: CrashMarker | null;
  readonly recoveryRequired: boolean;
  readonly reasonCodes: readonly CrashRecoveryReason[];
  readonly recoveryState: CrashRecoveryRecord["recoveryState"] | null;
  readonly recoveryRecordId: string | null;
  readonly detectedAt: number;
}

export interface CrashRecoveryDiagnostic {
  readonly runId: string | null;
  readonly recoveryRequired: boolean;
  readonly previousRunId: string | null;
  readonly previousSessionId: string | null;
  readonly previousSessionState: string | null;
  readonly lastEvidenceId: string | null;
  readonly detectedAt: number | null;
  readonly cleanShutdown: boolean;
  readonly reasonCodes: readonly CrashRecoveryReason[];
  readonly recoveryState: CrashRecoveryRecord["recoveryState"] | null;
  readonly failClosed: boolean;
}

type MarkerFields = Omit<CrashMarker, "checksum">;

function canonical(value: MarkerFields): string {
  return JSON.stringify({
    runId: value.runId,
    startedAt: value.startedAt,
    shutdownStartedAt: value.shutdownStartedAt,
    shutdownCompletedAt: value.shutdownCompletedAt,
    lastKnownSessionId: value.lastKnownSessionId,
    lastKnownSessionState: value.lastKnownSessionState,
    lastEvidenceId: value.lastEvidenceId,
    lastMarketConnectionState: value.lastMarketConnectionState,
    cleanShutdown: value.cleanShutdown
  });
}

function checksum(value: MarkerFields): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function markerFields(value: unknown): MarkerFields {
  if (typeof value !== "object" || value === null) throw new Error("crash marker must be an object");
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.runId !== "string" || candidate.runId.length === 0 || !validTimestamp(candidate.startedAt) ||
      (candidate.shutdownStartedAt !== null && !validTimestamp(candidate.shutdownStartedAt)) ||
      (candidate.shutdownCompletedAt !== null && !validTimestamp(candidate.shutdownCompletedAt)) ||
      (candidate.lastKnownSessionId !== null && typeof candidate.lastKnownSessionId !== "string") ||
      (candidate.lastKnownSessionState !== null && typeof candidate.lastKnownSessionState !== "string") ||
      (candidate.lastEvidenceId !== null && typeof candidate.lastEvidenceId !== "string") ||
      typeof candidate.lastMarketConnectionState !== "string" || typeof candidate.cleanShutdown !== "boolean") {
    throw new Error("crash marker fields are invalid");
  }
  return {
    runId: candidate.runId,
    startedAt: candidate.startedAt,
    shutdownStartedAt: candidate.shutdownStartedAt as number | null,
    shutdownCompletedAt: candidate.shutdownCompletedAt as number | null,
    lastKnownSessionId: candidate.lastKnownSessionId as string | null,
    lastKnownSessionState: candidate.lastKnownSessionState as string | null,
    lastEvidenceId: candidate.lastEvidenceId as string | null,
    lastMarketConnectionState: candidate.lastMarketConnectionState,
    cleanShutdown: candidate.cleanShutdown
  };
}

function decodeMarker(value: unknown): CrashMarker {
  const fields = markerFields(value);
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.checksum !== "string") throw new Error("crash marker checksum is missing");
  const expected = checksum(fields);
  if (candidate.checksum !== expected) throw new Error("crash marker checksum mismatch");
  return Object.freeze({ ...fields, checksum: expected });
}

function reasonForInterruptedMarker(marker: CrashMarker): CrashRecoveryReason {
  if (marker.lastKnownSessionState === "RECONNECTING") return "PREVIOUS_RECONNECT_INTERRUPTED";
  if (marker.lastKnownSessionState === "COMPLETING" || marker.lastKnownSessionState === "COMPLETION_PENDING") return "COMPLETION_REVIEW_REQUIRED";
  if (marker.lastKnownSessionState === "EVIDENCE_FINALIZED") return "EVIDENCE_RECONCILIATION_REQUIRED";
  return "PREVIOUS_RUN_INTERRUPTED";
}

function recoveryStateForReason(reason: CrashRecoveryReason | null): CrashRecoveryRecord["recoveryState"] | null {
  if (reason === "COMPLETION_REVIEW_REQUIRED") return "COMPLETION_REVIEW_REQUIRED";
  if (reason === "EVIDENCE_RECONCILIATION_REQUIRED") return "EVIDENCE_RECONCILIATION_REQUIRED";
  if (reason === null || reason === "CRASH_MARKER_MISSING" || reason === "CRASH_MARKER_INVALID" || reason === "CRASH_MARKER_HASH_MISMATCH") return reason === null ? null : "INTERRUPTED";
  return "INTERRUPTED";
}

export class CrashRecoveryMarkerStore {
  private current: CrashMarker | null = null;

  public constructor(private readonly markerPath: string, private readonly recoveryLogPath: string) {
    if (!markerPath || !recoveryLogPath) throw new Error("crash recovery paths are required");
  }

  public startRun(input: Readonly<{ runId?: string; startedAt: number; lastMarketConnectionState?: string }>): CrashRecoveryStartup {
    if (!validTimestamp(input.startedAt)) throw new Error("crash recovery start time is invalid");
    const detectedAt = input.startedAt;
    let previousMarker: CrashMarker | null = null;
    let reasonCodes: CrashRecoveryReason[] = [];
    if (existsSync(this.markerPath)) {
      try {
        previousMarker = decodeMarker(JSON.parse(readFileSync(this.markerPath, "utf8")));
        if (!previousMarker.cleanShutdown) reasonCodes = [reasonForInterruptedMarker(previousMarker)];
      } catch (error) {
        reasonCodes = [error instanceof Error && error.message.includes("checksum") ? "CRASH_MARKER_HASH_MISMATCH" : "CRASH_MARKER_INVALID"];
      }
    }
    // A missing marker is the expected state on first launch or after a clean
    // uninstall. It is diagnostic context, not evidence of an interrupted run.
    const recoveryRequired = reasonCodes.length > 0;
    const recoveryRecordId = recoveryRequired ? `recovery-${randomUUID()}` : null;
    if (recoveryRecordId) {
      const fields = {
        recoveryRecordId,
        detectedAt,
        previousRunId: previousMarker?.runId ?? null,
        previousSessionId: previousMarker?.lastKnownSessionId ?? null,
        previousSessionState: previousMarker?.lastKnownSessionState ?? null,
        previousEvidenceId: previousMarker?.lastEvidenceId ?? null,
        reasonCodes: Object.freeze([...reasonCodes]),
        recoveryState: recoveryStateForReason(reasonCodes[0] ?? null) ?? "INTERRUPTED",
        status: "OPEN" as const
      };
      const record = Object.freeze({ ...fields, checksum: createHash("sha256").update(JSON.stringify(fields), "utf8").digest("hex") });
      appendFileSync(this.recoveryLogPath, JSON.stringify(record) + "\n", { encoding: "utf8", flag: "a" });
    }
    const marker = this.write({
      runId: input.runId ?? `run-${randomUUID()}`,
      startedAt: input.startedAt,
      shutdownStartedAt: null,
      shutdownCompletedAt: null,
      lastKnownSessionId: null,
      lastKnownSessionState: "IDLE",
      lastEvidenceId: null,
      lastMarketConnectionState: input.lastMarketConnectionState ?? "WARMING_UP",
      cleanShutdown: false
    });
    return Object.freeze({ marker, previousMarker, recoveryRequired, reasonCodes: Object.freeze([...reasonCodes]), recoveryState: recoveryStateForReason(reasonCodes[0] ?? null), recoveryRecordId, detectedAt });
  }

  public update(input: Readonly<Partial<MarkerFields>>): CrashMarker {
    if (this.current === null) throw new Error("crash marker run has not started");
    return this.write({ ...this.fields(this.current), ...input });
  }

  public beginShutdown(input: Readonly<{ at: number; sessionId?: string | null; sessionState?: string | null; evidenceId?: string | null; marketConnectionState?: string }>): CrashMarker {
    if (!validTimestamp(input.at)) throw new Error("shutdown time is invalid");
    return this.update({ shutdownStartedAt: input.at, shutdownCompletedAt: null, cleanShutdown: false, lastKnownSessionId: input.sessionId ?? this.current?.lastKnownSessionId ?? null, lastKnownSessionState: input.sessionState ?? this.current?.lastKnownSessionState ?? null, lastEvidenceId: input.evidenceId ?? this.current?.lastEvidenceId ?? null, lastMarketConnectionState: input.marketConnectionState ?? this.current?.lastMarketConnectionState ?? "UNKNOWN" });
  }

  public completeShutdown(input: Readonly<{ at: number; sessionId?: string | null; sessionState?: string | null; evidenceId?: string | null; marketConnectionState?: string }>): CrashMarker {
    if (!validTimestamp(input.at)) throw new Error("shutdown completion time is invalid");
    return this.update({ shutdownCompletedAt: input.at, cleanShutdown: true, lastKnownSessionId: input.sessionId ?? this.current?.lastKnownSessionId ?? null, lastKnownSessionState: input.sessionState ?? this.current?.lastKnownSessionState ?? "IDLE", lastEvidenceId: input.evidenceId ?? this.current?.lastEvidenceId ?? null, lastMarketConnectionState: input.marketConnectionState ?? this.current?.lastMarketConnectionState ?? "UNKNOWN" });
  }

  public snapshot(): CrashMarker | null { return this.current; }

  public diagnostic(startup: CrashRecoveryStartup): CrashRecoveryDiagnostic {
    return Object.freeze({ runId: startup.marker.runId, recoveryRequired: startup.recoveryRequired, previousRunId: startup.previousMarker?.runId ?? null, previousSessionId: startup.previousMarker?.lastKnownSessionId ?? null, previousSessionState: startup.previousMarker?.lastKnownSessionState ?? null, lastEvidenceId: startup.previousMarker?.lastEvidenceId ?? null, detectedAt: startup.recoveryRequired ? startup.detectedAt : null, cleanShutdown: startup.marker.cleanShutdown, reasonCodes: Object.freeze([...startup.reasonCodes]), recoveryState: startup.recoveryState, failClosed: startup.recoveryRequired });
  }

  private fields(marker: CrashMarker): MarkerFields {
    const { checksum: _checksum, ...fields } = marker;
    return fields;
  }

  private write(fields: MarkerFields): CrashMarker {
    const marker = Object.freeze({ ...fields, checksum: checksum(fields) });
    mkdirSync(path.dirname(this.markerPath), { recursive: true });
    mkdirSync(path.dirname(this.recoveryLogPath), { recursive: true });
    const temporary = `${this.markerPath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(marker) + "\n", { encoding: "utf8", flag: "w" });
    renameSync(temporary, this.markerPath);
    this.current = marker;
    return marker;
  }
}
