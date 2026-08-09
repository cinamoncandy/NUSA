const { existsSync, readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const WORKFLOW_DIR = ".github/workflows";
const SHA40 = /^[a-f0-9]{40}$/i;

function validateWorkflowActionPins(root = process.cwd()) {
  const directory = join(root, WORKFLOW_DIR);
  const failures = [];
  if (!existsSync(directory)) return { ok: false, failures: [`WORKFLOW_DIR_MISSING:${WORKFLOW_DIR}`] };

  for (const name of readdirSync(directory).filter((item) => /\.ya?ml$/i.test(item)).sort()) {
    const path = join(directory, name);
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^\s*-\s+uses:\s*([^\s#]+)/);
      if (!match) continue;
      const action = match[1];
      if (action.startsWith("./") || action.startsWith("docker://")) continue;
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

module.exports = { WORKFLOW_DIR, validateWorkflowActionPins };
