import { type AgentContextSnapshot, type AgentEvidence } from "../../../../packages/contracts/src/multiAgentGovernance";
import { aiSha256, type AiEvidenceMaterialization } from "../../../../packages/contracts/src/aiInference";
import { createAgentContextSnapshot, createAgentEvidence } from "../multiAgentGovernance";

export interface EvidenceBundleInput {
  readonly contextSnapshotId: string;
  readonly agentId: string;
  readonly evidence: readonly AgentEvidence[];
  readonly evidenceMaterializations: readonly AiEvidenceMaterialization[];
  readonly allowedEvidenceClasses: readonly string[];
  readonly evaluatedAt: number;
  readonly validUntil: number;
  readonly policyVersionIds: readonly string[];
  readonly certificationIds: readonly string[];
  readonly controlPlaneStateId: string;
}

export interface MaterializedAgentEvidence {
  readonly evidence: AgentEvidence;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface EvidenceBundle {
  readonly context: AgentContextSnapshot;
  readonly evidence: readonly AgentEvidence[];
  readonly materializedEvidence: readonly MaterializedAgentEvidence[];
  readonly evidenceBundleHash: string;
  readonly inputHash: string;
}

const sensitiveReference = /api[_-]?key|secret|password|credential|bearer|access[_-]?token|private[_-]?key/i;
const sensitiveKey = /api[_-]?key|secret|password|credential|bearer|access[_-]?token|private[_-]?key|authorization/i;
const sensitiveValue = /^(?:bearer\s+\S+|sk-[A-Za-z0-9_-]{8,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i;

const deepFreeze = <T>(value: T): T => {
  if (value != null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

function containsSensitiveMaterial(value: unknown, key = ""): boolean {
  if (key && sensitiveKey.test(key)) return true;
  if (typeof value === "string") return sensitiveValue.test(value.trim());
  if (Array.isArray(value)) return value.some((item) => containsSensitiveMaterial(item));
  if (value != null && typeof value === "object") return Object.entries(value as Record<string, unknown>).some(([childKey, child]) => containsSensitiveMaterial(child, childKey));
  return false;
}

export function buildEvidenceBundle(input: EvidenceBundleInput): EvidenceBundle {
  if (!Number.isSafeInteger(input.evaluatedAt) || !Number.isSafeInteger(input.validUntil) || input.validUntil <= input.evaluatedAt) throw new Error("AI evidence context window is invalid");
  const allowed = new Set(input.allowedEvidenceClasses);
  const selected = input.evidence.filter((item) => allowed.has(item.evidenceType)).map(createAgentEvidence).filter((item) => item.quality === "verified" && (item.validUntil == null || item.validUntil > input.evaluatedAt)).sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  if (selected.length === 0) throw new Error("AI evidence bundle is empty");
  if (selected.some((item) => sensitiveReference.test(item.sourceReference) || sensitiveReference.test(item.evidenceId))) throw new Error("AI evidence contains prohibited credential material");

  const materializations = new Map<string, AiEvidenceMaterialization>();
  for (const item of input.evidenceMaterializations) {
    if (!item.evidenceId.trim() || !/^[a-f0-9]{64}$/i.test(item.contentDigest)) throw new Error("AI evidence materialization identity is invalid");
    if (materializations.has(item.evidenceId)) throw new Error("AI evidence materialization must be unique");
    materializations.set(item.evidenceId, item);
  }
  const selectedIds = new Set(selected.map((item) => item.evidenceId));
  if ([...materializations.keys()].some((evidenceId) => !selectedIds.has(evidenceId))) throw new Error("AI evidence materialization is unbound");

  const materializedEvidence = selected.map((evidence) => {
    const materialization = materializations.get(evidence.evidenceId);
    if (materialization == null) throw new Error(`AI evidence materialization is missing:${evidence.evidenceId}`);
    if (materialization.contentDigest !== evidence.contentDigest) throw new Error(`AI evidence materialization digest mismatch:${evidence.evidenceId}`);
    if (containsSensitiveMaterial(materialization.payload)) throw new Error(`AI evidence contains prohibited credential material:${evidence.evidenceId}`);
    if (aiSha256(materialization.payload) !== evidence.contentDigest) throw new Error(`AI evidence payload digest mismatch:${evidence.evidenceId}`);
    const payload = deepFreeze(structuredClone(materialization.payload));
    return Object.freeze({ evidence, payload });
  });

  const context = createAgentContextSnapshot({ contextSnapshotId: input.contextSnapshotId, agentId: input.agentId, evidenceIds: selected.map((item) => item.evidenceId), policyVersionIds: [...input.policyVersionIds].sort(), certificationIds: [...input.certificationIds].sort(), controlPlaneStateId: input.controlPlaneStateId, createdAt: input.evaluatedAt, validUntil: input.validUntil });
  const evidenceBundleHash = aiSha256(materializedEvidence.map((item) => ({ evidence: item.evidence, payload: item.payload })));
  const inputHash = aiSha256({ contextHash: context.contextHash, evidenceBundleHash, evidenceIds: selected.map((item) => item.evidenceId) });
  return Object.freeze({ context, evidence: Object.freeze(selected), materializedEvidence: Object.freeze(materializedEvidence), evidenceBundleHash, inputHash });
}
