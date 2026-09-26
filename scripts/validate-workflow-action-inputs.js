const { existsSync, readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const WORKFLOW_DIR = ".github/workflows";

/**
 * Some third-party actions carry a default input that is a standing liability: the workflow never
 * asks for the behaviour, but inherits it, and the day upstream changes underneath that default the
 * step fails for a reason nothing in this repository can explain.
 *
 * That is not hypothetical here. `android-actions/setup-android` defaults `packages` to
 * `'tools platform-tools'`. Google removed the deprecated standalone `tools` package from the SDK
 * repository, so every Android job began failing at setup with
 * `Warning: Failed to find package 'tools'`. Because setup is step 8 of
 * android-stable-release.yml, every later step was skipped -- including all five Firebase App
 * Distribution steps. The visible symptom was "Firebase deployment is broken" while Firebase was
 * never reached and was not at fault.
 *
 * The lesson generalises past this one action: when an action's default input can break the build
 * without the build changing, the workflow must state the value it actually wants. This guard makes
 * that a rule rather than a thing someone has to remember.
 */
const REQUIRED_INPUTS = Object.freeze([
  Object.freeze({
    action: "android-actions/setup-android",
    input: "packages",
    reason: "defaults to 'tools platform-tools'; the deprecated 'tools' package was removed upstream and fails SDK setup"
  })
]);

const indentOf = (line) => line.length - line.trimStart().length;

function actionReference(line) {
  const match = line.match(/^\s*(?:-\s*)?uses:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

/** Collect the `with:` keys belonging to the `uses:` step that starts at `index`. */
function withKeys(lines, index) {
  const stepIndent = indentOf(lines[index]);
  const keys = new Set();
  let inWith = false;
  let withIndent = -1;

  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const indent = indentOf(line);
    // A new list item or a dedent ends this step.
    if (indent <= stepIndent) break;

    if (inWith) {
      if (indent > withIndent) {
        const key = line.trim().split(":")[0].trim().replace(/^["']|["']$/g, "");
        if (key) keys.add(key);
        continue;
      }
      inWith = false;
    }
    if (/^with:\s*$/.test(line.trim())) { inWith = true; withIndent = indent; }
  }
  return keys;
}

function validateWorkflowActionInputs(root = process.cwd()) {
  const directory = join(root, WORKFLOW_DIR);
  const failures = [];
  if (!existsSync(directory)) return { ok: false, failures: [`WORKFLOW_DIR_MISSING:${WORKFLOW_DIR}`] };

  for (const name of readdirSync(directory).filter((item) => /\.ya?ml$/i.test(item)).sort()) {
    const lines = readFileSync(join(directory, name), "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const action = actionReference(lines[index]);
      if (action == null) continue;
      const bare = action.split("@")[0];
      for (const rule of REQUIRED_INPUTS) {
        if (bare !== rule.action) continue;
        if (withKeys(lines, index).has(rule.input)) continue;
        failures.push(`WORKFLOW_ACTION_INPUT_NOT_EXPLICIT:${name}:${index + 1}:${rule.action}:${rule.input}:${rule.reason}`);
      }
    }
  }
  return { ok: failures.length === 0, failures };
}

module.exports = { validateWorkflowActionInputs, REQUIRED_INPUTS };

if (require.main === module) {
  const result = validateWorkflowActionInputs();
  if (!result.ok) {
    console.error("Workflow action input validation FAILED");
    for (const failure of result.failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.log("Workflow action input validation PASS");
}
