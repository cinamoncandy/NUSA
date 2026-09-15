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

test("credential preflight is dispatched only after exact-main deploy evidence exists", () => {
  const watchdog = read(".github/workflows/deployment-convergence-watchdog.yml");

  // Preflight is a dependent, not a peer: it refuses unless an exact-main Cloudflare Deploy run
  // has already executed both its deploy and runtime-verification steps. Dispatching it next to
  // Deploy therefore guarantees a failure about ordering rather than about credentials, and those
  // false failures spend the bounded retry budget and then surface a credential incident that is
  // not real. That false-red is the specific thing this gate exists to prevent.
  const dispatchIndex = watchdog.indexOf('"Autopilot Cloudflare Credential Preflight" \\');
  assert.ok(dispatchIndex > 0, "credential preflight dispatch not found");

  const gateIndex = watchdog.lastIndexOf(
    'if workflow_success "Autopilot Cloudflare Deploy"; then',
    dispatchIndex
  );
  assert.ok(gateIndex > 0, "credential preflight dispatch is not preceded by a deploy-success gate");

  // The gate must be the one immediately guarding this dispatch, with no intervening `fi` that
  // would close it before the dispatch is reached.
  const between = watchdog.slice(gateIndex, dispatchIndex);
  assert.ok(
    !/^\s*fi\s*$/m.test(between),
    "the nearest deploy-success gate closes before the credential preflight dispatch"
  );

  assert.match(watchdog, /Credential Preflight waits for exact-main Cloudflare Deploy success\./);
});

test("credential preflight is not dispatched in the same ungated batch as deploy", () => {
  const watchdog = read(".github/workflows/deployment-convergence-watchdog.yml");
  const deployDispatch = watchdog.indexOf('"autopilot-cloudflare-deploy.yml" \\');
  const preflightDispatch = watchdog.indexOf('"Autopilot Cloudflare Credential Preflight" \\');
  assert.ok(deployDispatch > 0 && preflightDispatch > 0);
  assert.ok(
    preflightDispatch > deployDispatch,
    "preflight must be ordered after the deploy dispatch it depends on"
  );
  // Promote is the canonical example of a correctly gated dependent. Preflight must come no
  // earlier than it, since both wait on the same deploy evidence.
  const promoteDispatch = watchdog.indexOf('"autopilot-cloudflare-promote.yml" \\');
  assert.ok(promoteDispatch > 0);
  assert.ok(
    preflightDispatch > promoteDispatch,
    "preflight is dispatched before the first deploy-gated dependent, so it is still eager"
  );
});
