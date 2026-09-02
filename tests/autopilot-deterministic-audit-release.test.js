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
  assert.match(workflow, /NO_ACTION stale Audit request/);
  assert.match(workflow, /applicable=false/);
  assert.match(workflow, /authority=NONE/);
  assert.match(workflow, /needs\.audit\.outputs\.applicable == 'true'/);
  assert.match(workflow, /needs\.audit\.outputs\.authority == 'DETERMINISTIC_AUDIT_PASS'/);
});

test("Release re-verifies exact expected head and audited base before merge", () => {
  assert.match(workflow, /Re-verify expected head and audited base/);
  assert.match(workflow, /EXPECTED_HEAD/);
  assert.match(workflow, /AUDITED_BASE/);
  assert.match(workflow, /-f sha="\$EXPECTED_HEAD"/);
  assert.match(workflow, /\.merged == true/);
});

test("safety invariants remain fail-closed", () => {
  assert.match(workflow, /live_authority !== 'NONE'/);
  assert.match(workflow, /production_mutation_allowed !== false/);
  assert.match(workflow, /ai_authority !== 'ZERO_AUTHORITY'/);
  assert.match(workflow, /liveAuthority=NONE/);
  assert.match(workflow, /productionMutationAllowed=false/);
  assert.match(workflow, /aiAuthority=ZERO_AUTHORITY/);
});
