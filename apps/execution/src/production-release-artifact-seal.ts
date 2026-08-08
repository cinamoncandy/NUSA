import { createHash } from "node:crypto";
import { verifyArtifactManifest, type ArtifactManifest } from "./artifact-manifest";

export type ReleaseSealVerdict = "READY_FOR_PRODUCTION_HUMAN_REVIEW" | "SAFE_BLOCK" | "UNKNOWN";
export type ReleaseSealCheck = "PASS" | "FAIL" | "UNKNOWN";
export type ReleaseSigningState = "SIGNED_VERIFIED" | "UNSIGNED" | "UNKNOWN";

export interface ProductionReleaseSealInput {
  readonly candidateId: string;
  readonly codeRevision: string;
  readonly configurationHash: string;
  readonly buildManifestCommit: string;
  readonly buildManifestConfigurationHash: string;
  readonly deploymentBundleId: string;
  readonly rollbackBundleId: string;
  readonly rollbackVerifiedBundleId: string;
  readonly artifactManifest: ArtifactManifest;
  readonly securityReportDigest: string;
  readonly sbomDigest: string;
  readonly auditReplayAnchor: string;
  readonly restoreVerificationFingerprint: string;
  readonly preflightFingerprint: string;
  readonly ceremonyMechanismEvidenceRef: string;
  readonly ceremonyMechanismEvidenceDigest: string;
  readonly signing: Readonly<{
    state: ReleaseSigningState;
    evidenceRef?: string;
    evidenceDigest?: string;
  }>;
  readonly checks: Readonly<{
    releaseProcess: ReleaseSealCheck;
    securityGate: ReleaseSealCheck;
    artifactAllowlist: ReleaseSealCheck;
    rollbackVerification: ReleaseSealCheck;
    restoreVerification: ReleaseSealCheck;
    capabilitySurface: ReleaseSealCheck;
    transportCredentialReadiness: ReleaseSealCheck;
    activationRehearsal: ReleaseSealCheck;
    readOnlyBrokerCredential: ReleaseSealCheck;
  }>;
}

export interface ProductionReleaseSealResult {
  readonly verdict: ReleaseSealVerdict;
  readonly blockers: readonly string[];
  readonly unknowns: readonly string[];
  readonly candidateId: string;
  readonly codeRevision: string;
  readonly configurationHash: string;
  readonly artifactManifestHash: string;
  readonly releaseSealFingerprint: string;
  readonly deploymentAuthority: false;
  readonly activationAuthority: false;
  readonly executionAuthority: false;
  readonly authorizesLive: false;
  readonly mutationPerformed: false;
  readonly realMoneyExecutionAllowed: false;
}

export const PRODUCTION_RELEASE_ARTIFACT_SEAL_DESCRIPTOR = Object.freeze({
  mode: "EVIDENCE_ONLY_SEAL" as const,
  exactCodeBinding: true as const,
  exactConfigurationBinding: true as const,
  exactArtifactHashBinding: true as const,
  rollbackBinding: true as const,
  signedVerifiedRequiredForProductionReview: true as const,
  deploymentAuthority: false as const,
  activationAuthority: false as const,
  executionAuthority: false as const,
  authorizesLive: false as const,
  mutationPerformed: false as const,
  networkDialAllowed: false as const,
  credentialExecutionUse: false as const,
  realMoneyExecutionAllowed: false as const
});

const CHECK_KEYS = [
  "releaseProcess",
  "securityGate",
  "artifactAllowlist",
  "rollbackVerification",
  "restoreVerification",
  "capabilitySurface",
  "transportCredentialReadiness",
  "activationRehearsal",
  "readOnlyBrokerCredential"
] as const;
const prohibitedMaterial = /(?:bearer\s+|private[_ -]?key|api[_ -]?secret|access[_ -]?token|authorization\s*:|password\s*:)/i;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function required(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized || prohibitedMaterial.test(normalized)) throw new Error(code);
  return normalized;
}

function exactHash(value: string, length: 40 | 64, code: string): string {
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value)) throw new Error(code);
  return value;
}

function normalizeArtifactManifest(manifest: ArtifactManifest): ArtifactManifest {
  const selfBlockers = verifyArtifactManifest(manifest, manifest);
  if (selfBlockers.length > 0) throw new Error(`RELEASE_ARTIFACT_MANIFEST_INVALID:${selfBlockers.join(",")}`);
  const entries = Object.freeze(manifest.entries.map((entry) => Object.freeze({ ...entry })));
  return Object.freeze({ manifestId: manifest.manifestId, entries, manifestHash: manifest.manifestHash });
}

