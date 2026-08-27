import type { NusaProgressEvidenceRef } from "./nusaProgressScorecard";

export interface GithubCommitEvidenceReceipt {
  readonly sha: string;
  readonly observedAt: number;
  /** SHA-256 of the immutable commit API receipt or independently stored commit evidence payload. */
  readonly sourceFingerprint: string;
}

export interface GithubWorkflowEvidenceReceipt {
  readonly runId: number;
  readonly name: string;
  readonly headSha: string;
  readonly status: "queued" | "in_progress" | "completed";
  readonly conclusion: string | null;
  readonly observedAt: number;
  /** SHA-256 of the immutable workflow-run receipt used for this observation. */
  readonly sourceFingerprint: string;
}

export interface GithubProgressEvidenceCollection {
  readonly repositoryEvidence: NusaProgressEvidenceRef;
  readonly ciEvidence: readonly NusaProgressEvidenceRef[];
}

export class NusaGithubProgressEvidenceError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "NusaGithubProgressEvidenceError";
  }
}

const COMMIT_SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function assertObservedAt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new NusaGithubProgressEvidenceError("INVALID_OBSERVED_AT", `${label} observedAt must be a non-negative safe integer`);
  }
}

function assertFingerprint(value: string, label: string): void {
  if (!SHA256.test(value)) {
    throw new NusaGithubProgressEvidenceError("INVALID_SOURCE_FINGERPRINT", `${label} requires a lowercase SHA-256 sourceFingerprint`);
  }
}

function workflowStatus(receipt: GithubWorkflowEvidenceReceipt): NusaProgressEvidenceRef["status"] {
  if (receipt.status !== "completed") return "UNKNOWN";
  return receipt.conclusion === "success" ? "PASS" : "FAIL";
}

/**
 * Canonical adapter from independently captured GitHub commit/workflow receipts into the evidence
 * format consumed by the NUSA progress scorecard. It does not call GitHub, invent fingerprints, or
 * weaken missing-check semantics. Every required workflow must be present exactly once and bound to
 * the exact commit SHA being assessed.
 */
export function collectGithubProgressEvidence(
  commit: GithubCommitEvidenceReceipt,
  workflowReceipts: readonly GithubWorkflowEvidenceReceipt[],
  requiredWorkflowNames: readonly string[],
): GithubProgressEvidenceCollection {
  if (!COMMIT_SHA.test(commit.sha)) {
    throw new NusaGithubProgressEvidenceError("INVALID_COMMIT_SHA", "commit sha must be a lowercase 40-character Git SHA-1");
  }
  assertObservedAt(commit.observedAt, "commit");
  assertFingerprint(commit.sourceFingerprint, "commit");

  if (requiredWorkflowNames.length === 0) {
    throw new NusaGithubProgressEvidenceError("EMPTY_REQUIRED_WORKFLOWS", "at least one required workflow name is needed for CI evidence");
  }
  const required = new Set<string>();
  for (const name of requiredWorkflowNames) {
    const normalized = name.trim();
    if (!normalized) throw new NusaGithubProgressEvidenceError("EMPTY_REQUIRED_WORKFLOW_NAME", "required workflow names must be non-empty");
    if (required.has(normalized)) throw new NusaGithubProgressEvidenceError("DUPLICATE_REQUIRED_WORKFLOW", `required workflow ${normalized} is duplicated`);
    required.add(normalized);
  }

  const byName = new Map<string, GithubWorkflowEvidenceReceipt>();
  for (const receipt of workflowReceipts) {
    const name = receipt.name.trim();
    if (!name) throw new NusaGithubProgressEvidenceError("EMPTY_WORKFLOW_NAME", "workflow receipt name must be non-empty");
    if (!Number.isSafeInteger(receipt.runId) || receipt.runId <= 0) throw new NusaGithubProgressEvidenceError("INVALID_RUN_ID", `workflow ${name} runId must be a positive safe integer`);
    if (!COMMIT_SHA.test(receipt.headSha)) throw new NusaGithubProgressEvidenceError("INVALID_WORKFLOW_HEAD_SHA", `workflow ${name} headSha is invalid`);
    if (receipt.headSha !== commit.sha) throw new NusaGithubProgressEvidenceError("WORKFLOW_HEAD_MISMATCH", `workflow ${name} is not bound to commit ${commit.sha}`);
    assertObservedAt(receipt.observedAt, `workflow ${name}`);
    assertFingerprint(receipt.sourceFingerprint, `workflow ${name}`);
    if (receipt.observedAt < commit.observedAt) throw new NusaGithubProgressEvidenceError("WORKFLOW_PREDATES_COMMIT", `workflow ${name} observation predates the commit receipt`);
    if (byName.has(name)) throw new NusaGithubProgressEvidenceError("DUPLICATE_WORKFLOW_RECEIPT", `workflow ${name} appears more than once`);
    byName.set(name, receipt);
  }

  const selected: GithubWorkflowEvidenceReceipt[] = [];
  for (const name of required) {
    const receipt = byName.get(name);
    if (receipt == null) throw new NusaGithubProgressEvidenceError("MISSING_REQUIRED_WORKFLOW", `required workflow ${name} has no receipt`);
    selected.push(receipt);
  }

  const repositoryEvidence: NusaProgressEvidenceRef = freeze({
    id: `github-commit-${commit.sha}`,
    kind: "REPOSITORY",
    status: "PASS",
    observedAt: commit.observedAt,
    source: `github://commit/${commit.sha}`,
    sourceFingerprint: commit.sourceFingerprint,
  });

  const ciEvidence = freeze(selected
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((receipt) => freeze<NusaProgressEvidenceRef>({
      id: `github-actions-${receipt.runId}`,
      kind: "CI",
      status: workflowStatus(receipt),
      observedAt: receipt.observedAt,
      source: `github://actions/run/${receipt.runId}`,
      sourceFingerprint: receipt.sourceFingerprint,
    })));

  return freeze({ repositoryEvidence, ciEvidence });
}
