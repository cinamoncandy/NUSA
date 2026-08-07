export interface CanonicalHandoffSnapshot {
  readonly project: string;
  readonly objective: string;
  readonly phase: string;
  readonly activeWorkOrder: {
    readonly id: string;
    readonly status: string;
    readonly path: string;
  };
  readonly verifiedState: {
    readonly workOrder: string;
    readonly status: string;
    readonly evidence: string;
  };
  readonly repository: {
    readonly baseBranch: string;
    readonly activeBranch: string;
    readonly activePullRequest: number | null;
  };
  readonly safety: {
    readonly liveTradingMutation: string;
    readonly architectureOverride: string;
    readonly priorChatDependency: string;
    readonly hiddenChainOfThoughtDependency: string;
    readonly providerPrivateContextDependency: string;
  };
  readonly blockers: readonly string[];
  readonly requiredVerification: readonly string[];
  readonly nextPermittedAction: string;
}

export interface CrossAiAdapterResult {
  readonly adapter: string;
  readonly snapshot: CanonicalHandoffSnapshot;
  readonly fingerprint: string;
}

export interface CrossAiConformanceReport {
  readonly version: 1;
  readonly result: "PASS" | "FAIL";
  readonly canonicalFingerprint?: string;
  readonly adapters: readonly CrossAiAdapterResult[];
  readonly failures: readonly string[];
}
