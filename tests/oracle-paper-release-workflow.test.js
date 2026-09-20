const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const workflow = fs.readFileSync(".github/workflows/oracle-paper-release.yml", "utf8");
const wrapper = fs.readFileSync("deploy/oracle/nusa-release-step.sh", "utf8").replaceAll("\r\n", "\n");
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

test("the small PAPER host receives a sealed build instead of installing or building dependencies", () => {
  const prepare = workflow.slice(workflow.indexOf("  prepare:"), workflow.indexOf("  release:"));
  const release = workflow.slice(workflow.indexOf("  release:"));
  assert.match(prepare, /runs-on: ubuntu-latest/);
  assert.match(prepare, /pnpm install --frozen-lockfile/);
  assert.match(prepare, /pnpm run build/);
  assert.match(release, /needs: prepare/);
  assert.match(release, /runs-on: \[self-hosted, Linux, nusa-paper-host\]/);
  assert.match(release, /sha256sum --check --status/);
  assert.ok(release.indexOf("sha256sum --check --status") < release.indexOf('"$STEP" backup'));
  assert.doesNotMatch(release, /pnpm install|pnpm run build/);
});

test("the workflow runs the release verbs in the runbook's order", () => {
  // Staging precedes preflight because the runbook runs both checks from the exact release tree.
  // Activation owns switch + unit convergence + readiness + rollback as one fail-closed boundary.
  orderIn(workflow, ['"$STEP" backup', '"$STEP" stage', '"$STEP" preflight', '"$STEP" activate']);
  assert.doesNotMatch(workflow, /"\$STEP"\s+(switch|restart|readiness|rollback)\b/, "activation must not be split across workflow steps");
});

test("a release that cannot prove either runtime ready is rolled back, not left serving", () => {
  const activateStart = wrapper.indexOf("  activate)");
  const activateEnd = wrapper.indexOf("\n  rollback)", activateStart);
  const activateCase = wrapper.slice(activateStart, activateEnd);
  assert.ok(activateCase.length > 0, "activate must be an explicit wrapper case");
  orderIn(activateCase, ["atomic-deploy.js", "install_units_from_release", "enable_units", "restart_units", "oracle-readiness-check.js", "autopilot-readiness.js"]);
  assert.match(activateCase, /rollback_and_restore/, "activation failure must restore the previous release and unit set");
  assert.match(activateCase, /systemctl is-active --quiet "\$SERVICE"/);
  assert.match(activateCase, /systemctl is-active --quiet "\$AUTOPILOT_SERVICE"/);

  const rollbackHelper = wrapper.slice(wrapper.indexOf("rollback_and_restore()"), wrapper.indexOf("\n}\n", wrapper.indexOf("rollback_and_restore()")) + 2);
  orderIn(rollbackHelper, ["NUSA_DEPLOY_ACTION=rollback", "install_units_from_release", "enable_units", "restart_units"]);
  assert.doesNotMatch(wrapper, /scripts\/[a-z0-9-]*restore[a-z0-9-]*\.js/i);
  assert.doesNotMatch(rollbackHelper, /rm\s+-rf\s+\/var\/lib\/nusa|DROP\s+TABLE/i, "the failure path must not touch persistent state");
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
  for (const verb of ["backup", "preflight", "install-units", "prune", "stage", "switch", "activate", "rollback", "restart", "readiness"]) {
    assert.match(wrapper, new RegExp(`^\\s*${verb}\\)`, "m"), `${verb} must be an explicit case`);
  }
});

test("the wrapper never restages the active release", () => {
  assert.match(wrapper, /refusing to restage the active release/);
});

test("unit path resolution is nounset-safe under set -u", () => {
  const start = wrapper.indexOf("unit_in()");
  const end = wrapper.indexOf("\n}\n", start) + 2;
  const unit = wrapper.slice(start, end);
  assert.ok(unit.length > 0, "unit_in must exist");
  assert.doesNotMatch(unit, /local dir="\$1" name="\$2" path=/, "path must not expand locals in the same declaration under set -u");
  assert.match(unit, /local dir="\$1"\n\s*local name="\$2"\n\s*local path="\$\{dir\}\/deploy\/oracle\/\$\{name\}"/);
});


test("bounded release pruning preserves rollback safety and validates before deletion", () => {
  const pruneStart = wrapper.indexOf("prune_releases()");
  const pruneEnd = wrapper.indexOf("\n}\n", pruneStart) + 2;
  const prune = wrapper.slice(pruneStart, pruneEnd);
  assert.match(prune, /active_release/);
  assert.match(prune, /previous_release/);
  assert.match(wrapper, /readonly RELEASE_RETENTION=4/);
  assert.match(prune, /Validate the entire candidate set before deleting anything/);
  assert.ok(prune.indexOf("unexpected release directory name") < prune.indexOf("rm -rf --"), "validation must dominate deletion");
  assert.match(prune, /\[ "\$dir" = "\$active" \] && continue/);
  assert.match(prune, /\[ -n "\$previous" \] && \[ "\$dir" = "\$previous" \] && continue/);
  assert.doesNotMatch(prune, /\/var\/lib\/nusa|\/var\/backups\/nusa/);
});

test("the wrapper runs the exact-release validation and activation scripts", () => {
  for (const script of ["sqlite-backup.js", "host-security-validate.js", "oracle-validate.js", "atomic-deploy.js", "oracle-readiness-check.js", "autopilot-readiness.js"]) {
    assert.ok(wrapper.includes(script), `${script} must be run by the wrapper`);
    assert.ok(fs.existsSync(`scripts/${script}`), `scripts/${script} must exist`);
  }
  for (const documented of ["sqlite-backup.js", "host-security-validate.js", "oracle-validate.js", "oracle-readiness-check.js", "autopilot-readiness.js"]) {
    assert.ok(runbook.includes(documented), `${documented} must remain documented for operators`);
  }
  assert.match(runbook, /nusa-release-step activate/, "the runbook must document the atomic activation boundary");
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
