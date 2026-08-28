import { createHash } from "node:crypto";
import type { PaperChaosRecoveryReceipt } from "./paperChaosRecovery";

export interface PaperChaosGitHubActionsContext {
  readonly githubActions: string | undefined;
  readonly repository: string | undefined;
  readonly sha: string | undefined;
  readonly runId: string | undefined;
  readonly runAttempt: string | undefined;
  readonly workflowRef: string | undefined;
  readonly eventName: string | undefined;
  readonly serverUrl: string | undefined;
}

interface PaperChaosOperationalEvidencePayload {
  readonly schemaVersion: 1;
  readonly source: "GITHUB_ACTIONS_PAPER_RUNTIME";
  readonly repository: string;
  readonly sourceSha: string;
  readonly workflowRunId: number;
  readonly workflowRunAttempt: number;
  readonly workflowRef: string;
  readonly eventName: string;
  readonly workflowRunUrl: string;
  readonly receiptEvidenceSha256: string;
}

export interface BoundPaperChaosOperationalEvidence extends PaperChaosOperationalEvidencePayload {
  readonly provenanceSha256: string;
  readonly verificationStatus: "BOUND_UNVERIFIED";
}

export interface VerifiedPaperChaosOperationalEvidence extends PaperChaosOperationalEvidencePayload {
  readonly provenanceSha256: string;
  readonly verificationStatus: "VERIFIED";
}

export type PaperChaosOperationalEvidence = BoundPaperChaosOperationalEvidence | VerifiedPaperChaosOperationalEvidence;

/**
 * Trusted lookup result produced by an external GitHub API/runner-attestation boundary.
 * This module intentionally does not turn locally supplied Actions environment strings
 * into external verification by itself.
 */
export interface PaperChaosTrustedGitHubRunReceipt {
  readonly verificationSource: "GITHUB_API" | "RUNNER_ATTESTATION";
  readonly repository: string;
  readonly headSha: string;
  readonly workflowRunId: number;
  readonly workflowRunAttempt: number;
  readonly workflowRef: string;
  readonly eventName: string;
  readonly workflowRunUrl: string;
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

function canonical(value: object): string {
  const record = value as Record<string, unknown>;
  return JSON.stringify(Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]])));
}

function required(value: string | undefined, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`PAPER_CHAOS_PROVENANCE_${name}_MISSING`);
  return value.trim();
}

function positiveInteger(value: string | undefined, name: string): number {
  const parsed = Number(required(value, name));
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`PAPER_CHAOS_PROVENANCE_${name}_INVALID`);
  return parsed;
}

function evidencePayload(evidence: PaperChaosOperationalEvidence): PaperChaosOperationalEvidencePayload {
  const { provenanceSha256: _provenanceSha256, verificationStatus: _verificationStatus, ...payload } = evidence;
  return payload;
}

function assertEvidenceContent(evidence: PaperChaosOperationalEvidence): void {
  if (evidence.schemaVersion !== 1 || evidence.source !== "GITHUB_ACTIONS_PAPER_RUNTIME") throw new Error("PAPER_CHAOS_PROVENANCE_CONTENT_INVALID");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(evidence.repository)) throw new Error("PAPER_CHAOS_PROVENANCE_CONTENT_INVALID");
  if (!/^[a-f0-9]{40}$/.test(evidence.sourceSha) || !/^[a-f0-9]{64}$/.test(evidence.receiptEvidenceSha256)) throw new Error("PAPER_CHAOS_PROVENANCE_CONTENT_INVALID");
  if (!Number.isSafeInteger(evidence.workflowRunId) || evidence.workflowRunId <= 0 || !Number.isSafeInteger(evidence.workflowRunAttempt) || evidence.workflowRunAttempt <= 0) throw new Error("PAPER_CHAOS_PROVENANCE_CONTENT_INVALID");
  if (evidence.workflowRunUrl !== `https://github.com/${evidence.repository}/actions/runs/${evidence.workflowRunId}`) throw new Error("PAPER_CHAOS_PROVENANCE_CONTENT_INVALID");
  if (!evidence.workflowRef.includes(evidence.repository) || !evidence.workflowRef.includes("@") || !evidence.eventName.trim()) throw new Error("PAPER_CHAOS_PROVENANCE_CONTENT_INVALID");
  if (!/^[a-f0-9]{64}$/.test(evidence.provenanceSha256) || sha256(canonical(evidencePayload(evidence))) !== evidence.provenanceSha256) {
    throw new Error("PAPER_CHAOS_PROVENANCE_INTEGRITY_FAILED");
  }
}

