import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(".github/workflows/autopilot-deterministic-audit-release.yml", "utf8");

test("deterministic Audit has no Cloudflare or AI merge dependency", () => {
  assert.match(workflow, /Autopilot Deterministic Audit Release/);
  assert.match(workflow, /github\.event\.client_payload\.kind == 'AUDIT_REQUEST'/);
  assert.doesNotMatch(workflow, /workers\.dev|\/audit\/execute|Workers AI|env\.AI|id-token:\s*write/);
  assert.match(workflow, /authority=DETERMINISTIC_AUDIT_PASS/);
});

test("deterministic Audit binds exact PR, protected main, canonical CI, and six required workflows", () => {
  assert.match(workflow, /pulls\/\$PR_NUMBER/);
  assert.match(workflow, /branches\/main/);
  assert.match(workflow, /current_base.*current_main/);
  assert.match(workflow, /actions\/runs\/\$WORKFLOW_RUN_ID/);
  assert.match(workflow, /\.path == "\.github\/workflows\/ci\.yml"/);
  for (const name of [
    "CI",
    "Actual PAPER Public-Market Runtime Evidence",
    "Read-only Broker Credential Integration",
    "Restricted LIVE Capability Surface Guard",
    "Restricted LIVE Transport Credential Readiness",
    "Restricted LIVE Activation Rehearsal",
  ]) assert.match(workflow, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("stale Audit requests are NO_ACTION and cannot release", () => {
  assert.match(workflow, /NO_ACTION stale\/non-releasable Audit request/);
  assert.match(workflow, /current_draft/);
  assert.match(workflow, /applicable=false/);
  assert.match(workflow, /authority=NONE/);
  assert.match(workflow, /needs\.audit\.outputs\.applicable == 'true'/);
  assert.match(workflow, /needs\.audit\.outputs\.authority == 'DETERMINISTIC_AUDIT_PASS'/);
});

test("Release re-verifies exact expected head and audited base before merge", () => {
  assert.match(workflow, /Re-verify expected head and audited base/);
  assert.match(workflow, /EXPECTED_HEAD/);
  assert.match(workflow, /AUDITED_BASE/);
  assert.match(workflow, /final_draft/);
  assert.match(workflow, /-f sha="\$EXPECTED_HEAD"/);
  assert.match(workflow, /\.merged == true/);
});

test("Release explicitly dispatches canonical main CI after a GITHUB_TOKEN merge", () => {
  assert.match(workflow, /actions:\s*write/);
  assert.match(workflow, /Start canonical post-merge main CI/);
  assert.match(workflow, /actions\/workflows\/ci\.yml\/dispatches/);
  assert.match(workflow, /-f ref=main/);
  assert.match(workflow, /merged_main/);
});

test("Release recovers bounded post-merge CI retries before directly dispatching Cloudflare Deploy", () => {
  assert.match(workflow, /Recover post-merge CI retries and dispatch Cloudflare Deploy/);
  assert.match(workflow, /does not reliably fan out through workflow_run/);
  assert.match(workflow, /actions\/runs\?head_sha=\$MERGED_MAIN&per_page=100/);
  assert.match(workflow, /\.conclusion == "success"/);
  assert.match(workflow, /rerun-failed-jobs/);
  assert.match(workflow, /failed_attempt" -ge 3/);
  assert.match(workflow, /Post-merge CI SUCCESS recovered/);
  assert.match(workflow, /actions\/workflows\/autopilot-cloudflare-deploy\.yml\/dispatches/);
  assert.match(workflow, /inputs\[head_sha\]=\$MERGED_MAIN/);
});

test("Release dispatches exact-main runtime evidence and guarded downstream release workflows after post-merge CI succeeds", () => {
  assert.match(workflow, /Dispatch exact-main runtime evidence and CI-gated downstream workflows directly/);
  assert.match(workflow, /CURRENT_MAIN=.*branches\/main/);
  assert.match(workflow, /CURRENT_MAIN.*MERGED_MAIN/);
  assert.match(workflow, /actions\/workflows\/wo-0059-actual-paper-runtime\.yml\/dispatches/);
  assert.match(workflow, /actions\/workflows\/autopilot-cloudflare-promote\.yml\/dispatches/);
  assert.match(workflow, /inputs\[head_sha\]=\$MERGED_MAIN/);
  assert.match(workflow, /actions\/workflows\/android-stable-release-trigger\.yml\/dispatches/);
  assert.doesNotMatch(workflow, /actions\/workflows\/android-stable-release\.yml\/dispatches/);
  assert.match(workflow, /actions\/workflows\/windows-desktop-stable-release\.yml\/dispatches/);
});

test("safety invariants remain fail-closed", () => {
  assert.match(workflow, /live_authority !== 'NONE'/);
  assert.match(workflow, /production_mutation_allowed !== false/);
  assert.match(workflow, /ai_authority !== 'ZERO_AUTHORITY'/);
  assert.match(workflow, /liveAuthority=NONE/);
  assert.match(workflow, /productionMutationAllowed=false/);
  assert.match(workflow, /aiAuthority=ZERO_AUTHORITY/);
});
