const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, dirname } = require("node:path");
const { validateDeploymentBundles } = require("../scripts/validate-deployment-bundles");

function fixture(mutator) {
  const root = mkdtempSync(join(tmpdir(), "nusa-deployment-"));
  for (const path of ["config/deployment/bundles.json", "config/capabilities/registry.json"]) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(process.cwd(), path), "utf8"));
  }
  if (mutator) {
    const path = join(root, "config/deployment/bundles.json");
    const value = JSON.parse(readFileSync(path, "utf8"));
    mutator(value);
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  }
  return root;
}

function failures(mutator) {
  return validateDeploymentBundles(fixture(mutator)).failures;
}

test("committed deployment bundle registry is valid", () => {
  assert.deepEqual(validateDeploymentBundles(process.cwd()).failures, []);
});

test("runtime artifact mismatch fails closed", () => {
  assert.ok(failures((r) => { r.promotions[0].runtimeArtifactSha256 = `sha256:${"9".repeat(64)}`; }).some((x) => x.startsWith("PROMOTION_RUNTIME_ARTIFACT_MISMATCH")));
});

test("promotion artifact must match bundle artifact", () => {
  assert.ok(failures((r) => { r.promotions[0].promotionArtifactSha256 = `sha256:${"8".repeat(64)}`; }).some((x) => x.startsWith("PROMOTION_ARTIFACT_BUNDLE_MISMATCH")));
});

test("rollback cannot self-reference", () => {
  assert.ok(failures((r) => { r.bundles[1].rollbackBundleId = r.bundles[1].bundleId; }).some((x) => x.startsWith("ROLLBACK_SELF_REFERENCE")));
});

test("rollback target must exist", () => {
  assert.ok(failures((r) => { r.bundles[1].rollbackBundleId = "missing-bundle"; }).some((x) => x.startsWith("ROLLBACK_TARGET_UNKNOWN")));
});

test("rollback target must be verified", () => {
  assert.ok(failures((r) => { r.bundles[0].status = "RETIRED"; }).some((x) => x.startsWith("ROLLBACK_TARGET_NOT_VERIFIED")));
});

test("production mutation authority remains prohibited", () => {
  assert.ok(failures((r) => { r.promotions[0].productionMutationAuthorized = true; }).some((x) => x.startsWith("PRODUCTION_MUTATION_AUTHORITY_PROHIBITED")));
});

test("PROMOTE recommendation requires rollback target", () => {
  assert.ok(failures((r) => { r.promotions[0].recommendation = "PROMOTE"; delete r.bundles[1].rollbackBundleId; }).some((x) => x.startsWith("PROMOTION_ROLLBACK_TARGET_MISSING")));
});

test("canonical Release recovers a transient post-merge CI failure", () => {
  const workflow = readFileSync(join(process.cwd(), ".github/workflows/autopilot-deterministic-audit-release.yml"), "utf8");
  assert.match(workflow, /rerun-failed-jobs/);
  assert.match(workflow, /failed_attempt" -ge 3/);
  assert.match(workflow, /Post-merge CI SUCCESS recovered/);
  assert.match(workflow, /head_sha=\$MERGED_MAIN/);
});

test("deployment convergence receipt requires every exact-main proof surface", () => {
  const receipt = readFileSync(join(process.cwd(), ".github/workflows/deployment-convergence-receipt.yml"), "utf8");
  const watchdog = readFileSync(join(process.cwd(), ".github/workflows/deployment-convergence-watchdog.yml"), "utf8");
  for (const required of [
    "Autopilot Cloudflare Deploy",
    "Autopilot Cloudflare Promote",
    "Autopilot Cloudflare Runtime Proof",
    "Actual PAPER Public-Market Runtime Evidence",
    "Android Stable Release",
    "Windows Desktop Stable Release",
  ]) {
    assert.match(receipt, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(watchdog, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(receipt, /status: \$status/);
  assert.match(receipt, /liveAuthority: "NONE"/);
  assert.match(receipt, /productionMutationAllowed: false/);
  assert.match(receipt, /aiAuthority: "ZERO_AUTHORITY"/);
  assert.match(watchdog, /deployment-convergence-receipt\.yml/);
});
