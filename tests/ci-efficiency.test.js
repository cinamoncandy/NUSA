const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");

test("CI shards core coverage and collects UI E2E coverage in parallel", () => {
  const workflow = read(".github/workflows/ci.yml");
  assert.doesNotMatch(workflow, /- name: UI tests\n/);
  assert.doesNotMatch(workflow, /- name: E2E tests\n/);
  assert.doesNotMatch(workflow, /- name: Full isolated test suite\n/);
  assert.match(workflow, /coverage-core:\n/);
  assert.match(workflow, /matrix:\n\s+shard: \[0, 1, 2, 3\]/);
  assert.match(workflow, /- name: Core isolated coverage shard\n[\s\S]*?run: node scripts\/run-tests-isolated\.js/);
  assert.match(workflow, /coverage-ui-e2e:\n/);
  assert.match(workflow, /- name: Collect UI and E2E coverage\n[\s\S]*?--collect-ui-e2e/);
  assert.match(workflow, /coverage:\n\s+name: coverage\n\s+needs: \[coverage-core, coverage-ui-e2e\]/);
  assert.match(workflow, /pattern: coverage-v8-core-\*/);
  assert.match(workflow, /name: coverage-ui-e2e-artifacts/);
  assert.match(workflow, /- name: Coverage baseline \(parallel collected\)\n[\s\S]*?--finalize-collected/);
  const browserInstall = workflow.indexOf("- name: Install Playwright Chromium", workflow.indexOf("coverage-ui-e2e:"));
  const collection = workflow.indexOf("- name: Collect UI and E2E coverage");
  assert.ok(browserInstall >= 0 && collection > browserInstall, "Playwright Chromium must be installed before parallel UI/E2E coverage collection");
});

test("prepared paths skip only setup already proven once by CI", () => {
  const workflow = read(".github/workflows/ci.yml");
  const pkg = JSON.parse(read("package.json"));
  const coverage = read("scripts/run-coverage.js");
  assert.match(workflow, /- name: Preflight\n\s+run: pnpm run preflight/);
  assert.ok(workflow.indexOf("- name: Preflight") < workflow.indexOf("- name: Typecheck"), "Preflight must pass before Typecheck");
  assert.ok(workflow.indexOf("- name: Typecheck") < workflow.indexOf("- name: Build"), "Typecheck must pass before Build");
  assert.equal(pkg.scripts.coverage, "node scripts/run-coverage.js");
  assert.equal(pkg.scripts["coverage:prepared"], "node scripts/run-coverage.js --prepared");
  assert.equal(pkg.scripts["release:check:prepared"], "node scripts/release-readiness.js");
  assert.match(pkg.scripts["release:check"], /preflight/);
  assert.match(pkg.scripts["release:check"], /typecheck/);
  assert.match(pkg.scripts["release:check"], /build/);
  assert.match(pkg.scripts["release:check"], /release-readiness\.js/);
  assert.match(coverage, /process\.argv\.includes\("--prepared"\)/);
  assert.match(coverage, /process\.argv\.includes\("--reuse-core-v8"\)/);
  assert.match(coverage, /process\.argv\.includes\("--collect-ui-e2e"\)/);
  assert.match(coverage, /process\.argv\.includes\("--finalize-collected"\)/);
  assert.match(coverage, /if \(!prepared\)/);
  assert.match(coverage, /run-tests-isolated\.js/);
  assert.match(coverage, /vitest\.config\.mjs/);
  assert.match(coverage, /playwrightCommand, "test"/);
});

test("CI optimization preserves critical safety gates", () => {
  const workflow = read(".github/workflows/ci.yml");
  for (const step of [
    "Security gate",
    "AI zero-authority architecture validation",
    "Restricted LIVE governance validation",
    "PAPER runtime operational verification",
    "Deployment capability scan (live trading / credential storage must be absent)",
    "Risk safety drills"
  ]) {
    assert.ok(workflow.includes(`- name: ${step}`), `missing critical CI step: ${step}`);
  }
  assert.match(workflow, /run: pnpm run release:check:prepared/);
});
