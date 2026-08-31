import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const SHA = /^[a-f0-9]{40}$/;

export function buildObservation({ run, currentHeadSha, observedAt }) {
  const pullRequest = Array.isArray(run?.pull_requests) && run.pull_requests.length === 1 ? run.pull_requests[0] : null;
  const pullRequestNumber = pullRequest?.number;
  const validatedHeadSha = pullRequest?.head?.sha;
  const workflowRunId = run?.id;

  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber <= 0) return { status: "UNKNOWN", reason: "PULL_REQUEST_PROVENANCE_UNAVAILABLE" };
  if (!Number.isSafeInteger(workflowRunId) || workflowRunId <= 0) return { status: "UNKNOWN", reason: "WORKFLOW_RUN_ID_UNAVAILABLE" };
  if (!SHA.test(validatedHeadSha ?? "")) return { status: "UNKNOWN", reason: "VALIDATED_HEAD_UNAVAILABLE" };
  if (!SHA.test(currentHeadSha ?? "")) return { status: "UNKNOWN", reason: "CURRENT_HEAD_UNAVAILABLE" };
  if (!Number.isSafeInteger(observedAt) || observedAt < 0) return { status: "UNKNOWN", reason: "OBSERVED_AT_INVALID" };

  const source = JSON.stringify({
    workflowRunId,
    pullRequestNumber,
    validatedHeadSha,
    currentHeadSha,
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
  });
  const sourceFingerprint = createHash("sha256").update(source).digest("hex");
  const classification = currentHeadSha === validatedHeadSha
    ? "EXACT_HEAD_READY"
    : "STALE_HEAD_REVALIDATION_REQUIRED";

  return Object.freeze({
    schemaVersion: 1,
    status: "MEASURED",
    observation: Object.freeze({
      observationId: `github-run-${workflowRunId}:pr-${pullRequestNumber}`,
      workItemId: `pr-${pullRequestNumber}`,
      pullRequestNumber,
      currentHeadSha,
      validatedHeadSha,
      workflowRunId,
      workflowHeadSha: validatedHeadSha,
      sourceFingerprint,
      observedAt,
      classification,
    }),
  });
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const outputPath = process.env.NUSA_REWORK_TELEMETRY_OUTPUT ?? "artifacts/control-plane/merge-rework-observation.json";
  if (!eventPath || !repository || !token) throw new Error("GITHUB_EVENT_PATH, GITHUB_REPOSITORY, and GITHUB_TOKEN are required");

  const event = JSON.parse(await readFile(eventPath, "utf8"));
  const run = event.workflow_run;
  const pullRequest = Array.isArray(run?.pull_requests) && run.pull_requests.length === 1 ? run.pull_requests[0] : null;
  if (!pullRequest?.number) {
    await writeFile(outputPath, `${JSON.stringify({ schemaVersion: 1, status: "UNKNOWN", reason: "PULL_REQUEST_PROVENANCE_UNAVAILABLE" }, null, 2)}\n`);
    return;
  }

  const response = await fetch(`https://api.github.com/repos/${repository}/pulls/${pullRequest.number}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "nusa-control-plane",
    },
  });
  if (!response.ok) throw new Error(`GitHub PR fetch failed: ${response.status}`);
  const current = await response.json();
  const result = buildObservation({ run, currentHeadSha: current?.head?.sha, observedAt: Date.now() });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);

  if (result.status === "MEASURED") {
    const o = result.observation;
    process.stdout.write(`NUSA_REWORK_TELEMETRY ${o.classification} pr=${o.pullRequestNumber} run=${o.workflowRunId} validated=${o.validatedHeadSha} current=${o.currentHeadSha}\n`);
  } else {
    process.stdout.write(`NUSA_REWORK_TELEMETRY UNKNOWN reason=${result.reason}\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}` || process.argv[1]?.endsWith("observe-ci-stale-head.mjs")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
