export type RunbookSeverity = "INFO" | "WARNING" | "CRITICAL";

export interface OperatorRunbookStep {
  readonly order: number;
  readonly action: string;
  readonly requiresOwnerApproval: boolean;
  readonly expectedEvidence: string;
}

export interface OperatorRunbook {
  readonly incidentType: string;
  readonly severity: RunbookSeverity;
  readonly steps: readonly OperatorRunbookStep[];
  readonly automaticExecutionAllowed: false;
}

const freeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
};

export function buildOperatorRunbook(incidentType: string, severity: RunbookSeverity): OperatorRunbook {
  if (!incidentType.trim()) throw new Error("incidentType is required");
  const common: OperatorRunbookStep[] = [
    { order: 1, action: "Confirm PAPER/DRY_RUN mode and Kill Switch state", requiresOwnerApproval: false, expectedEvidence: "runtime mode and Kill Switch snapshot" },
    { order: 2, action: "Freeze new runtime work and preserve current evidence", requiresOwnerApproval: false, expectedEvidence: "runtime recorder and snapshot export" },
    { order: 3, action: "Generate replay and incident report", requiresOwnerApproval: false, expectedEvidence: "replay timeline and incident report" },
    { order: 4, action: "Execute the supported recovery procedure", requiresOwnerApproval: true, expectedEvidence: "recovery checklist and integrity result" },
    { order: 5, action: "Resume Paper operation only after owner review", requiresOwnerApproval: true, expectedEvidence: "owner approval and healthy runtime report" }
  ];
  return freeze({ incidentType: incidentType.trim(), severity, steps: common, automaticExecutionAllowed: false as const });
}
