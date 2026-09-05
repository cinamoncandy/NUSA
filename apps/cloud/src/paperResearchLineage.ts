export interface PaperResearchLineage {
  readonly schemaVersion: 1;
  readonly candidateId: string;
  readonly candidateVersion: string;
  readonly originalRunFingerprintSha256: string;
  readonly replayRunFingerprintSha256: string;
  readonly researchDecisionReference: string;
  readonly authority: "PAPER_RESEARCH_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const SHA256 = /^[a-f0-9]{64}$/;

function text(value: unknown, field: string, maximum = 240): string {
  if (typeof value !== "string") throw new Error(`PAPER Research lineage ${field} is invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) throw new Error(`PAPER Research lineage ${field} is invalid`);
  return normalized;
}

/**
 * Immutable provenance joining one PAPER challenger deployment to the exact original Research
 * snapshot and the exact PAPER-evidence replay that qualified it. This is identity only: it grants
 * no broker/LIVE/champion authority and contains no credentials or raw execution payloads.
 */
export function validatePaperResearchLineage(value: PaperResearchLineage): PaperResearchLineage {
  if (value == null || typeof value !== "object" || value.schemaVersion !== 1) throw new Error("PAPER Research lineage schema is invalid");
  if (value.authority !== "PAPER_RESEARCH_ONLY" || value.liveAuthority !== "NONE" || value.productionMutationAllowed !== false || value.aiAuthority !== "ZERO_AUTHORITY") {
    throw new Error("PAPER Research lineage authority is invalid");
  }
  const candidateId = text(value.candidateId, "candidateId");
  const candidateVersion = text(value.candidateVersion, "candidateVersion");
  const originalRunFingerprintSha256 = text(value.originalRunFingerprintSha256, "originalRunFingerprintSha256", 64).toLowerCase();
  const replayRunFingerprintSha256 = text(value.replayRunFingerprintSha256, "replayRunFingerprintSha256", 64).toLowerCase();
  if (!SHA256.test(originalRunFingerprintSha256) || !SHA256.test(replayRunFingerprintSha256)) throw new Error("PAPER Research lineage fingerprint is invalid");
  const researchDecisionReference = text(value.researchDecisionReference, "researchDecisionReference");
  return Object.freeze({
    schemaVersion: 1,
    candidateId,
    candidateVersion,
    originalRunFingerprintSha256,
    replayRunFingerprintSha256,
    researchDecisionReference,
    authority: "PAPER_RESEARCH_ONLY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

export function samePaperResearchLineage(left: PaperResearchLineage, right: PaperResearchLineage): boolean {
  const a = validatePaperResearchLineage(left);
  const b = validatePaperResearchLineage(right);
  return a.candidateId === b.candidateId
    && a.candidateVersion === b.candidateVersion
    && a.originalRunFingerprintSha256 === b.originalRunFingerprintSha256
    && a.replayRunFingerprintSha256 === b.replayRunFingerprintSha256
    && a.researchDecisionReference === b.researchDecisionReference;
}
