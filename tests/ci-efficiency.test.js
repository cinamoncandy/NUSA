const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("CI uses instrumented coverage as the single isolated/UI/E2E execution", () => {
  const workflow = read(".github/workflows/ci.yml");
  assert.doesNotMatch(workflow, /- name: UI tests\n/);
  assert.doesNotMatch(workflow, /- name: E2E tests\n/);
  assert.doesNotMatch(workflow, /- name: Full isolated test suite\n/);
  assert.match(workflow, /- name: Coverage baseline \(isolated \+ UI \+ E2E\)\n\s+run: pnpm run coverage:prepared/);
  const browserInstall = workflow.indexOf("- name: Install Playwright Chromium");
  const coverage = workflow.indexOf("- name: Coverage baseline (isolated + UI + E2E)");
  assert.ok(browserInstall >= 0 && coverage > browserInstall, "Playwright Chromium must be installed before coverage E2E execution");
});

test("prepared paths skip only setup already proven by CI", () => {
  const pkg = JSON.parse(read("package.json"));
  const coverage = read("scripts/run-coverage.js");
  assert.equal(pkg.scripts.coverage, "node scripts/run-coverage.js");
  assert.equal(pkg.scripts["coverage:prepared"], "node scripts/run-coverage.js --prepared");
  assert.equal(pkg.scripts["release:check:prepared"], "node scripts/release-readiness.js");
  assert.match(pkg.scripts["release:check"], /preflight/);
  assert.match(pkg.scripts["release:check"], /typecheck/);
  assert.match(pkg.scripts["release:check"], /build/);
  assert.match(pkg.scripts["release:check"], /release-readiness\.js/);
  assert.match(coverage, /process\.argv\.includes\("--prepared"\)/);
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
