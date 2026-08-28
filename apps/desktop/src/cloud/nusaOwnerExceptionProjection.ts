import type {
  NusaEngineeringExecutionEvidence,
  NusaEngineeringExecutionOrigin,
  NusaEngineeringExecutionOriginProjection,
} from "./nusaEngineeringExecutionOrigin";
import { projectNusaEngineeringExecutionOrigin } from "./nusaEngineeringExecutionOrigin";

export type EngineeringWorkOrigin = NusaEngineeringExecutionOrigin;

export type OwnerExceptionKind =
  | "HUMAN_ONLY_BLOCKER"
  | "SAFETY_AUTHORITY_DECISION"
  | "STRATEGIC_PRODUCT_CHOICE"
  | "MEANINGFUL_OUTCOME"
  | "ROUTINE_AUTONOMOUS_PROGRESS";

export type OwnerExceptionInput = {
  workId: string;
  originEvidence: NusaEngineeringExecutionEvidence | null;
  kind: OwnerExceptionKind;
  summary: string;
  evidenceRefs: readonly string[];
};

export type OwnerExceptionProjection = {
  workId: string;
  origin: EngineeringWorkOrigin | null;
  originStatus: NusaEngineeringExecutionOriginProjection["status"];
  visibleToOwner: boolean;
  priority: "EXCEPTION" | "OUTCOME" | "SUPPRESSED";
  summary: string;
  evidenceRefs: readonly string[];
  reasons: readonly string[];
};

function requireNonEmpty(name: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`OWNER_EXCEPTION_MISSING_${name}`);
  return normalized;
}

export function projectOwnerException(input: OwnerExceptionInput): OwnerExceptionProjection {
  const workId = requireNonEmpty("WORK_ID", input.workId);
  const summary = requireNonEmpty("SUMMARY", input.summary);
  const evidenceRefs = [...new Set(input.evidenceRefs.map((ref) => ref.trim()).filter(Boolean))].sort();
  const originEvidence = projectNusaEngineeringExecutionOrigin(input.originEvidence);
  const originStatus = originEvidence.status === "VERIFIED" && originEvidence.origin != null ? "VERIFIED" : "UNKNOWN";
  const origin = originStatus === "VERIFIED" ? originEvidence.origin : null;
  const originReasons = originStatus === "VERIFIED" ? [] : ["EXECUTION_ORIGIN_UNKNOWN", ...originEvidence.reasons];

  if (input.kind !== "ROUTINE_AUTONOMOUS_PROGRESS" && evidenceRefs.length === 0) {
    throw new Error("OWNER_EXCEPTION_MISSING_EVIDENCE");
  }

  if (
    input.kind === "HUMAN_ONLY_BLOCKER" ||
    input.kind === "SAFETY_AUTHORITY_DECISION" ||
    input.kind === "STRATEGIC_PRODUCT_CHOICE"
  ) {
    return {
      workId,
      origin,
      originStatus,
      visibleToOwner: true,
      priority: "EXCEPTION",
      summary,
      evidenceRefs,
      reasons: [...new Set([input.kind, ...originReasons])].sort(),
    };
  }

  if (input.kind === "MEANINGFUL_OUTCOME") {
    return {
      workId,
      origin,
      originStatus,
      visibleToOwner: true,
      priority: "OUTCOME",
      summary,
      evidenceRefs,
      reasons: [...new Set(["MEANINGFUL_OUTCOME_WITH_EVIDENCE", ...originReasons])].sort(),
    };
  }

  return {
    workId,
    origin,
    originStatus,
    visibleToOwner: false,
    priority: "SUPPRESSED",
    summary,
    evidenceRefs,
    reasons: [...new Set(["ROUTINE_AUTONOMOUS_PROGRESS_SUPPRESSED", ...originReasons])].sort(),
  };
}

export function projectOwnerExceptions(inputs: readonly OwnerExceptionInput[]): OwnerExceptionProjection[] {
  return inputs
    .map(projectOwnerException)
    .sort((left, right) => {
      const order = { EXCEPTION: 0, OUTCOME: 1, SUPPRESSED: 2 } as const;
      const priorityDelta = order[left.priority] - order[right.priority];
      if (priorityDelta !== 0) return priorityDelta;
      return left.workId.localeCompare(right.workId);
    });
}
