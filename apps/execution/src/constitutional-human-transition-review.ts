import { createHash } from "node:crypto";

export type ConstitutionalTransitionVerdict = "READY_FOR_CONSTITUTIONAL_HUMAN_REVIEW" | "INCOMPLETE" | "SAFE_BLOCK" | "UNKNOWN";
export type TransitionEvidenceStatus = "PASS" | "FAIL" | "MISSING" | "UNKNOWN";
export type TransitionEvidenceProvenance = "SYNTHETIC_CI" | "EXTERNAL_HUMAN_VERIFIED";

export const REQUIRED_TRANSITION_EVIDENCE_SLOTS = Object.freeze([
  "SIGNED_PRODUCTION_ARTIFACT",
  "EXTERNAL_READONLY_PREFLIGHT",
  "HUMAN_ACTIVATION_CEREMONY",
  "TINY_BOUNDED_LIVE_SESSION",
  "POST_LIVE_VALIDATION",
  "CONTROLLED_SCALE_GOVERNANCE",
  "DISASTER_RECOVERY_ROLLBACK",
  "AUDIT_EVIDENCE_CHAIN",
] as const);

export type TransitionEvidenceSlotName = (typeof REQUIRED_TRANSITION_EVIDENCE_SLOTS)[number];

export interface TransitionEvidenceSlot {
  readonly slot: TransitionEvidenceSlotName;
  readonly status: TransitionEvidenceStatus;
  readonly provenance: TransitionEvidenceProvenance;
  readonly evidenceRef?: string | null;
  readonly evidenceDigest?: string | null;
  readonly boundCodeRevision?: string | null;
  readonly boundConfigurationHash?: string | null;
}

export interface ConstitutionalTransitionReviewInput {
  readonly reviewId: string;
  readonly codeRevision: string;
  readonly configurationHash: string;
  readonly releaseCandidateId: string;
  readonly deploymentBundleId: string;
  readonly rollbackBundleId: string;
  readonly evidence: readonly TransitionEvidenceSlot[];
}

export interface ConstitutionalTransitionReviewResult {
  readonly verdict: ConstitutionalTransitionVerdict;
  readonly blockers: readonly string[];
  readonly unknowns: readonly string[];
  readonly missing: readonly TransitionEvidenceSlotName[];
  readonly syntheticOnly: readonly TransitionEvidenceSlotName[];
  readonly packetFingerprint: string;
  readonly constitutionalDecisionAuthority: false;
  readonly deploymentAuthority: false;
  readonly activationAuthority: false;
  readonly scaleUpAuthority: false;
  readonly orderAuthorization: false;
  readonly executionAuthority: false;
  readonly authorizesLive: false;
  readonly mutationPerformed: false;
  readonly credentialExecutionUse: false;
  readonly networkDialAllowed: false;
  readonly realMoneyExecutionAllowed: false;
}

export const CONSTITUTIONAL_TRANSITION_REVIEW_DESCRIPTOR = Object.freeze({
  mode: "EVIDENCE_AGGREGATION_ONLY" as const,
  syntheticEvidenceCannotSatisfyRealWorldGate: true as const,
  evidenceExactCodeBindingRequired: true as const,
  evidenceExactConfigurationBindingRequired: true as const,
  actualExternalBrokerValidationInCi: false as const,
  actualHumanCeremonyInCi: false as const,
  actualTinyLiveSessionInCi: false as const,
  automaticProductionTransitionAllowed: false as const,
  constitutionalDecisionAuthority: false as const,
  deploymentAuthority: false as const,
  activationAuthority: false as const,
  scaleUpAuthority: false as const,
  orderAuthorization: false as const,
  executionAuthority: false as const,
  authorizesLive: false as const,
  mutationPerformed: false as const,
  credentialExecutionUse: false as const,
  networkDialAllowed: false as const,
  realMoneyExecutionAllowed: false as const,
});

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const PROHIBITED_MATERIAL = /(?:bearer\s+|private[_ -]?key|api[_ -]?secret|access[_ -]?token|secret[_ -]?key|authorization\s*:|BEGIN [A-Z ]*PRIVATE KEY)/i;
const REQUIRED_SLOT_SET = new Set<string>(REQUIRED_TRANSITION_EVIDENCE_SLOTS);
const EVIDENCE_STATUS_SET = new Set<string>(["PASS", "FAIL", "MISSING", "UNKNOWN"]);
const EVIDENCE_PROVENANCE_SET = new Set<string>(["SYNTHETIC_CI", "EXTERNAL_HUMAN_VERIFIED"]);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function requiredId(value: string, code: string): string {
  const normalized = value.trim();
  if (!SAFE_ID.test(normalized) || PROHIBITED_MATERIAL.test(normalized)) throw new Error(code);
  return normalized;
}

