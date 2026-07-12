export type RecoveryScenario = "SQLITE_CORRUPTION" | "SNAPSHOT_CORRUPTION" | "RUNTIME_CRASH" | "EVENT_LOG_GAP";
export type RecoveryStatus = "READY" | "BLOCKED";

export interface RecoveryEvidence {
  readonly backupAvailable: boolean;
  readonly integrityCheckPassed: boolean;
  readonly replayAvailable: boolean;
  readonly ownerApproved: boolean;
}

export interface RecoveryPlan {
  readonly scenario: RecoveryScenario;
  readonly status: RecoveryStatus;
  readonly steps: readonly string[];
  readonly blockers: readonly string[];
  readonly paperResumeAllowed: boolean;
}

const freeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
};

export function buildRecoveryPlan(scenario: RecoveryScenario, evidence: RecoveryEvidence): RecoveryPlan {
  const blockers: string[] = [];
  if (!evidence.backupAvailable) blockers.push("Verified backup is unavailable");
  if (!evidence.integrityCheckPassed) blockers.push("Integrity check has not passed");
  if (!evidence.replayAvailable) blockers.push("Replay evidence is unavailable");
  if (!evidence.ownerApproved) blockers.push("Owner approval is missing");

  const steps = [
    "Keep Kill Switch active and stop new Paper work",
    "Preserve database, snapshots, recorder events and logs",
    "Restore only from a verified backup into an isolated location",
    "Run quick_check/integrity_check and schema verification",
    "Replay the affected runtime window and reconcile snapshots",
    "Resume Paper operation only after owner approval"
  ];

  return freeze({
    scenario,
    status: blockers.length === 0 ? "READY" : "BLOCKED",
    steps,
    blockers,
    paperResumeAllowed: blockers.length === 0
  });
}
