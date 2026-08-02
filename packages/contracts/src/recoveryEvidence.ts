import type { DisasterRecoveryResult, StartupConsistencyResult } from "./recovery";

export interface RecoveryEvidenceRepository {
  appendRecovery(result: DisasterRecoveryResult): void;
  getRecovery(runId: string): DisasterRecoveryResult | undefined;
  appendStartup(input: { readonly auditId: string; readonly recoveryRunId: string; readonly result: StartupConsistencyResult; readonly evaluatedAtMs: number }): void;
  getStartup(auditId: string): { readonly auditId: string; readonly recoveryRunId: string; readonly result: StartupConsistencyResult; readonly evaluatedAtMs: number } | undefined;
}