function normalizeEvidenceSlot(slot: TransitionEvidenceSlot): Readonly<TransitionEvidenceSlot> {
  if (!REQUIRED_SLOT_SET.has(slot.slot)) throw new Error("TRANSITION_EVIDENCE_SLOT_INVALID");
  if (!EVIDENCE_STATUS_SET.has(slot.status)) throw new Error(`TRANSITION_EVIDENCE_STATUS_INVALID:${slot.slot}`);
  if (!EVIDENCE_PROVENANCE_SET.has(slot.provenance)) throw new Error(`TRANSITION_EVIDENCE_PROVENANCE_INVALID:${slot.slot}`);
  const evidenceRef = slot.evidenceRef?.trim() || null;
  const evidenceDigest = slot.evidenceDigest?.trim() || null;
  const boundCodeRevision = slot.boundCodeRevision?.trim() || null;
  const boundConfigurationHash = slot.boundConfigurationHash?.trim() || null;
  if (evidenceRef && PROHIBITED_MATERIAL.test(evidenceRef)) throw new Error(`TRANSITION_EVIDENCE_SECRET_MATERIAL:${slot.slot}`);
  if (slot.status === "MISSING") {
    if (evidenceRef || evidenceDigest || boundCodeRevision || boundConfigurationHash) {
      throw new Error(`TRANSITION_MISSING_EVIDENCE_MUST_HAVE_NO_ARTIFACT:${slot.slot}`);
    }
  } else {
    if (!evidenceRef || !SAFE_ID.test(evidenceRef)) throw new Error(`TRANSITION_EVIDENCE_REF_INVALID:${slot.slot}`);
    if (!evidenceDigest || !HEX64.test(evidenceDigest)) throw new Error(`TRANSITION_EVIDENCE_DIGEST_INVALID:${slot.slot}`);
    if (!boundCodeRevision || !HEX40.test(boundCodeRevision)) throw new Error(`TRANSITION_EVIDENCE_CODE_BINDING_INVALID:${slot.slot}`);
    if (!boundConfigurationHash || !HEX64.test(boundConfigurationHash)) throw new Error(`TRANSITION_EVIDENCE_CONFIG_BINDING_INVALID:${slot.slot}`);
  }
  return Object.freeze({ slot: slot.slot, status: slot.status, provenance: slot.provenance, evidenceRef, evidenceDigest, boundCodeRevision, boundConfigurationHash });
}

