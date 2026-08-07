export const ARCHITECTURE_CHANGE_STAGES = Object.freeze([
  "PROPOSAL",
  "IMPACT_ANALYSIS",
  "ARCHITECTURE_REVIEW",
  "MIGRATION_PLAN",
  "APPROVAL",
  "STAGED_ADOPTION",
  "VERIFICATION",
  "ROLLBACK"
] as const);

export type ArchitectureChangeStage = (typeof ARCHITECTURE_CHANGE_STAGES)[number];
export type LifecycleSectionStatus = "PENDING" | "COMPLETE" | "APPROVED" | "PASS" | "READY" | "FAILED" | "REJECTED";

export interface ArchitectureChangeHistoryEntry {
  readonly stage: ArchitectureChangeStage;
  readonly status: LifecycleSectionStatus;
  readonly observedAt: string;
  readonly evidenceRefs?: readonly string[];
}

export interface ArchitectureImpactAnalysis {
  readonly status: LifecycleSectionStatus;
  readonly affectedPaths: readonly string[];
  readonly affectedCapabilities: readonly string[];
  readonly safetySensitive: boolean;
  readonly constitutionalChange: boolean;
  readonly protectedBoundaries: readonly string[];
  readonly analysis: string;
}

export interface ArchitectureApproval {
  readonly status: LifecycleSectionStatus;
  readonly authorityType: "HUMAN" | "GOVERNANCE";
  readonly approvedBy: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface ArchitectureChangeRecord {
  readonly version: 1;
  readonly id: string;
  readonly title: string;
  readonly stage: ArchitectureChangeStage;
  readonly proposal: { readonly status: LifecycleSectionStatus; readonly summary: string };
  readonly impactAnalysis: ArchitectureImpactAnalysis;
  readonly architectureReview: { readonly status: LifecycleSectionStatus; readonly decision: "APPROVED" | "REJECTED" | "PENDING"; readonly reviewers: readonly string[]; readonly evidenceRefs: readonly string[] };
  readonly migrationPlan: { readonly status: LifecycleSectionStatus; readonly compatibility: string; readonly steps: readonly string[] };
  readonly approval: ArchitectureApproval;
  readonly stagedAdoption: { readonly status: LifecycleSectionStatus; readonly stages: readonly string[] };
  readonly verification: { readonly status: LifecycleSectionStatus; readonly criteria: readonly string[]; readonly evidenceRefs: readonly string[] };
  readonly rollback: { readonly status: LifecycleSectionStatus; readonly triggers: readonly string[]; readonly procedure: readonly string[] };
  readonly history: readonly ArchitectureChangeHistoryEntry[];
}
