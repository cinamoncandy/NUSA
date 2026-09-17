const { existsSync, readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const WORKFLOW_DIR = ".github/workflows";

/**
 * Evidence lookups must not read only the first page of runs.
 *
 * A gate that resolves exact-SHA evidence with an unpaginated
 * `actions/runs?head_sha=...&per_page=100` reads the 100 most recent runs across every workflow in
 * the repository. While main sits on one SHA, scheduled runs pile up against it, so a real CI or
 * deploy run falls past that window and the gate reports missing evidence for a run that exists.
 *
 * This is why it fails without anything being changed, and why it returns: the query ages out on
 * its own. On 2026-09-16 it produced a circular deadlock -- the credential preflight failed, which
 * reopened canonical P0 #1461, which serialized all Release behind that repair, which blocked the
 * pull requests carrying the repair. Android and Firebase distribution stayed broken throughout.
 *
 * Two shapes are acceptable and the rule accepts either:
 *   - paginate the query, so the whole result set is read; or
 *   - scope it to a specific workflow (`actions/workflows/<file>/runs`), where the runs for one SHA
 *     realistically fit in a page.
 *
 * Parsing is line-based to match the validators beside it, and a lookup counts as paginated when
 * `--paginate` appears on the same line or on the command's preceding line, since these calls are
 * routinely wrapped across lines.
 */

const REPO_WIDE_RUNS = /actions\/runs\?[^"']*head_sha=/;
const WORKFLOW_SCOPED = /actions\/workflows\/[^"'\/]+\/runs\?/;
const PAGINATE = /--paginate/;

function validateWorkflowRunLookups(root = process.cwd()) {
  const directory = join(root, WORKFLOW_DIR);
  const failures = [];
  if (!existsSync(directory)) return { ok: false, failures: [`WORKFLOW_DIR_MISSING:${WORKFLOW_DIR}`] };

  for (const name of readdirSync(directory).filter((item) => /\.ya?ml$/i.test(item)).sort()) {
    const lines = readFileSync(join(directory, name), "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!REPO_WIDE_RUNS.test(line)) continue;
      if (WORKFLOW_SCOPED.test(line)) continue;
      // `gh api --paginate \` then the URL on the next line is the common wrapped form.
      const previous = index > 0 ? lines[index - 1] : "";
      if (PAGINATE.test(line) || PAGINATE.test(previous)) continue;
      failures.push(`UNPAGINATED_REPOSITORY_WIDE_RUN_LOOKUP:${name}:${index + 1}`);
    }
  }
  return { ok: failures.length === 0, failures };
}

module.exports = { validateWorkflowRunLookups };

if (require.main === module) {
  const result = validateWorkflowRunLookups();
  if (!result.ok) {
    console.error("Workflow run lookup validation FAILED");
    for (const failure of result.failures) console.error(`  ${failure}`);
    console.error("  Paginate the query, or scope it to actions/workflows/<file>/runs.");
    process.exit(1);
  }
  console.log("Workflow run lookup validation PASS");
}
