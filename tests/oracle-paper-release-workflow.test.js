const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const workflow = fs.readFileSync(".github/workflows/oracle-paper-release.yml", "utf8");
const runbook = fs.readFileSync("docs/operations/oracle-p1-008-runbook.md", "utf8");

/**
 * The Oracle PAPER host drifted behind protected main with nothing able to correct it (#1816).
 * Every step of the release already existed as a script; what was missing was anything that ran
 * them in the runbook's order. These assertions pin that order and the fail-closed properties,
 * because a release writer that skips a step is worse than no automation at all.
 */

const at = (needle) => {
  const index = workflow.indexOf(needle);
  assert.ok(index > 0, `workflow must contain ${needle}`);
  return index;
};

test("the release refuses a source that is not exact protected main", () => {
  assert.match(workflow, /Refusing stale Oracle release/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/, "the source must be a full commit SHA");
  assert.match(workflow, /branches\/main/);
});

test("the release requires successful exact-source CI, found by a paginated lookup", () => {
  assert.match(workflow, /has no successful canonical CI run/);
  assert.match(workflow, /--paginate/, "a first-page lookup ages out and must not be used");
  assert.match(workflow, /actions\/workflows\/ci\.yml\/runs/);
});

test("the runbook order is preserved: backup, preflight, stage, switch, restart, readiness", () => {
  const backup = at("scripts/sqlite-backup.js");
  const hostCheck = at("scripts/host-security-validate.js");
  const oracleCheck = at("scripts/oracle-validate.js");
  const stage = at("Stage the immutable release directory");
  const deploy = at("scripts/atomic-deploy.js");
  const restart = at("systemctl restart nusa.service");
  const readiness = at("scripts/oracle-readiness-check.js");
  assert.ok(backup < hostCheck, "state is backed up before anything is validated or moved");
  assert.ok(hostCheck < oracleCheck && oracleCheck < stage, "preflight precedes staging");
  assert.ok(stage < deploy, "the release is staged before the symlink moves");
  assert.ok(deploy < restart && restart < readiness, "readiness is proved after the restart");
});

test("a release that cannot prove readiness is rolled back, not left serving", () => {
  assert.match(workflow, /NUSA_DEPLOY_ACTION=rollback/);
  const readiness = at("Prove readiness, and roll back if it fails");
  const rollback = workflow.indexOf("NUSA_DEPLOY_ACTION=rollback", readiness);
  assert.ok(rollback > readiness, "rollback belongs to the readiness gate");
  assert.match(workflow, /Rollback readiness also failed/, "a failed rollback must stop, not continue");
  // Ban the behaviour, not the word: the workflow's own comment states the prohibition, so a
  // naive /restore/i match flags the very text that documents it. What must be absent is an
  // actual restore being invoked on the failure path.
  assert.doesNotMatch(workflow, /scripts\/[a-z0-9-]*restore[a-z0-9-]*\.js/i, "no restore script may run");
  assert.doesNotMatch(workflow, /sqlite3?\s+.*\.restore|VACUUM\s+INTO|pg_restore/i, "no database restore command may run");
  const failurePath = workflow.slice(readiness);
  assert.doesNotMatch(failurePath, /rm\s+-rf\s+\/var\/lib\/nusa|DROP\s+TABLE/i, "the failure path must not touch persistent state");
});

test("an active release is never restaged underneath itself", () => {
  assert.match(workflow, /Refusing to restage the active release/);
});

test("the release is dispatch-only, so it cannot fire unattended on a merge", () => {
  const on = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("permissions:"));
  assert.match(on, /workflow_dispatch:/);
  assert.doesNotMatch(on, /\bpush:/, "a production host writer must not run on every merge");
  assert.doesNotMatch(on, /schedule:/);
  assert.doesNotMatch(on, /pull_request/);
});

test("it holds no repository write authority and runs off the dedicated host label", () => {
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.match(workflow, /nusa-paper-host/);
  assert.doesNotMatch(workflow, /nusa-codex-dev/, "the development runner's contract forbids deploying");
});

test("the deployed identity and fail-closed authority are always recorded", () => {
  assert.match(workflow, /currentRelease=/);
  assert.match(workflow, /liveAuthority=NONE/);
  assert.match(workflow, /productionMutationAllowed=false/);
  assert.match(workflow, /aiAuthority=ZERO_AUTHORITY/);
});

test("every script the workflow runs exists in the repository", () => {
  for (const script of workflow.match(/scripts\/[a-z0-9-]+\.js/g) ?? []) {
    assert.ok(fs.existsSync(script), `${script} must exist`);
  }
});

test("the workflow uses the same scripts the runbook documents", () => {
  for (const script of ["sqlite-backup.js", "host-security-validate.js", "oracle-validate.js", "atomic-deploy.js", "oracle-readiness-check.js"]) {
    assert.ok(runbook.includes(script), `${script} is part of the documented procedure`);
    assert.ok(workflow.includes(script), `${script} must be run by the workflow`);
  }
});
