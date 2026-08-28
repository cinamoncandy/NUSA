import {
  promotePaperChaosOperationalEvidence,
  type BoundPaperChaosOperationalEvidence,
  type PaperChaosTrustedGitHubRunReceipt,
  type VerifiedPaperChaosOperationalEvidence,
} from "./paperChaosEvidenceProvenance";

export interface PaperChaosGitHubRunResponse {
  readonly id?: unknown;
  readonly run_attempt?: unknown;
  readonly head_sha?: unknown;
  readonly event?: unknown;
  readonly status?: unknown;
  readonly conclusion?: unknown;
  readonly path?: unknown;
  readonly head_branch?: unknown;
  readonly html_url?: unknown;
  readonly repository?: { readonly full_name?: unknown };
}

export interface PaperChaosGitHubRunHttpResponse {
  readonly status: number;
  readonly json: () => Promise<unknown>;
}

export type PaperChaosGitHubRunFetch = (
  url: string,
  init: { readonly method: "GET"; readonly headers: Readonly<Record<string, string>>; readonly signal?: AbortSignal },
) => Promise<PaperChaosGitHubRunHttpResponse>;

export interface PaperChaosGitHubRunLookupOptions {
  readonly token: string;
  readonly apiBaseUrl?: string;
  readonly fetchImpl?: PaperChaosGitHubRunFetch;
  readonly timeoutMs?: number;
}

export interface PaperChaosGitHubRunLookup {
  readonly lookup: (evidence: BoundPaperChaosOperationalEvidence) => Promise<PaperChaosTrustedGitHubRunReceipt>;
}

export class PaperChaosGitHubRunLookupError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PaperChaosGitHubRunLookupError";
  }
}

const DEFAULT_API_BASE_URL = "https://api.github.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new PaperChaosGitHubRunLookupError("INVALID_RESPONSE", `${field} is missing`);
  return value.trim();
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new PaperChaosGitHubRunLookupError("INVALID_RESPONSE", `${field} is invalid`);
  return Number(value);
}

function parseWorkflowRef(workflowRef: string, repository: string): { readonly path: string; readonly ref: string } {
  const prefix = `${repository}/`;
  if (!workflowRef.startsWith(prefix)) throw new PaperChaosGitHubRunLookupError("WORKFLOW_REF_MISMATCH", "workflow reference repository does not match the evidence repository");
  const descriptor = workflowRef.slice(prefix.length);
  const separator = descriptor.lastIndexOf("@");
  if (separator <= 0 || separator === descriptor.length - 1) throw new PaperChaosGitHubRunLookupError("WORKFLOW_REF_INVALID", "workflow reference is incomplete");
  const path = descriptor.slice(0, separator);
  const ref = descriptor.slice(separator + 1);
  if (!path.startsWith(".github/workflows/") || !path.endsWith(".yml") && !path.endsWith(".yaml") || !ref.startsWith("refs/heads/")) {
    throw new PaperChaosGitHubRunLookupError("WORKFLOW_REF_INVALID", "only branch-bound GitHub workflow references can be verified");
  }
  return Object.freeze({ path, ref });
}

function responseObject(value: unknown): PaperChaosGitHubRunResponse {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new PaperChaosGitHubRunLookupError("INVALID_RESPONSE", "GitHub workflow response is not an object");
  return value as PaperChaosGitHubRunResponse;
}

function assertRunMatches(evidence: BoundPaperChaosOperationalEvidence, run: PaperChaosGitHubRunResponse): void {
  const runId = positiveInteger(run.id, "id");
  const runAttempt = positiveInteger(run.run_attempt, "run_attempt");
  const headSha = requiredText(run.head_sha, "head_sha");
  const event = requiredText(run.event, "event");
  const status = requiredText(run.status, "status");
  const conclusion = requiredText(run.conclusion, "conclusion");
  const runUrl = requiredText(run.html_url, "html_url");
  const repository = requiredText(run.repository?.full_name, "repository.full_name");
  const path = requiredText(run.path, "path");
  const headBranch = requiredText(run.head_branch, "head_branch");
  if (runId !== evidence.workflowRunId || runAttempt !== evidence.workflowRunAttempt) throw new PaperChaosGitHubRunLookupError("RUN_ID_MISMATCH", "GitHub workflow run identity does not match the evidence");
  if (headSha.toLowerCase() !== evidence.sourceSha) throw new PaperChaosGitHubRunLookupError("HEAD_SHA_MISMATCH", "GitHub workflow head does not match the evidence");
  if (event !== evidence.eventName) throw new PaperChaosGitHubRunLookupError("EVENT_MISMATCH", "GitHub workflow event does not match the evidence");
  if (status !== "completed" || conclusion !== "success") throw new PaperChaosGitHubRunLookupError("RUN_NOT_SUCCESSFUL", "GitHub workflow run is not completed successfully");
  if (runUrl !== evidence.workflowRunUrl) throw new PaperChaosGitHubRunLookupError("RUN_URL_MISMATCH", "GitHub workflow URL does not match the evidence");
  if (repository !== evidence.repository) throw new PaperChaosGitHubRunLookupError("REPOSITORY_MISMATCH", "GitHub workflow repository does not match the evidence");
  const workflow = parseWorkflowRef(evidence.workflowRef, evidence.repository);
  if (path !== workflow.path || headBranch !== workflow.ref.slice("refs/heads/".length)) throw new PaperChaosGitHubRunLookupError("WORKFLOW_REF_MISMATCH", "GitHub workflow path or branch does not match the evidence");
}

