import type { DisasterRecoveryResult } from "./disaster-recovery";
import type { StartupConsistencyResult } from "./startup-consistency-gate";

export interface RecoveryEvidenceRepository {
  appendRecovery(result: DisasterRecoveryResult): void;
  getRecovery(runId: string): DisasterRecoveryResult | undefined;
  appendStartup(input: { readonly auditId: string; readonly recoveryRunId: string; readonly result: StartupConsistencyResult; readonly evaluatedAtMs: number }): void;
  getStartup(auditId: string): { readonly auditId: string; readonly recoveryRunId: string; readonly result: StartupConsistencyResult; readonly evaluatedAtMs: number } | undefined;
}

export class InMemoryRecoveryEvidenceRepository implements RecoveryEvidenceRepository {
  private readonly recoveries = new Map<string, DisasterRecoveryResult>();
  private readonly startups = new Map<string, { readonly auditId: string; readonly recoveryRunId: string; readonly result: StartupConsistencyResult; readonly evaluatedAtMs: number }>();
  appendRecovery(result: DisasterRecoveryResult): void {
    if (this.recoveries.has(result.runId)) throw new Error("recovery run already exists");
    this.recoveries.set(result.runId, Object.freeze({ ...result, domains: Object.freeze([...result.domains]), blockingDomains: Object.freeze([...result.blockingDomains]) }));
  }
  getRecovery(runId: string): DisasterRecoveryResult | undefined { return this.recoveries.get(runId); }
  appendStartup(input: { readonly auditId: string; readonly recoveryRunId: string; readonly result: StartupConsistencyResult; readonly evaluatedAtMs: number }): void {
    if (!input.auditId.trim() || !input.recoveryRunId.trim() || !Number.isSafeInteger(input.evaluatedAtMs) || input.evaluatedAtMs < 0) throw new Error("valid startup audit identity and time are required");
    if (this.startups.has(input.auditId)) throw new Error("startup audit already exists");
    if (!this.recoveries.has(input.recoveryRunId)) throw new Error("referenced recovery evidence does not exist");
    this.startups.set(input.auditId, Object.freeze({ ...input, result: Object.freeze({ ...input.result, blockers: Object.freeze([...input.result.blockers]) }) }));
  }
  getStartup(auditId: string) { return this.startups.get(auditId); }
}
