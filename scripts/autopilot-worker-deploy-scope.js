const fs = require("node:fs");

const WORKER_RUNTIME_INPUTS = [
  (file) => file.startsWith("apps/autopilot/"),
  (file) => file.startsWith("packages/contracts/"),
  (file) => [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.json",
    "tsconfig.base.json",
  ].includes(file),
];

function isSafeRepositoryPath(file) {
  return typeof file === "string"
    && file.length > 0
    && !file.includes("\\")
    && !file.startsWith("/")
    && !/^[a-zA-Z]:/.test(file)
    && !file.split("/").some((part) => part === "" || part === "." || part === "..");
}

function workerRuntimeChanged(files) {
  if (!Array.isArray(files)) throw new TypeError("changed files must be an array");
  if (!files.every(isSafeRepositoryPath)) throw new Error("changed file list contains an invalid repository path");
  return files.some((file) => WORKER_RUNTIME_INPUTS.some((matches) => matches(file)));
}

function readNulDelimitedPaths(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError("changed file input must be a Buffer");
  if (buffer.length === 0) return [];
  if (buffer[buffer.length - 1] !== 0) throw new Error("changed file input is not NUL terminated");

  const files = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) continue;
    const encoded = buffer.subarray(start, index);
    const file = encoded.toString("utf8");
    if (!Buffer.from(file, "utf8").equals(encoded)) throw new Error("changed file path is not valid UTF-8");
    files.push(file);
    start = index + 1;
  }
  return files;
}

function selectLastSuccessfulDeploymentSha(pages, currentRunId, repository) {
  if (!Number.isSafeInteger(Number(currentRunId)) || !repository) {
    throw new TypeError("deployment history inputs are invalid");
  }
  const pageList = Array.isArray(pages) ? pages : [pages];
  const runs = [];
  for (const page of pageList) {
    if (!page || !Array.isArray(page.workflow_runs)) throw new Error("deployment history response is malformed");
    for (const run of page.workflow_runs) {
      if (!run || typeof run !== "object") throw new Error("deployment history contains a malformed run");
      if (String(run.id) === String(currentRunId)
        || run.status !== "completed"
        || run.conclusion !== "success"
        || run.head_branch !== "main"
        || run.head_repository?.full_name !== repository) continue;
      if (typeof run.created_at !== "string" || !Number.isFinite(Date.parse(run.created_at))) {
        throw new Error("successful main deployment has an invalid creation time");
      }
      if (typeof run.head_sha !== "string" || !/^[0-9a-f]{40}$/i.test(run.head_sha)) {
        throw new Error("successful main deployment has an invalid exact head");
      }
      runs.push(run);
    }
  }
  runs.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
  return runs[0]?.head_sha.toLowerCase() ?? null;
}

function main() {
  if (process.argv[2] === "--last-successful-deployment") {
    const pages = JSON.parse(fs.readFileSync(0, "utf8"));
    const sha = selectLastSuccessfulDeploymentSha(pages, process.env.GITHUB_RUN_ID, process.env.GITHUB_REPOSITORY);
    if (sha) process.stdout.write(`${sha}\n`);
    return;
  }
  const files = readNulDelimitedPaths(fs.readFileSync(0));
  process.stdout.write(`worker_runtime_changed=${workerRuntimeChanged(files)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "failed to classify Worker deploy scope");
    process.exitCode = 1;
  }
}

module.exports = { readNulDelimitedPaths, selectLastSuccessfulDeploymentSha, workerRuntimeChanged };
