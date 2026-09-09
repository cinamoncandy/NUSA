const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const workflowPath = join(process.cwd(), ".github", "workflows", "autopilot-deterministic-audit-release.yml");
const workflow = readFileSync(workflowPath, "utf8");

function position(label, needle) {
  const index = workflow.indexOf(needle);
  assert.notEqual(index, -1, `${label} must remain in canonical release workflow`);
  return index;
}

test("release authorization uses a dedicated protected GitHub App boundary", () => {
  assert.match(workflow, /environment:\s+nusa-release-authority/);
  assert.match(workflow, /uses:\s+actions\/create-github-app-token@v2/);
  assert.match(workflow, /secrets\.NUSA_RELEASE_AUTH_APP_ID/);
  assert.match(workflow, /secrets\.NUSA_RELEASE_AUTH_APP_PRIVATE_KEY/);
  assert.match(workflow, /AUTH_CONTEXT:\s+nusa\/release-authorized/);
  assert.doesNotMatch(workflow, /statuses:\s*write/,
    "generic GITHUB_TOKEN must not gain status-write authority");
});

test("authorization is exact-head, exact-base, fail-closed, and immediately rechecked", () => {
  const firstReverify = position("pre-authorization recheck", "- name: Re-verify expected head and audited base");
  const appToken = position("dedicated App token", "- name: Mint dedicated release authority token");
  const authorize = position("authorization publisher", "- name: Publish exact-head release authorization");
  const statusTarget = position("exact-head status target", 'statuses/$EXPECTED_HEAD');
  const secondReverify = position("post-authorization recheck", "- name: Re-verify authorization is still current before merge");
  const merge = position("canonical exact-head merge", "- name: Canonical expected-head merge");
  const revoke = position("failed merge revocation", "- name: Revoke authorization if exact-head merge did not complete");

  assert.ok(firstReverify < appToken && appToken < authorize && authorize <= statusTarget,
    "authorization must follow release head/base validation and dedicated App token minting");
  assert.ok(statusTarget < secondReverify && secondReverify < merge && merge < revoke,
    "authorization must be rechecked before merge and revoked on merge-path failure");

  const requiredBindings = [
    'test "$(jq -r \'.head.sha\' <<<"$pr")" = "$EXPECTED_HEAD"',
    'test "$(jq -r \'.base.ref\' <<<"$pr")" = "main"',
    'test "$(jq -r \'.base.sha\' <<<"$pr")" = "$AUDITED_BASE"',
    'test "$main" = "$AUDITED_BASE"'
  ];
  for (const binding of requiredBindings) {
    assert.ok(workflow.split(binding).length >= 3, `binding must be checked both before and after authorization: ${binding}`);
  }

  assert.match(workflow, /-f state=success/);
  assert.match(workflow, /failure\(\).*steps\.authorize\.outputs\.published == 'true'/s);
  assert.match(workflow, /-f state=failure/);
});

test("canonical release keeps PAPER and zero-authority invariants", () => {
  assert.match(workflow, /p\.live_authority !== 'NONE'/);
  assert.match(workflow, /p\.production_mutation_allowed !== false/);
  assert.match(workflow, /p\.ai_authority !== 'ZERO_AUTHORITY'/);
  assert.match(workflow, /liveAuthority=NONE/);
  assert.match(workflow, /productionMutationAllowed=false/);
  assert.match(workflow, /aiAuthority=ZERO_AUTHORITY/);
});