export function createPaperChaosGitHubRunLookup(options: PaperChaosGitHubRunLookupOptions): PaperChaosGitHubRunLookup {
  const token = requiredText(options.token, "token");
  const apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).trim().replace(/\/$/, "");
  if (!/^https:\/\/[^/]+(?:\/[^/]*)*$/.test(apiBaseUrl)) throw new PaperChaosGitHubRunLookupError("API_BASE_INVALID", "GitHub API base URL must use HTTPS");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new PaperChaosGitHubRunLookupError("TIMEOUT_INVALID", "GitHub API timeout is invalid");
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));

  return Object.freeze({
    lookup: async (evidence: BoundPaperChaosOperationalEvidence): Promise<PaperChaosTrustedGitHubRunReceipt> => {
      if (evidence.verificationStatus !== "BOUND_UNVERIFIED") throw new PaperChaosGitHubRunLookupError("EVIDENCE_NOT_BOUND", "only bound-unverified evidence may be promoted");
      if (!REPOSITORY_PATTERN.test(evidence.repository) || !SHA_PATTERN.test(evidence.sourceSha)) throw new PaperChaosGitHubRunLookupError("EVIDENCE_INVALID", "evidence repository or head is invalid");
      const runId = positiveInteger(evidence.workflowRunId, "workflowRunId");
      parseWorkflowRef(evidence.workflowRef, evidence.repository);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const encodedRepository = evidence.repository.split("/").map(encodeURIComponent).join("/");
        const response = await fetchImpl(`${apiBaseUrl}/repos/${encodedRepository}/actions/runs/${runId}`, {
          method: "GET",
          headers: Object.freeze({ Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" }),
          signal: controller.signal,
        });
        if (response.status !== 200) throw new PaperChaosGitHubRunLookupError(response.status === 404 ? "RUN_NOT_FOUND" : "GITHUB_API_UNAVAILABLE", `GitHub workflow lookup returned HTTP ${response.status}`);
        let run: PaperChaosGitHubRunResponse;
        try { run = responseObject(await response.json()); } catch (error) {
          if (error instanceof PaperChaosGitHubRunLookupError) throw error;
          throw new PaperChaosGitHubRunLookupError("INVALID_RESPONSE", "GitHub workflow response JSON is malformed");
        }
        assertRunMatches(evidence, run);
        return Object.freeze({
          verificationSource: "GITHUB_API" as const,
          repository: evidence.repository,
          headSha: evidence.sourceSha,
          workflowRunId: evidence.workflowRunId,
          workflowRunAttempt: evidence.workflowRunAttempt,
          workflowRef: evidence.workflowRef,
          eventName: evidence.eventName,
          workflowRunUrl: evidence.workflowRunUrl,
        });
      } catch (error) {
        if (error instanceof PaperChaosGitHubRunLookupError) throw error;
        if (error instanceof DOMException && error.name === "AbortError") throw new PaperChaosGitHubRunLookupError("GITHUB_API_TIMEOUT", "GitHub workflow lookup timed out");
        throw new PaperChaosGitHubRunLookupError("GITHUB_API_UNAVAILABLE", "GitHub workflow lookup failed");
      } finally { clearTimeout(timer); }
    },
  });
}

export async function promotePaperChaosOperationalEvidenceFromGitHub(
  evidence: BoundPaperChaosOperationalEvidence,
  lookup: PaperChaosGitHubRunLookup,
): Promise<VerifiedPaperChaosOperationalEvidence> {
  const trustedRun = await lookup.lookup(evidence);
  return promotePaperChaosOperationalEvidence(evidence, trustedRun);
}
