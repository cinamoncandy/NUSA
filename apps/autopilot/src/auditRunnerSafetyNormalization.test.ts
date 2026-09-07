import assert from "node:assert/strict";
import test from "node:test";
import { validateAuditModelVerdict } from "./auditRunner";

test("normalizes semantic audit safety enum casing without weakening fail-closed values", () => {
  const pass = validateAuditModelVerdict({
    verdict: "PASS",
    findings: [],
    blockers: [],
    safetyInvariantResult: " pass ",
  });
  assert.equal(pass.safetyInvariantResult, "PASS");

  const fail = validateAuditModelVerdict({
    verdict: "FAIL",
    findings: [{
      code: "SAFETY_REGRESSION",
      severity: "BLOCKER",
      message: "safety invariant regressed",
      evidenceRef: "a.ts:+1",
    }],
    blockers: ["safety invariant regressed"],
    safetyInvariantResult: " fail ",
  });
  assert.equal(fail.safetyInvariantResult, "FAIL");
  assert.equal(fail.verdict, "FAIL");

  assert.throws(() => validateAuditModelVerdict({
    verdict: "PASS",
    findings: [],
    blockers: [],
    safetyInvariantResult: "UNKNOWN",
  }), /AUDIT_VERDICT_SAFETY_INVALID/);
});
