import { type AgentContextSnapshot, type AgentEvidence } from "../../../../packages/contracts/src/multiAgentGovernance";
import { aiSha256 } from "../../../../packages/contracts/src/aiInference";
import { createAgentContextSnapshot, createAgentEvidence } from "../multiAgentGovernance";

export interface EvidenceBundleInput {
  readonly contextSnapshotId: string;
  readonly agentId: string;
  readonly evidence: readonly AgentEvidence[];
  readonly allowedEvidenceClasses: readonly string[];
  readonly evaluatedAt: number;
  readonly validUntil: number;
  readonly policyVersionIds: readonly string[];
  readonly certificationIds: readonly string[];
  readonly controlPlaneStateId: string;
}

export interface EvidenceBundle {
  readonly context: AgentContextSnapshot;
  readonly evidence: readonly AgentEvidence[];
  readonly evidenceBundleHash: string;
  readonly inputHash: string;
}

const sensitive = /api[_-]?key|secret|password|credential|bearer|access[_-]?token|private[_-]?key/i;

export function buildEvidenceBundle(input: EvidenceBundleInput): EvidenceBundle {
  if (!Number.isSafeInteger(input.evaluatedAt) || !Number.isSafeInteger(input.validUntil) || input.validUntil <= input.evaluatedAt) throw new Error("AI evidence context window is invalid");
  const allowed = new Set(input.allowedEvidenceClasses);
  const selected = input.evidence.filter((item) => allowed.has(item.evidenceType)).map(createAgentEvidence).filter((item) => item.quality === "verified" && (item.validUntil == null || item.validUntil > input.evaluatedAt));
  if (selected.length === 0) throw new Error("AI evidence bundle is empty");
  if (selected.some((item) => sensitive.test(item.sourceReference) || sensitive.test(item.evidenceId))) throw new Error("AI evidence contains prohibited credential material");
  const context = createAgentContextSnapshot({ contextSnapshotId: input.contextSnapshotId, agentId: input.agentId, evidenceIds: selected.map((item) => item.evidenceId), policyVersionIds: input.policyVersionIds, certificationIds: input.certificationIds, controlPlaneStateId: input.controlPlaneStateId, createdAt: input.evaluatedAt, validUntil: input.validUntil });
  const evidenceBundleHash = aiSha256(selected);
  const inputHash = aiSha256({ contextHash: context.contextHash, evidenceBundleHash, evidenceIds: selected.map((item) => item.evidenceId).sort() });
  return Object.freeze({ context, evidence: Object.freeze(selected), evidenceBundleHash, inputHash });
}
