import { createHash } from "node:crypto";
import type { RemediationProposal } from "./improvementTypes";
import type { RemediationPriorityItem } from "./remediationPrioritization";

export type RemediationReadinessStatus = "READY_FOR_HUMAN_REVIEW" | "NOT_READY" | "REJECTED";
/**
 * Every code here MUST be reachable by the assessor. Advertising a gate that never fires reads
 * as coverage that does not exist, which is worse than not declaring it -- see the reachability
 * assertion in tests/remediation-readiness.test.js.
 */
export type RemediationReadinessReason =
  | "NOT_PRIORITIZED" | "PROPOSAL_MISSING" | "PROPOSAL_MISMATCH" | "DEPENDENCY_UNMET"
  | "BLAST_RADIUS_UNBOUNDED" | "ROLLBACK_INCOMPLETE" | "VERIFICATION_INCOMPLETE"
  | "PROTECTED_SURFACE" | "HUMAN_APPROVAL_REQUIRED" | "MALFORMED" | "BOUND_EXCEEDED"
  | "DUPLICATE_CONFLICT";

export interface RemediationReadinessItem {
  readonly id: string;
  readonly proposalId: string;
  readonly status: RemediationReadinessStatus;
  readonly priorityRank: number;
  readonly dependencies: readonly string[];
  readonly prerequisites: readonly string[];
  readonly blastRadius: "BOUNDED" | "UNBOUNDED";
  readonly rollbackComplete: boolean;
  readonly verificationComplete: boolean;
  readonly reasonCodes: readonly RemediationReadinessReason[];
  readonly provenanceFingerprint: string;
  readonly advisoryOnly: true;
  readonly executable: false;
  readonly requiresHumanApproval: true;
}

export interface RemediationReadinessContext {
  readonly proposals: readonly RemediationProposal[];
  readonly satisfiedDependencies?: readonly string[];
  readonly prerequisites?: Readonly<Record<string, readonly string[]>>;
  readonly dependencies?: Readonly<Record<string, readonly string[]>>;
  readonly maxItems?: number;
}

export interface RemediationReadinessQueue {
  readonly mode: "ADVISORY";
  readonly readOnly: true;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly items: readonly RemediationReadinessItem[];
  readonly readyForHumanReview: readonly RemediationReadinessItem[];
  readonly failClosed: boolean;
  readonly canonicalHash: string;
}

