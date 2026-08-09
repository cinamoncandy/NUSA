const { existsSync, readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const WORKFLOW_DIR = ".github/workflows";
const SHA40 = /^[a-f0-9]{40}$/i;
const DOCKER_DIGEST = /@sha256:[a-f0-9]{64}$/i;

function actionReference(line) {
  const match = line.match(/^\s*(?:-\s*)?uses:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function validateWorkflowActionPins(root = process.cwd()) {
  const directory = join(root, WORKFLOW_DIR);
  const failures = [];
  if (!existsSync(directory)) return { ok: false, failures: [`WORKFLOW_DIR_MISSING:${WORKFLOW_DIR}`] };

  for (const name of readdirSync(directory).filter((item) => /\.ya?ml$/i.test(item)).sort()) {
    const path = join(directory, name);
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const action = actionReference(lines[index]);
      if (action == null) continue;
      if (action.startsWith("./")) continue;
      if (action.startsWith("docker://")) {
        if (!DOCKER_DIGEST.test(action)) failures.push(`WORKFLOW_DOCKER_ACTION_NOT_DIGEST_PINNED:${name}:${index + 1}:${action}`);
        continue;
      }
      const separator = action.lastIndexOf("@");
      const reference = separator < 0 ? "" : action.slice(separator + 1);
      if (!SHA40.test(reference)) failures.push(`WORKFLOW_ACTION_NOT_SHA_PINNED:${name}:${index + 1}:${action}`);
    }
  }
  return { ok: failures.length === 0, failures };
}

if (require.main === module) {
  const result = validateWorkflowActionPins();
  if (!result.ok) {
    console.error("Workflow action pin validation FAILED");
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("Workflow action pin validation PASS");
}

module.exports = { WORKFLOW_DIR, actionReference, validateWorkflowActionPins };