export function buildPaperChaosOperationalEvidence(
  receipt: PaperChaosRecoveryReceipt,
  context: PaperChaosGitHubActionsContext,
): BoundPaperChaosOperationalEvidence {
  if (context.githubActions !== "true") throw new Error("PAPER_CHAOS_PROVENANCE_NOT_GITHUB_ACTIONS");
  if (receipt.source !== "PAPER_RUNTIME" || !/^[a-f0-9]{64}$/.test(receipt.evidenceSha256)) throw new Error("PAPER_CHAOS_PROVENANCE_RECEIPT_INVALID");

  const repository = required(context.repository, "REPOSITORY");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("PAPER_CHAOS_PROVENANCE_REPOSITORY_INVALID");
  const sourceSha = required(context.sha, "SHA").toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error("PAPER_CHAOS_PROVENANCE_SHA_INVALID");
  const workflowRunId = positiveInteger(context.runId, "RUN_ID");
  const workflowRunAttempt = positiveInteger(context.runAttempt, "RUN_ATTEMPT");
  const workflowRef = required(context.workflowRef, "WORKFLOW_REF");
  if (!workflowRef.includes(repository) || !workflowRef.includes("@")) throw new Error("PAPER_CHAOS_PROVENANCE_WORKFLOW_REF_INVALID");
  const eventName = required(context.eventName, "EVENT_NAME");
  const serverUrl = required(context.serverUrl, "SERVER_URL").replace(/\/$/, "");
  if (serverUrl !== "https://github.com") throw new Error("PAPER_CHAOS_PROVENANCE_SERVER_INVALID");
  const workflowRunUrl = `${serverUrl}/${repository}/actions/runs/${workflowRunId}`;

  const payload: PaperChaosOperationalEvidencePayload = {
    schemaVersion: 1,
    source: "GITHUB_ACTIONS_PAPER_RUNTIME",
    repository,
    sourceSha,
    workflowRunId,
    workflowRunAttempt,
    workflowRef,
    eventName,
    workflowRunUrl,
    receiptEvidenceSha256: receipt.evidenceSha256,
  };

  return Object.freeze({
    ...payload,
    provenanceSha256: sha256(canonical(payload)),
    verificationStatus: "BOUND_UNVERIFIED" as const,
  });
}

export function promotePaperChaosOperationalEvidence(
  evidence: BoundPaperChaosOperationalEvidence,
  trustedRun: PaperChaosTrustedGitHubRunReceipt,
): VerifiedPaperChaosOperationalEvidence {
  assertEvidenceContent(evidence);
  if (evidence.verificationStatus !== "BOUND_UNVERIFIED") throw new Error("PAPER_CHAOS_PROVENANCE_NOT_BOUND");
  if (trustedRun.verificationSource !== "GITHUB_API" && trustedRun.verificationSource !== "RUNNER_ATTESTATION") {
    throw new Error("PAPER_CHAOS_TRUSTED_RUN_SOURCE_INVALID");
  }

  const matches = trustedRun.repository === evidence.repository
    && trustedRun.headSha.toLowerCase() === evidence.sourceSha
    && trustedRun.workflowRunId === evidence.workflowRunId
    && trustedRun.workflowRunAttempt === evidence.workflowRunAttempt
    && trustedRun.workflowRef === evidence.workflowRef
    && trustedRun.eventName === evidence.eventName
    && trustedRun.workflowRunUrl === evidence.workflowRunUrl;
  if (!matches) throw new Error("PAPER_CHAOS_TRUSTED_RUN_MISMATCH");

  return Object.freeze({
    ...evidencePayload(evidence),
    provenanceSha256: evidence.provenanceSha256,
    verificationStatus: "VERIFIED" as const,
  });
}

export function verifyPaperChaosOperationalEvidence(evidence: VerifiedPaperChaosOperationalEvidence): VerifiedPaperChaosOperationalEvidence {
  assertEvidenceContent(evidence);
  if (evidence.verificationStatus !== "VERIFIED") throw new Error("PAPER_CHAOS_PROVENANCE_NOT_VERIFIED");
  return evidence;
}
