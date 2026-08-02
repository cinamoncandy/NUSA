export enum RecoveryStepStatus { PASS = "PASS", FAIL = "FAIL", UNKNOWN = "UNKNOWN" }
export enum DisasterRecoveryDecision { CONSISTENT = "CONSISTENT", SAFE_BLOCK = "SAFE_BLOCK" }
export interface RecoveryDomainResult { readonly domain: string; readonly status: RecoveryStepStatus; readonly checkpoint: string; readonly replayedEvents: number; readonly reason?: string; }
export interface DisasterRecoveryResult { readonly runId: string; readonly decision: DisasterRecoveryDecision; readonly domains: readonly RecoveryDomainResult[]; readonly blockingDomains: readonly string[]; readonly completedAtMs: number; }
export enum StartupGateDecision { ALLOW_RESTRICTED_START = "ALLOW_RESTRICTED_START", BLOCK_START = "BLOCK_START" }
export interface StartupConsistencyInput { readonly recovery: DisasterRecoveryResult; readonly activeRestrictionCount: number; readonly unresolvedSubmissionCount: number; readonly clockSafe: boolean; readonly websocketSynchronized: boolean; readonly migrationStateKnown: boolean; }
export interface StartupConsistencyResult { readonly decision: StartupGateDecision; readonly productionMutationAllowed: false; readonly blockers: readonly string[]; }
