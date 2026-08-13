import { aiSha256 } from "../../../../packages/contracts/src/aiInference";
import type {
  AiExplanationEnvelope,
  AiExplanationSupportStatus,
  AiExplanationVerificationResult
} from "../../../../packages/contracts/src/aiExplanationFaithfulness";

const finiteUnit = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export function verifyAiExplanation(envelope: AiExplanationEnvelope): AiExplanationVerificationResult {
  const reasons = new Set<string>();
  const statuses: Record<string, AiExplanationSupportStatus> = {};
  const evidence = new Map(envelope.evidence.map((item) => [item.evidenceId, item]));
  if (evidence.size !== envelope.evidence.length || new Set(envelope.claims.map((claim) => claim.claimId)).size !== envelope.claims.length) reasons.add("DUPLICATE_EVIDENCE_OR_CLAIM_ID");
  const material = new Set(envelope.policy.materialCounterEvidenceIds);
  if (envelope.schemaVersion !== 1 || envelope.policy.schemaVersion !== 1) reasons.add("UNSUPPORTED_SCHEMA");
  if (!nonEmpty(envelope.explanationId) || !finiteUnit(envelope.confidence)) reasons.add("INVALID_IDENTITY_OR_CONFIDENCE");
  if (envelope.claims.length > envelope.policy.maxClaims) reasons.add("CLAIM_LIMIT_EXCEEDED");
  if (explanationDigestMismatch(envelope)) reasons.add("CONTENT_DIGEST_MISMATCH");
  if (!nonEmpty(envelope.lineage.replayIdentity) || !nonEmpty(envelope.lineage.canonicalInputHash) || !nonEmpty(envelope.lineage.holdoutPartitionIdentity)) reasons.add("INCOMPLETE_REPLAY_LINEAGE");
  if (!nonEmpty(envelope.lineage.providerId) || !nonEmpty(envelope.lineage.modelVersionId) || !nonEmpty(envelope.lineage.promptArtifactDigest) || !nonEmpty(envelope.lineage.calibrationIdentity)) reasons.add("INCOMPLETE_GOVERNANCE_LINEAGE");
  if (envelope.providerDisagreement && !envelope.abstained) reasons.add("PROVIDER_DISAGREEMENT_HIDDEN");
  if ((envelope.attributionStrength === "UNRESOLVED" || envelope.attributionStrength === "PARTIALLY_IDENTIFIED" || envelope.attributionStrength === "UNVERIFIED") && envelope.claims.some((c) => c.attributionStrength === "IDENTIFIED")) reasons.add("ATTRIBUTION_OVERCLAIM");
  for (const claim of envelope.claims) {
    const refs = claim.citedEvidenceIds;
    let status: AiExplanationSupportStatus = "SUPPORTED";
    if (refs.length === 0) status = "UNSUPPORTED";
    if (refs.length > envelope.policy.maxEvidencePerClaim) status = "UNVERIFIED";
    const cited = refs.map((id) => evidence.get(id));
    if (cited.some((item) => item == null)) status = "UNVERIFIED";
    if (cited.some((item) => item?.contradictsClaimIds.includes(claim.claimId))) status = "CONTRADICTED";
    if (cited.some((item) => item?.provenance !== claim.provenance)) status = "UNVERIFIED";
    if (cited.some((item) => item != null && !item.supportsClaimIds.includes(claim.claimId))) status = "UNVERIFIED";
    if (claim.assertive && envelope.abstained) status = "UNVERIFIED";
    if (claim.assertive && envelope.confidence < envelope.policy.minimumConfidenceForAssertiveLanguage) status = "UNVERIFIED";
    if (claim.provenance === "OBSERVED" && cited.some((item) => item?.provenance === "HYPOTHETICAL")) status = "UNVERIFIED";
    statuses[claim.claimId] = status;
    if (status === "UNSUPPORTED") reasons.add("UNSUPPORTED_CLAIM");
    if (status === "CONTRADICTED") reasons.add("CONTRADICTED_CLAIM");
    if (status === "UNVERIFIED") reasons.add("UNVERIFIED_CLAIM");
  }
  for (const id of material) {
    const item = evidence.get(id);
    if (!item || item.material !== true || item.contradictsClaimIds.length === 0) reasons.add("MATERIAL_COUNTEREVIDENCE_OMISSION");
  }
  if (envelope.abstained) reasons.add("CANONICAL_ABSTENTION");
  const digest = aiSha256(envelope.evidence.map((item) => ({ id: item.evidenceId, digest: item.digest, provenance: item.provenance })).sort((a, b) => a.id.localeCompare(b.id)));
  const verdict = reasons.size === 0 && Object.values(statuses).every((status) => status === "SUPPORTED") ? "PASS" : "ABSTAIN";
  return Object.freeze({ schemaVersion: 1, explanationId: envelope.explanationId, verdict, claimStatuses: Object.freeze(statuses), reasonCodes: Object.freeze([...reasons].sort()), evidenceDigest: digest, replayIdentity: envelope.lineage.replayIdentity, readOnly: true, liveAuthority: "NONE", realOrderAuthority: false, realTransferAuthority: false, productionMutationAllowed: false });
}

function explanationDigestMismatch(envelope: AiExplanationEnvelope): boolean {
  const { contentDigest, ...withoutDigest } = envelope;
  return contentDigest !== aiSha256(withoutDigest);
}

