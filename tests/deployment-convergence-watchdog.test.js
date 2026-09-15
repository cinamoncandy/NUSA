const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");

test("canonical watchdog is event-driven with a bounded schedule fallback", () => {
  const workflow = read(".github/workflows/deployment-convergence-watchdog.yml");
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /cron: "\*\/5 \* \* \* \*"/);
  for (const dependency of [
    "CI",
    "Autopilot Cloudflare Deploy",
    "Autopilot Cloudflare Credential Preflight",
    "Android Stable Release Trigger",
    "Android Stable Release",
  ]) assert.match(workflow, new RegExp(dependency));
});

test("exact-main evidence uses workflow-specific pagination", () => {
  const deploy = read(".github/workflows/autopilot-cloudflare-deploy.yml");
  const preflight = read(".github/workflows/autopilot-cloudflare-credential-preflight.yml");
  const watchdog = read(".github/workflows/deployment-convergence-watchdog.yml");
  assert.match(deploy, /actions\/workflows\/ci\.yml\/runs/);
  assert.match(preflight, /actions\/workflows\/autopilot-cloudflare-deploy\.yml\/runs/);
  assert.match(watchdog, /gh api --paginate/);
});

test("deploy convergence requires the deploy and runtime verification steps", () => {
  for (const path of [
    ".github/workflows/deployment-convergence-watchdog.yml",
    ".github/workflows/deployment-convergence-receipt.yml",
  ]) {
    const workflow = read(path);
    assert.match(workflow, /Deploy exact CI-verified revision to Cloudflare Workers Free-compatible runtime/);
    assert.match(workflow, /Verify deployed Worker reports the exact-head revision and fail-closed authority/);
  }
});

test("credential preflight and aggregate Android retry are fail-closed", () => {
  const watchdog = read(".github/workflows/deployment-convergence-watchdog.yml");
  const receipt = read(".github/workflows/deployment-convergence-receipt.yml");
  assert.match(watchdog, /ANDROID_TRIGGER_FAILURES/);
  assert.match(watchdog, /ANDROID_RELEASE_FAILURES/);
  assert.match(watchdog, /Autopilot Cloudflare Credential Preflight/);
  assert.match(receipt, /credential_preflight: \{ pass: \$credential_ok/);
  assert.match(receipt, /if \$main_exact && \$ci_ok && \$deploy_ok && \$promote_ok && \$runtime_proof_ok && \$credential_ok/);
});

test("no parallel Cloudflare convergence scheduler is introduced", () => {
  assert.equal(existsSync(join(process.cwd(), ".github/workflows/autopilot-cloudflare-deploy-convergence.yml")), false);
});
