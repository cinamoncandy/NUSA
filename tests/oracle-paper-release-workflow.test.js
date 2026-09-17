const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const workflow = fs.readFileSync(".github/workflows/oracle-paper-release.yml", "utf8");
const wrapper = fs.readFileSync("deploy/oracle/nusa-release-step.sh", "utf8");
const runbook = fs.readFileSync("docs/operations/oracle-p1-008-runbook.md", "utf8");

/**
 * The Oracle PAPER host drifted behind protected main with nothing able to correct it (#1816).
 * Every step already existed as a script; what was missing was anything that ran them in the
 * runbook's order.
 *
 * The privileged work is routed through a single wrapper so sudoers grants one command instead of
 * eleven, two of which were wildcards: `tar *` can write any path on the host, and
 * `rm -rf /opt/nusa/releases/*` expanded a variable the caller controlled. These assertions cover
 * both halves -- the workflow calls the verbs in order, and the wrapper enforces what each verb is
 * allowed to do.
 */

const orderIn = (text, needles) => {
  const positions = needles.map((needle) => {
    const index = text.indexOf(needle);
    assert.ok(index > 0, `expected to find ${needle}`);
    return index;
  });
  for (let i = 1; i < positions.length; i += 1) {
    assert.ok(positions[i] > positions[i - 1], `${needles[i]} must come after ${needles[i - 1]}`);
  }
};

test("the release refuses a source that is not exact protected main", () => {
  assert.match(workflow, /Refusing stale Oracle release/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /branches\/main/);
});

test("the release requires successful exact-source CI, found by a paginated lookup", () => {
  assert.match(workflow, /has no successful canonical CI run/);
  assert.match(workflow, /--paginate/, "a first-page lookup ages out and must not be used");
  assert.match(workflow, /actions\/workflows\/ci\.yml\/runs/);
});

test("the workflow runs the release verbs in the runbook's order", () => {
  // Staging precedes preflight because the runbook runs both checks *from the release tree*,
  // which has to exist first.
  orderIn(workflow, ['"$STEP" backup', '"$STEP" stage', '"$STEP" preflight', '"$STEP" switch', '"$STEP" restart', '"$STEP" readiness']);
});

test("a release that cannot prove readiness is rolled back, not left serving", () => {
  const readiness = workflow.indexOf("Prove readiness, and roll back if it fails");
  assert.ok(readiness > 0);
  const rollbackBranch = workflow.indexOf("rolling back.", readiness);
  assert.ok(rollbackBranch > readiness, "the readiness step must have a rollback branch");
  const failurePath = workflow.slice(rollbackBranch);
  orderIn(failurePath, ['"$STEP" rollback', '"$STEP" restart', '"$STEP" readiness']);
  assert.match(failurePath, /Rollback readiness also failed/, "a failed rollback must stop, not continue");
  assert.doesNotMatch(workflow, /scripts\/[a-z0-9-]*restore[a-z0-9-]*\.js/i);
  assert.doesNotMatch(failurePath, /rm\s+-rf\s+\/var\/lib\/nusa|DROP\s+TABLE/i, "the failure path must not touch persistent state");
});

test("every privileged action goes through the one wrapper command", () => {
  const sudoCalls = workflow.match(/sudo\s+\S+/g) ?? [];
  assert.ok(sudoCalls.length > 0);
  for (const call of sudoCalls) {
    assert.match(call, /sudo\s+"\$STEP"/, `sudoers must grant one command only, found: ${call}`);
  }
  assert.match(workflow, /STEP: \/opt\/nusa\/bin\/nusa-release-step/);
});

test("the wrapper lives outside the release tree it installs", () => {
  assert.match(workflow, /STEP: \/opt\/nusa\/bin\//, "a release must not be able to rewrite the root helper");
  assert.doesNotMatch(workflow, /STEP: \/opt\/nusa\/(current|releases)/);
});

test("the wrapper validates the only caller-supplied value that reaches a path", () => {
  assert.match(wrapper, /\^\[0-9a-f\]\{40\}\$/, "the SHA is validated in the wrapper, not trusted from the caller");
  assert.match(wrapper, /release_dir\(\)/, "paths are rebuilt from the validated SHA");
  assert.match(wrapper, /set -euo pipefail/);
});

test("the wrapper refuses an unknown verb instead of doing something else", () => {
  assert.match(wrapper, /unknown verb/);
  for (const verb of ["backup", "preflight", "stage", "switch", "rollback", "restart", "readiness"]) {
    assert.match(wrapper, new RegExp(`^\\s*${verb}\\)`, "m"), `${verb} must be an explicit case`);
  }
});

test("the wrapper never restages the active release", () => {
  assert.match(wrapper, /refusing to restage the active release/);
});

test("the wrapper runs the scripts the runbook documents, from the staged release", () => {
  for (const script of ["sqlite-backup.js", "host-security-validate.js", "oracle-validate.js", "atomic-deploy.js", "oracle-readiness-check.js"]) {
    assert.ok(runbook.includes(script), `${script} is part of the documented procedure`);
    assert.ok(wrapper.includes(script), `${script} must be run by the wrapper`);
    assert.ok(fs.existsSync(`scripts/${script}`), `scripts/${script} must exist`);
  }
  assert.match(wrapper, /script_in\(\)/, "scripts are read from the release being deployed");
});

test("the release is dispatch-only and holds no repository write authority", () => {
  const on = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("permissions:"));
  assert.match(on, /workflow_dispatch:/);
  assert.doesNotMatch(on, /\bpush:/, "a production host writer must not run on every merge");
  assert.doesNotMatch(on, /schedule:/);
  assert.doesNotMatch(on, /pull_request/);
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
