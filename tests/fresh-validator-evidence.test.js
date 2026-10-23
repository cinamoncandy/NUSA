import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { validateFreshValidatorEvidence } = require("../scripts/validate-fresh-validator-evidence.js");

const HEAD = "a".repeat(40), BASE = "b".repeat(40);
const evidence = (overrides = {}) => ({
  schemaVersion: 1, kind: "NUSA_FRESH_VALIDATOR_EVIDENCE", sourceWorkflow: ".github/workflows/autopilot-execution-consumer.yml",
  validatorExecutionRunId: 77, validatorExecutionAttempt: 1, repository: "cinamoncandy/NUSA", prNumber: 42,
  reviewedHeadSha: HEAD, baseSha: BASE, workflowRunId: 88, status: "VALIDATOR_COMPLETED", verdict: "PASS",
  auditAllowed: true, p0: 0, p1: 0, p2: 0, findings: [], blockers: [], safetyInvariantResult: "PASS",
  evidenceRefs: [`github:pull/42@${HEAD}`, `github:base/${BASE}`, "github:actions/runs/88", "protocol:docs/GRILL_ME_PROTOCOL.md"],
  reviewedAt: 1234, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY", ...overrides,
});
const expected = { repository: "cinamoncandy/NUSA", prNumber: 42, headSha: HEAD, baseSha: BASE, workflowRunId: 88, validatorExecutionRunId: 77, validatorExecutionAttempt: 1 };

test("accepts exact fresh validator PASS and P2-only notes", () => {
  assert.equal(validateFreshValidatorEvidence(evidence(), expected).auditAllowed, true);
  assert.equal(validateFreshValidatorEvidence(evidence({ verdict: "PASS_WITH_NOTES", p2: 1, findings: [{ code: "P2_METADATA_NOTE", severity: "NOTE", message: "note", evidenceRef: null }] }), expected).p2, 1);
});

test("fails closed on missing/stale/self-forge-relevant identity and P0/P1 blockers", () => {
  for (const [patch, code] of [
    [{ p0: 1 }, /BLOCKING_FINDINGS/],
    [{ p1: 1 }, /BLOCKING_FINDINGS/],
    [{ auditAllowed: false }, /ACCEPTANCE/],
    [{ reviewedHeadSha: "c".repeat(40) }, /PROVENANCE|HEAD_MISMATCH/],
    [{ baseSha: "c".repeat(40) }, /PROVENANCE|BASE_MISMATCH/],
    [{ validatorExecutionRunId: 76 }, /RUN_MISMATCH/],
    [{ blockers: ["x"] }, /BLOCKERS_PRESENT/],
    [{ findings: [{ code: "P1_BAD", severity: "BLOCKER", message: "bad", evidenceRef: `x` }], p2: 1, verdict: "PASS_WITH_NOTES" }, /FINDING_PRIORITY/],
  ]) assert.throws(() => validateFreshValidatorEvidence(evidence(patch), expected), code);
});