export function evaluateProductionReleaseArtifactSeal(input: ProductionReleaseSealInput): ProductionReleaseSealResult {
  const candidateId = required(input.candidateId, "RELEASE_CANDIDATE_ID_REQUIRED");
  const codeRevision = exactHash(input.codeRevision, 40, "RELEASE_CODE_REVISION_INVALID");
  const configurationHash = exactHash(input.configurationHash, 64, "RELEASE_CONFIGURATION_HASH_INVALID");
  const buildManifestCommit = exactHash(input.buildManifestCommit, 40, "RELEASE_BUILD_COMMIT_INVALID");
  const buildManifestConfigurationHash = exactHash(input.buildManifestConfigurationHash, 64, "RELEASE_BUILD_CONFIGURATION_HASH_INVALID");
  const deploymentBundleId = required(input.deploymentBundleId, "RELEASE_DEPLOYMENT_BUNDLE_REQUIRED");
  const rollbackBundleId = required(input.rollbackBundleId, "RELEASE_ROLLBACK_BUNDLE_REQUIRED");
  const rollbackVerifiedBundleId = required(input.rollbackVerifiedBundleId, "RELEASE_ROLLBACK_VERIFIED_BUNDLE_REQUIRED");
  const artifactManifest = normalizeArtifactManifest(input.artifactManifest);
  const securityReportDigest = exactHash(input.securityReportDigest, 64, "RELEASE_SECURITY_DIGEST_INVALID");
  const sbomDigest = exactHash(input.sbomDigest, 64, "RELEASE_SBOM_DIGEST_INVALID");
  const auditReplayAnchor = exactHash(input.auditReplayAnchor, 64, "RELEASE_AUDIT_ANCHOR_INVALID");
  const restoreVerificationFingerprint = exactHash(input.restoreVerificationFingerprint, 64, "RELEASE_RESTORE_FINGERPRINT_INVALID");
  const preflightFingerprint = exactHash(input.preflightFingerprint, 64, "RELEASE_PREFLIGHT_FINGERPRINT_INVALID");
  const ceremonyMechanismEvidenceRef = required(input.ceremonyMechanismEvidenceRef, "RELEASE_CEREMONY_EVIDENCE_REF_INVALID");
  const ceremonyMechanismEvidenceDigest = exactHash(input.ceremonyMechanismEvidenceDigest, 64, "RELEASE_CEREMONY_EVIDENCE_DIGEST_INVALID");

  const blockers: string[] = [];
  const unknowns: string[] = [];
  if (buildManifestCommit !== codeRevision) blockers.push("BUILD_CODE_REVISION_MISMATCH");
  if (buildManifestConfigurationHash !== configurationHash) blockers.push("BUILD_CONFIGURATION_HASH_MISMATCH");
  if (rollbackVerifiedBundleId !== rollbackBundleId) blockers.push("ROLLBACK_BUNDLE_MISMATCH");

  for (const key of CHECK_KEYS) {
    const state = input.checks[key];
    if (state === "FAIL") blockers.push(`CHECK_FAILED:${key}`);
    else if (state === "UNKNOWN") unknowns.push(`CHECK_UNKNOWN:${key}`);
  }

  let signingEvidenceRef: string | null = null;
  let signingEvidenceDigest: string | null = null;
  if (input.signing.state === "UNSIGNED") {
    blockers.push("RELEASE_UNSIGNED");
  } else if (input.signing.state === "UNKNOWN") {
    unknowns.push("RELEASE_SIGNING_UNKNOWN");
  } else {
    try {
      signingEvidenceRef = required(input.signing.evidenceRef ?? "", "RELEASE_SIGNING_EVIDENCE_REF_REQUIRED");
      signingEvidenceDigest = exactHash(input.signing.evidenceDigest ?? "", 64, "RELEASE_SIGNING_EVIDENCE_DIGEST_REQUIRED");
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : "RELEASE_SIGNING_EVIDENCE_INVALID");
    }
  }

  const normalizedBlockers = Object.freeze([...new Set(blockers)].sort());
  const normalizedUnknowns = Object.freeze([...new Set(unknowns)].sort());
  const verdict: ReleaseSealVerdict = normalizedBlockers.length > 0
    ? "SAFE_BLOCK"
    : normalizedUnknowns.length > 0
      ? "UNKNOWN"
      : "READY_FOR_PRODUCTION_HUMAN_REVIEW";

  const releaseSealFingerprint = sha256(canonical({
    candidateId,
    codeRevision,
    configurationHash,
    buildManifestCommit,
    buildManifestConfigurationHash,
    deploymentBundleId,
    rollbackBundleId,
    rollbackVerifiedBundleId,
    artifactManifest,
    securityReportDigest,
    sbomDigest,
    auditReplayAnchor,
    restoreVerificationFingerprint,
    preflightFingerprint,
    ceremonyMechanismEvidenceRef,
    ceremonyMechanismEvidenceDigest,
    signing: {
      state: input.signing.state,
      evidenceRef: signingEvidenceRef,
      evidenceDigest: signingEvidenceDigest
    },
    checks: input.checks,
    verdict,
    blockers: normalizedBlockers,
    unknowns: normalizedUnknowns,
    deploymentAuthority: false,
    activationAuthority: false,
    executionAuthority: false,
    authorizesLive: false
  }));

  return Object.freeze({
    verdict,
    blockers: normalizedBlockers,
    unknowns: normalizedUnknowns,
    candidateId,
    codeRevision,
    configurationHash,
    artifactManifestHash: artifactManifest.manifestHash,
    releaseSealFingerprint,
    deploymentAuthority: false,
    activationAuthority: false,
    executionAuthority: false,
    authorizesLive: false,
    mutationPerformed: false,
    realMoneyExecutionAllowed: false
  });
}