export function evaluateConstitutionalTransitionReview(
  input: ConstitutionalTransitionReviewInput,
): ConstitutionalTransitionReviewResult {
  const reviewId = requiredId(input.reviewId, "TRANSITION_REVIEW_ID_INVALID");
  if (!HEX40.test(input.codeRevision)) throw new Error("TRANSITION_CODE_REVISION_INVALID");
  if (!HEX64.test(input.configurationHash)) throw new Error("TRANSITION_CONFIGURATION_HASH_INVALID");
  const releaseCandidateId = requiredId(input.releaseCandidateId, "TRANSITION_RELEASE_CANDIDATE_ID_INVALID");
  const deploymentBundleId = requiredId(input.deploymentBundleId, "TRANSITION_DEPLOYMENT_BUNDLE_ID_INVALID");
  const rollbackBundleId = requiredId(input.rollbackBundleId, "TRANSITION_ROLLBACK_BUNDLE_ID_INVALID");

  const bySlot = new Map<TransitionEvidenceSlotName, Readonly<TransitionEvidenceSlot>>();
  for (const raw of input.evidence) {
    const normalized = normalizeEvidenceSlot(raw);
    if (bySlot.has(normalized.slot)) throw new Error(`TRANSITION_EVIDENCE_SLOT_DUPLICATE:${normalized.slot}`);
    bySlot.set(normalized.slot, normalized);
  }

  const blockers: string[] = [];
  const unknowns: string[] = [];
  const missing: TransitionEvidenceSlotName[] = [];
  const syntheticOnly: TransitionEvidenceSlotName[] = [];
  const normalizedEvidence: Readonly<TransitionEvidenceSlot>[] = [];

  for (const slotName of REQUIRED_TRANSITION_EVIDENCE_SLOTS) {
    const evidence = bySlot.get(slotName);
    if (!evidence) {
      missing.push(slotName);
      normalizedEvidence.push(Object.freeze({
        slot: slotName,
        status: "MISSING",
        provenance: "SYNTHETIC_CI",
        evidenceRef: null,
        evidenceDigest: null,
        boundCodeRevision: null,
        boundConfigurationHash: null,
      }));
      continue;
    }
    normalizedEvidence.push(evidence);
    if (evidence.status !== "MISSING") {
      if (evidence.boundCodeRevision !== input.codeRevision) blockers.push(`${slotName}_CODE_REVISION_MISMATCH`);
      if (evidence.boundConfigurationHash !== input.configurationHash) blockers.push(`${slotName}_CONFIGURATION_HASH_MISMATCH`);
    }
    if (evidence.status === "FAIL") blockers.push(`${slotName}_FAIL`);
    else if (evidence.status === "UNKNOWN") unknowns.push(`${slotName}_UNKNOWN`);
    else if (evidence.status === "MISSING") missing.push(slotName);
    else if (evidence.provenance !== "EXTERNAL_HUMAN_VERIFIED") syntheticOnly.push(slotName);
  }

  const normalizedBlockers = [...new Set(blockers)].sort();
  const normalizedUnknowns = [...new Set(unknowns)].sort();
  const normalizedMissing = [...new Set(missing)].sort() as TransitionEvidenceSlotName[];
  const normalizedSyntheticOnly = [...new Set(syntheticOnly)].sort() as TransitionEvidenceSlotName[];
  const verdict: ConstitutionalTransitionVerdict = normalizedBlockers.length > 0
    ? "SAFE_BLOCK"
    : normalizedUnknowns.length > 0
      ? "UNKNOWN"
      : normalizedMissing.length > 0 || normalizedSyntheticOnly.length > 0
        ? "INCOMPLETE"
        : "READY_FOR_CONSTITUTIONAL_HUMAN_REVIEW";

  const packetFingerprint = sha256({
    reviewId,
    codeRevision: input.codeRevision,
    configurationHash: input.configurationHash,
    releaseCandidateId,
    deploymentBundleId,
    rollbackBundleId,
    evidence: normalizedEvidence,
    blockers: normalizedBlockers,
    unknowns: normalizedUnknowns,
    missing: normalizedMissing,
    syntheticOnly: normalizedSyntheticOnly,
    verdict,
    constitutionalDecisionAuthority: false,
    deploymentAuthority: false,
    activationAuthority: false,
    scaleUpAuthority: false,
    orderAuthorization: false,
    executionAuthority: false,
    authorizesLive: false,
  });

  return Object.freeze({
    verdict,
    blockers: Object.freeze(normalizedBlockers),
    unknowns: Object.freeze(normalizedUnknowns),
    missing: Object.freeze(normalizedMissing),
    syntheticOnly: Object.freeze(normalizedSyntheticOnly),
    packetFingerprint,
    constitutionalDecisionAuthority: false,
    deploymentAuthority: false,
    activationAuthority: false,
    scaleUpAuthority: false,
    orderAuthorization: false,
    executionAuthority: false,
    authorizesLive: false,
    mutationPerformed: false,
    credentialExecutionUse: false,
    networkDialAllowed: false,
    realMoneyExecutionAllowed: false,
  });
}
