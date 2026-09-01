import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflowPath = resolve(process.cwd(), ".github/workflows/autopilot-execution-consumer.yml");
const workflow = readFileSync(workflowPath, "utf8");

function jobSlice(name: string, nextName?: string): string {
  const startToken = `\n  ${name}:`;
  const start = workflow.indexOf(startToken);
  assert.notEqual(start, -1, `missing ${name} job`);
  if (!nextName) return workflow.slice(start);
  const end = workflow.indexOf(`\n  ${nextName}:`, start + startToken.length);
  assert.notEqual(end, -1, `missing ${nextName} job`);
  return workflow.slice(start, end);
}

test("PR comments cannot skip independent Audit execution", () => {
  const audit = jobSlice("audit-request", "audit-recovery");
  assert.doesNotMatch(audit, /Detect existing exact-head Audit verdict/);
  assert.doesNotMatch(audit, /steps\.existing-audit/);
  assert.match(audit, /Execute independent read-only Audit with GitHub OIDC/);
  assert.match(audit, /Bind trusted same-workflow Audit authority/);
  assert.match(audit, /auditExecutionRunId/);
  assert.match(audit, /auditExecutionAttempt/);
});

test("Release never derives Audit authority from PR comment JSON", () => {
  const release = jobSlice("release", "release-recovery");
  assert.match(release, /AUDIT_AUTHORITY: \$\{\{ needs\.audit-request\.outputs\.authority \}\}/);
  assert.match(release, /Buffer\.from\(process\.env\.AUDIT_AUTHORITY, 'base64url'\)/);
  assert.match(release, /Release Audit execution provenance mismatch/);
  assert.doesNotMatch(release, /nusa-audit-verdict/);
  assert.doesNotMatch(release, /Audit verdict JSON missing/);
  assert.doesNotMatch(release, /auditComments/);
});

test("canonical P0 #903 control-plane repair serializes repository-native Release", () => {
  const release = jobSlice("release", "release-recovery");
  assert.match(release, /open-issues-pages\.json/);
  assert.match(release, /\^P0/);
  assert.match(release, /Refs\\s\+\#903/);
  assert.match(release, /Release serialized behind canonical P0 #903 repair/);
  assert.match(release, /close\[sd\]\?/);
});

test("Audit and Release keep zero-authority fail-closed safety invariants", () => {
  const audit = jobSlice("audit-request", "audit-recovery");
  const release = jobSlice("release", "release-recovery");
  for (const source of [audit, release]) {
    assert.match(source, /liveAuthority/);
    assert.match(source, /productionMutationAllowed/);
    assert.match(source, /aiAuthority/);
    assert.match(source, /ZERO_AUTHORITY/);
  }
});
