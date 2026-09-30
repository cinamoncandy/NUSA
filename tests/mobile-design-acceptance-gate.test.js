const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

test("Android UX workflow emits exact-head screenshot evidence rather than claiming design PASS", () => {
  const workflow = read(".github/workflows/android-product-ux-acceptance.yml");
  assert.match(workflow, /screenshot-manifest\.json/);
  assert.match(workflow, /screenshots\.sha256/);
  assert.match(workflow, /automatedVerdict: "STRUCTURAL_ONLY"/);
  assert.match(workflow, /visual_verdict=REQUIRES_INDEPENDENT_DESIGN_ACCEPTANCE/);
  assert.match(workflow, /grep -q "live-ready-monitor"/);
  assert.match(workflow, /paper-learning-detail-toggle/);
  assert.match(workflow, /paper-learning-timeline/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.match(workflow, /baseSha: process\.env\.BASE_SHA \|\| null/);
});

test("independent Android design acceptance is exact-head and screenshot-bound", () => {
  const workflow = read(".github/workflows/android-design-acceptance.yml");
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(workflow, /screenshot base mismatch/);
  assert.match(workflow, /Android Product UX Acceptance/);
  assert.match(workflow, /android-product-ux-\$EXPECTED_HEAD/);
  assert.match(workflow, /sha256sum -c screenshots\.sha256/);
  assert.match(workflow, /SAME_PRODUCT_FAMILY/);
  assert.match(workflow, /nusa\/design-accepted/);
  assert.match(workflow, /statuses: write/);
});

test("deterministic release refuses presentation changes without exact-head DESIGN_ACCEPTED", () => {
  const workflow = read(".github/workflows/autopilot-deterministic-audit-release.yml");
  assert.match(workflow, /design_required/);
  assert.match(workflow, /Android Product UX Acceptance/);
  assert.match(workflow, /nusa\/design-accepted/);
  assert.match(workflow, /Android Design Acceptance/);
  assert.match(workflow, /Release re-verified exact-head DESIGN_ACCEPTED/);
});

test("first design-gate introduction has a one-time fail-closed bootstrap and no persistent bypass", () => {
  const workflow = read(".github/workflows/autopilot-deterministic-audit-release.yml");
  assert.match(workflow, /design_gate_bootstrap=false/);
  assert.match(workflow, /Design gate bootstrap cannot authorize a visual PR/);
  assert.match(workflow, /contents\/\.github\/workflows\/android-design-acceptance\.yml\?ref=\$current_main/);
  assert.match(workflow, /contents\/\.github\/workflows\/android-design-acceptance\.yml\?ref=\$REQUESTED_HEAD/);
  assert.match(workflow, /Design gate bootstrap cannot authorize a visual PR/);
  assert.match(workflow, /Release refuses design-gate bootstrap/);
  assert.doesNotMatch(workflow, /Release re-verified one-time design-gate bootstrap/);
});
