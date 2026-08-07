export type WorkOrderStatus = "pending" | "in_progress" | "blocked" | "completed" | "cancelled";
export type VerificationStatus = "UNVERIFIED" | "VERIFYING" | "VERIFIED" | "COMPLETED";
export type EvidenceResult = "PASS" | "FAIL";

export interface AiposState {
  readonly project: string;
  readonly phase: string;
  readonly summary: string;
  readonly updatedAt: string;
  readonly activeWorkOrderId?: string;
  readonly blockers?: readonly string[];
  readonly nextActions?: readonly string[];
}

export interface VerificationState {
  readonly workOrderId: string;
  readonly status: VerificationStatus;
  readonly evidenceId?: string;
}

export interface EvidenceHash {
  readonly algorithm: "sha256" | "git-blob-sha1";
  readonly value: string;
}

export interface AiposEvidenceRecord {
  readonly version: 1;
  readonly id: string;
  readonly subject: {
    readonly type: "work_order";
    readonly id: string;
    readonly path: string;
    readonly hash: EvidenceHash;
  };
  readonly producer: {
    readonly kind: string;
    readonly id: string;
    readonly code_revision: string;
  };
  readonly configuration: {
    readonly snapshot: Readonly<Record<string, unknown>>;
    readonly hash: EvidenceHash;
  };
  readonly observed_at: string;
  readonly provenance: readonly string[];
  readonly result: EvidenceResult;
  readonly assertions: readonly {
    readonly name: string;
    readonly status: EvidenceResult;
    readonly detail?: string;
  }[];
}

export interface WorkOrder {
  readonly id: string;
  readonly title: string;
  readonly status: WorkOrderStatus;
  readonly objective: string;
  readonly acceptanceCriteria: readonly string[];
  readonly dependencies?: readonly string[];
  readonly notes?: readonly string[];
}

export interface DecisionRecord {
  readonly id: string;
  readonly title: string;
  readonly status: "proposed" | "accepted" | "rejected" | "superseded";
  readonly context: string;
  readonly decision: string;
  readonly consequences: readonly string[];
  readonly createdAt: string;
  readonly supersedes?: string;
}

export interface RecoverySnapshot {
  readonly state: AiposState;
  readonly selectedWorkOrder?: WorkOrder;
  readonly decisions: readonly DecisionRecord[];
  readonly generatedAt: string;
}

export interface ValidationIssue {
  readonly code: string;
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly path?: string;
}

export interface ValidationReport {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}
