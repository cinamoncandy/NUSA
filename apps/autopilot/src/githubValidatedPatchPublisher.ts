import type {
  CodingPublisher,
  CodingPublisherResult,
  CodingRunnerRequest,
  CodingRuntimeExecutionResult,
} from "./codingRunner";

interface GithubValidatedPatchPublisherConfig {
  readonly token?: string;
  readonly allowedRepository: string;
  readonly apiBaseUrl?: string;
}

interface GithubResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
}

type FetchImpl = (input: string, init?: RequestInit) => Promise<GithubResponse>;

const SHA40 = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_PATH = /^apps\/autopilot\/[A-Za-z0-9._/-]+$/;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CODING_PUBLISH_GITHUB_RESPONSE_INVALID");
  return value as Record<string, unknown>;
}

function header(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "user-agent": "nusa-autopilot-worker",
    "x-github-api-version": "2022-11-28",
  };
}

function branchFor(request: CodingRunnerRequest): string {
  const identity = `${request.workflowRunId}-${request.executionId}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return `nusa/autopilot/${identity}-${request.headSha.slice(0, 8)}`;
}

async function jsonRequest(
  fetchImpl: FetchImpl,
  url: string,
  token: string,
  init?: RequestInit,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const response = await fetchImpl(url, { ...init, headers: { ...header(token), ...(init?.headers as Record<string, string> | undefined) } });
  let payload: Record<string, unknown> = {};
  try {
    payload = object(await response.json());
  } catch {
    if (!response.ok) throw new Error(`CODING_PUBLISH_GITHUB_HTTP_${response.status}`);
  }
  if (!response.ok) throw new Error(`CODING_PUBLISH_GITHUB_HTTP_${response.status}`);
  return { status: response.status, payload };
}

export class GithubValidatedPatchPublisher implements CodingPublisher {
  readonly name = "github-validated-patch-publisher";

  constructor(
    private readonly config: GithubValidatedPatchPublisherConfig,
    private readonly fetchImpl: FetchImpl = fetch as unknown as FetchImpl,
  ) {}

  async publish(request: CodingRunnerRequest, runtime: CodingRuntimeExecutionResult): Promise<CodingPublisherResult> {
    const token = this.config.token?.trim();
    if (!token) throw new Error("CODING_PUBLISH_GITHUB_TOKEN_REQUIRED");
    if (!REPOSITORY.test(this.config.allowedRepository) || request.repository !== this.config.allowedRepository) {
      throw new Error("CODING_PUBLISH_REPOSITORY_NOT_ALLOWED");
    }
    if (!runtime.proposalValidated || !runtime.validatedFiles?.length) throw new Error("CODING_PUBLISH_VALIDATION_REQUIRED");
    if (runtime.validatedFiles.length !== 1) throw new Error("CODING_PUBLISH_FILE_COUNT_INVALID");
    for (const file of runtime.validatedFiles) {
      if (!SAFE_PATH.test(file.path) || file.path.includes("..")) throw new Error(`CODING_PUBLISH_PATH_INVALID:${file.path}`);
    }

    const base = (this.config.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
    const repository = request.repository.split("/").map(encodeURIComponent).join("/");
    const mainRef = await jsonRequest(this.fetchImpl, `${base}/repos/${repository}/git/ref/heads/main`, token);
    const currentMainSha = object(mainRef.payload.object).sha;
    if (typeof currentMainSha !== "string" || !SHA40.test(currentMainSha)) throw new Error("CODING_PUBLISH_MAIN_HEAD_INVALID");
    if (currentMainSha.toLowerCase() !== request.headSha.toLowerCase()) throw new Error("CODING_PUBLISH_STALE_HEAD_SUPPRESSED");

    const baseCommit = await jsonRequest(this.fetchImpl, `${base}/repos/${repository}/git/commits/${request.headSha}`, token);
    const baseTreeSha = object(baseCommit.payload.tree).sha;
    if (typeof baseTreeSha !== "string" || !SHA40.test(baseTreeSha)) throw new Error("CODING_PUBLISH_BASE_TREE_INVALID");

    const treeEntries: Array<Record<string, unknown>> = [];
    for (const file of runtime.validatedFiles) {
      const blob = await jsonRequest(this.fetchImpl, `${base}/repos/${repository}/git/blobs`, token, {
        method: "POST",
        body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
      });
      const blobSha = blob.payload.sha;
      if (typeof blobSha !== "string" || !SHA40.test(blobSha)) throw new Error("CODING_PUBLISH_BLOB_INVALID");
      treeEntries.push({ path: file.path, mode: "100644", type: "blob", sha: blobSha });
    }

    const tree = await jsonRequest(this.fetchImpl, `${base}/repos/${repository}/git/trees`, token, {
      method: "POST",
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
    });
    const treeSha = tree.payload.sha;
    if (typeof treeSha !== "string" || !SHA40.test(treeSha)) throw new Error("CODING_PUBLISH_TREE_INVALID");

    const commit = await jsonRequest(this.fetchImpl, `${base}/repos/${repository}/git/commits`, token, {
      method: "POST",
      body: JSON.stringify({
        message: `chore(autopilot): publish validated coding proposal\n\nExecution: ${request.executionId}\nWorkflow: ${request.workflowRunId}\nAI authority: ZERO_AUTHORITY`,
        tree: treeSha,
        parents: [request.headSha],
      }),
    });
    const commitSha = commit.payload.sha;
    if (typeof commitSha !== "string" || !SHA40.test(commitSha)) throw new Error("CODING_PUBLISH_COMMIT_INVALID");

    const branch = branchFor(request);
    await jsonRequest(this.fetchImpl, `${base}/repos/${repository}/git/refs`, token, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitSha }),
    });

    const pull = await jsonRequest(this.fetchImpl, `${base}/repos/${repository}/pulls`, token, {
      method: "POST",
      body: JSON.stringify({
        title: "chore(autopilot): validated autonomous coding proposal",
        head: branch,
        base: "main",
        draft: false,
        body: [
          "Autonomously proposed repository change validated in Cloudflare Sandbox before publication.",
          "",
          `- Base SHA: ${request.headSha}`,
          `- Workflow run: ${request.workflowRunId}`,
          `- Execution: ${request.executionId}`,
          `- Changed files: ${runtime.validatedFiles.map((file) => file.path).join(", ")}`,
          "- liveAuthority: NONE",
          "- productionMutationAllowed: false",
          "- aiAuthority: ZERO_AUTHORITY",
        ].join("\n"),
      }),
    });
    const pullRequestNumber = pull.payload.number;
    const pullRequestUrl = pull.payload.html_url;
    if (!Number.isSafeInteger(pullRequestNumber) || Number(pullRequestNumber) <= 0 || typeof pullRequestUrl !== "string") {
      throw new Error("CODING_PUBLISH_PULL_REQUEST_INVALID");
    }

    return Object.freeze({
      publisher: this.name,
      branch,
      commitSha,
      pullRequestNumber: Number(pullRequestNumber),
      pullRequestUrl,
    });
  }
}
