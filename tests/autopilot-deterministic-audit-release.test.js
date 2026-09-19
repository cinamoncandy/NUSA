import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(".github/workflows/autopilot-deterministic-audit-release.yml", "utf8");
const auditWorkflow = workflow.split(/\r?\n  release:\r?\n/, 1)[0];

test("Audit workflow exposes immutable dispatch identity as the GitHub run name", () => {
  assert.match(workflow, /run-name:\s*\$\{\{ github\.event\.client_payload\.dedupe_key/);
});

test("deterministic Audit has no Cloudflare or AI merge dependency", () => {
  assert.match(auditWorkflow, /Autopilot Deterministic Audit Release/);
  assert.match(auditWorkflow, /github\.event\.client_payload\.kind == 'AUDIT_REQUEST'/);
  assert.doesNotMatch(auditWorkflow, /workers\.dev|\/audit\/execute|Workers AI|env\.AI|id-token:\s*write/);
  assert.match(auditWorkflow, /authority=DETERMINISTIC_AUDIT_PASS/);
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

test("Audit waits boundedly for independent exact-head evidence convergence", () => {
  assert.match(workflow, /for poll in \$\(seq 1 30\)/);
  assert.match(workflow, /head_sha=\$REQUESTED_HEAD&event=pull_request&per_page=100/);
  assert.match(workflow, /conclusion.*!= "success"/);
  assert.match(workflow, /required_ready.*true/);
  assert.match(workflow, /bounded Audit deadline/);
});

test("stale Audit requests are NO_ACTION and cannot release", () => {
  assert.match(workflow, /NO_ACTION stale\/non-releasable Audit request/);
  assert.match(workflow, /current_draft/);
  assert.match(workflow, /current_hold/);
  assert.match(workflow, /\.labels \| type\) != "array"/);
  assert.match(workflow, /any\(\.labels\[\]; \(\.name \| ascii_downcase\) == "hold"\)/);
  assert.match(workflow, /current_draft" = "true"/);
  assert.match(workflow, /current_hold" != "false"/);
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
  assert.match(workflow, /final_hold/);
  assert.match(workflow, /test "\$final_hold" = "false"/);
  assert.match(workflow, /release_hold/);
  assert.match(workflow, /test "\$release_hold" = "false"/);
  assert.ok((workflow.match(/test "\$release_hold" = "false"/g) || []).length >= 3,
    "Release must re-check HOLD before each authority-sensitive transition");
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

test("Release recovers bounded post-merge CI and suppresses duplicate Cloudflare Deploy dispatch", () => {
  assert.match(workflow, /Recover post-merge CI retries and dispatch Cloudflare Deploy/);
  assert.match(workflow, /for poll in \$\(seq 1 40\)/);
  assert.match(workflow, /actions\/runs\?head_sha=\$MERGED_MAIN&per_page=100/);
  assert.match(workflow, /\.conclusion == "success"/);
  assert.match(workflow, /rerun-failed-jobs/);
  assert.match(workflow, /failed_attempt" -ge 3/);
  assert.match(workflow, /Post-merge CI SUCCESS recovered/);
  assert.match(workflow, /actions\/workflows\/autopilot-cloudflare-deploy\.yml\/runs\?head_sha=\$MERGED_MAIN&per_page=100/);
  assert.match(workflow, /\.status == "in_progress"/);
  assert.match(workflow, /\.status == "completed" and \.conclusion == "success"/);
  assert.match(workflow, /suppressing duplicate Release dispatch/);
  assert.match(workflow, /no active\/successful exact-main Deploy; dispatching bounded fallback/);
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


test("already-merged convergence is non-applicable for an open PR but preserves merged-provenance failure", () => {
  const convergence = fs.readFileSync(".github/workflows/autopilot-already-merged-audit-convergence.yml", "utf8");
  assert.match(convergence, /pulls\/\$PR_NUMBER/);
  assert.match(convergence, /if \[ "\$pr_state" = "open" \]/);
  assert.match(convergence, /NO_ACTION Audit convergence is not applicable to an open PR/);
  assert.match(convergence, /RELEASE_PROVENANCE_MISSING: already-merged PRs cannot be post-facto upgraded/);
  const noActionIndex = convergence.indexOf("NO_ACTION Audit convergence is not applicable to an open PR");
  const provenanceFailureIndex = convergence.indexOf("RELEASE_PROVENANCE_MISSING: already-merged PRs cannot be post-facto upgraded");
  assert.ok(noActionIndex >= 0 && provenanceFailureIndex > noActionIndex);
  assert.match(convergence.slice(provenanceFailureIndex), /exit 1/);
});