const MAX_ITEMS = 64;
const PROTECTED = /(^|[^a-z])(live|real|broker|order|credential|secret|production|withdraw|transfer)([^a-z]|$)/i;
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
function stable(v: unknown): string { if (v === null || typeof v !== "object") return JSON.stringify(v); if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`; const r=v as Record<string,unknown>; return `{${Object.keys(r).sort().map(k=>`${JSON.stringify(k)}:${stable(r[k])}`).join(",")}}`; }
function hash(v: unknown): string { return createHash("sha256").update(stable(v)).digest("hex"); }
function uniq(v: readonly string[] = []): string[] { return [...new Set(v)].sort(); }

function rejected(proposalId: string, rank: number, reasons: readonly RemediationReadinessReason[]): RemediationReadinessItem {
  const reasonCodes = Object.freeze(uniq(reasons) as RemediationReadinessReason[]);
  const provenanceFingerprint = hash({ proposalId, rank, reasonCodes });
  return Object.freeze({ id:`remediation-readiness:${provenanceFingerprint}`, proposalId, status:"REJECTED", priorityRank:rank, dependencies:Object.freeze([]), prerequisites:Object.freeze([]), blastRadius:"UNBOUNDED", rollbackComplete:false, verificationComplete:false, reasonCodes, provenanceFingerprint, advisoryOnly:true, executable:false, requiresHumanApproval:true });
}

function failClosedQueue(reason: RemediationReadinessReason): RemediationReadinessQueue {
  const items=Object.freeze([rejected("unknown", Number.MAX_SAFE_INTEGER, [reason])]);
  return Object.freeze({ mode:"ADVISORY", readOnly:true, liveAuthority:"NONE", productionMutationAllowed:false, aiAuthority:"ZERO_AUTHORITY", items, readyForHumanReview:Object.freeze([]), failClosed:true, canonicalHash:hash(items) });
}

function assessRemediationReadinessInternal(prioritized: readonly RemediationPriorityItem[], context: RemediationReadinessContext): RemediationReadinessQueue {
  const maxItems=context?.maxItems ?? 16;
  if (!Array.isArray(prioritized) || !Array.isArray(context?.proposals) || !Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > MAX_ITEMS || prioritized.length > MAX_ITEMS || context.proposals.length > MAX_ITEMS) return failClosedQueue("BOUND_EXCEEDED");
  // A structurally unusable entry is rejected before any field is read off it. Without this a
  // null entry throws a TypeError out of a module whose whole contract is to fail closed.
  if (prioritized.some(p=>p == null || typeof p !== "object" || !nonEmpty((p as Partial<RemediationPriorityItem>).proposalId))) return failClosedQueue("MALFORMED");
  // Identical duplicates collapse (idempotency); two records that disagree about the same
  // canonical identity fail the whole queue closed, because silently keeping one of two
  // contradictory readiness records would advertise a human-review decision nothing supports.
  // Mirrors the duplicate handling already established in remediationPrioritization.ts.
  const canonicalById=new Map<string,string>();
  for (const priority of prioritized) {
    const serialized=stable(priority);
    const prior=canonicalById.get(priority.proposalId);
    if (prior !== undefined && prior !== serialized) return failClosedQueue("DUPLICATE_CONFLICT");
    if (prior === undefined) canonicalById.set(priority.proposalId, serialized);
  }
  const deduplicated=[...new Map(prioritized.map(p=>[p.proposalId,p])).values()];
  const proposalMap=new Map(context.proposals.map(p=>[p.id,p]));
  const satisfied=new Set(uniq(context.satisfiedDependencies));
  const items=deduplicated.slice().sort((a,b)=>(a.rank ?? Number.MAX_SAFE_INTEGER)-(b.rank ?? Number.MAX_SAFE_INTEGER)||a.proposalId.localeCompare(b.proposalId)).map((priority): RemediationReadinessItem => {
    const rank=priority.rank ?? Number.MAX_SAFE_INTEGER;
    if (priority.status !== "PRIORITIZED" || priority.executable !== false || priority.advisoryOnly !== true || priority.rank == null) return rejected(priority.proposalId, rank, ["NOT_PRIORITIZED"]);
    const proposal=proposalMap.get(priority.proposalId);
    if (!proposal) return rejected(priority.proposalId, rank, ["PROPOSAL_MISSING"]);
    if (proposal.id !== priority.proposalId || !nonEmpty(proposal.candidateFingerprint)) return rejected(priority.proposalId, rank, ["PROPOSAL_MISMATCH"]);
    const dependencies=uniq(context.dependencies?.[proposal.id]);
    const prerequisites=uniq(context.prerequisites?.[proposal.id]);
    const reasons: RemediationReadinessReason[]=[];
    if (dependencies.some(d=>!satisfied.has(d))) reasons.push("DEPENDENCY_UNMET");
    const protectedSurface=PROTECTED.test(proposal.changeSurface) || PROTECTED.test(proposal.title);
    if (protectedSurface) reasons.push("PROTECTED_SURFACE");
    const blastRadius = protectedSurface || proposal.changeSurface === "UNKNOWN" ? "UNBOUNDED" : "BOUNDED";
    if (blastRadius === "UNBOUNDED") reasons.push("BLAST_RADIUS_UNBOUNDED");
    const rollbackComplete=proposal.reversible === true && nonEmpty(proposal.reversibilityPlan);
    if (!rollbackComplete) reasons.push("ROLLBACK_INCOMPLETE");
    const verificationComplete=Array.isArray(proposal.verificationPlan) && proposal.verificationPlan.length > 0 && proposal.verificationPlan.every(nonEmpty);
    if (!verificationComplete) reasons.push("VERIFICATION_INCOMPLETE");
    reasons.push("HUMAN_APPROVAL_REQUIRED");
    const reasonCodes=Object.freeze(uniq(reasons) as RemediationReadinessReason[]);
    const status: RemediationReadinessStatus = reasons.some(r=>r!=="HUMAN_APPROVAL_REQUIRED") ? "NOT_READY" : "READY_FOR_HUMAN_REVIEW";
    const provenanceFingerprint=hash({ priority:priority.evaluationFingerprint, proposalId:proposal.id, dependencies, prerequisites, blastRadius, rollbackComplete, verificationComplete, reasonCodes });
    return Object.freeze({ id:`remediation-readiness:${provenanceFingerprint}`, proposalId:proposal.id, status, priorityRank:rank, dependencies:Object.freeze(dependencies), prerequisites:Object.freeze(prerequisites), blastRadius, rollbackComplete, verificationComplete, reasonCodes, provenanceFingerprint, advisoryOnly:true, executable:false, requiresHumanApproval:true });
  });
  const bounded=Object.freeze(items.slice(0,maxItems));
  const ready=Object.freeze(bounded.filter(i=>i.status === "READY_FOR_HUMAN_REVIEW"));
  const failClosed=bounded.some(i=>i.status !== "READY_FOR_HUMAN_REVIEW");
  return Object.freeze({ mode:"ADVISORY", readOnly:true, liveAuthority:"NONE", productionMutationAllowed:false, aiAuthority:"ZERO_AUTHORITY", items:bounded, readyForHumanReview:ready, failClosed, canonicalHash:hash(bounded) });
}

/**
 * Converts verified+prioritized remediation into a deterministic, non-executable human-review
 * readiness queue. Any unexpected throw becomes a fail-closed queue rather than propagating:
 * an advisory assessor that crashes gives its caller no verdict at all, which is the one
 * outcome a fail-closed contract must never produce.
 */
export function assessRemediationReadiness(prioritized: readonly RemediationPriorityItem[], context: RemediationReadinessContext): RemediationReadinessQueue {
  try {
    return assessRemediationReadinessInternal(prioritized, context);
  } catch {
    return failClosedQueue("MALFORMED");
  }
}
