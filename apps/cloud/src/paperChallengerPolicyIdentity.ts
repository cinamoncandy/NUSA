import { createHash } from "node:crypto";

export const PAPER_CHALLENGER_POLICY_VERSION = "paper-challenger-policy-v1";

export function paperChallengerPolicyIdentity(input: Readonly<{
  candidateId: string;
  candidateVersion: string;
  familyId: string;
  evidenceFingerprintSha256: string;
  replayRunFingerprintSha256: string;
  researchDecisionReference: string;
}>): Readonly<{ decisionFingerprint: string; approvalReference: string }> {
  const decisionFingerprint = createHash("sha256").update(JSON.stringify([
    PAPER_CHALLENGER_POLICY_VERSION,
    input.candidateId,
    input.candidateVersion,
    input.familyId,
    input.evidenceFingerprintSha256,
    input.replayRunFingerprintSha256,
    input.researchDecisionReference,
  ])).digest("hex");
  return Object.freeze({ decisionFingerprint, approvalReference: `policy:${PAPER_CHALLENGER_POLICY_VERSION}:${decisionFingerprint.slice(0, 16)}` });
}
