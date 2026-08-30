const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const policy = fs.readFileSync(path.join(root, "docs/system-learning-freshness-policy.md"), "utf8");
const view = fs.readFileSync(path.join(root, "apps/mobile/src/systemLearningSupervisorView.tsx"), "utf8");

test("freshness policy is display-only and bounded to canonical recordedAt", () => {
  assert.match(policy, /FRESH.*24 hours/);
  assert.match(policy, /AGING.*24 hours.*72 hours/);
  assert.match(policy, /STALE.*72 hours/);
  assert.match(policy, /INSUFFICIENT.*invalid or in the future/);
  assert.match(policy, /canonical ledger record timestamp/);
  assert.match(view, /evidenceFreshness\(latest\.recordedAt, Date\.now\(\)\)/);
});

test("freshness policy preserves zero authority and is not a promotion signal", () => {
  assert.match(policy, /not confidence, quality, progress, performance, or a promotion signal/);
  assert.match(policy, /READ_ONLY/);
  assert.match(policy, /AI ZERO_AUTHORITY/);
  assert.match(policy, /liveAuthority=NONE/);
  assert.match(policy, /productionMutationAllowed=false/);
});
