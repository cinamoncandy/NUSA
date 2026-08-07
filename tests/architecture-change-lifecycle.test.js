const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateLifecycle } = require("../scripts/validate-architecture-change-lifecycle.js");

const GOVERNED = "docs/NUSA_AI_ARCHITECTURE_V1.md";
const CORE = "docs/NUSA_CORE_ARCHITECTURE_PRINCIPLE.md";

function governance() {
  return {
    version: 1,
    lifecycle: ["PROPOSAL", "IMPACT_ANALYSIS", "ARCHITECTURE_REVIEW", "MIGRATION_PLAN", "APPROVAL", "STAGED_ADOPTION", "VERIFICATION", "ROLLBACK"],
    minimum_stage_for_governing_architecture_mutation: "APPROVAL",
    governed_paths: [CORE, GOVERNED, ".aipos/architecture.md"],
    constitutional_paths: [CORE],
    protected_boundaries: ["human_live_authority"],
    rules: {
      architecture_to_aipos_only: true,
      rollback_plan_required_before_approval: true,
      human_approval_required_for_constitutional_or_safety_sensitive_change: true,
      missing_or_invalid_change_record_fails_closed: true
    }
  };
}

function approvedRecord(overrides = {}) {
  const record = {
    version: 1,
    id: "ARCH-0001",
    title: "Test architecture change",
    stage: "APPROVAL",
    proposal: { status: "COMPLETE", summary: "Propose a governed change." },
    impact_analysis: {
      status: "COMPLETE",
      affected_paths: [GOVERNED],
      affected_capabilities: ["REGIME_DETECTION"],
      safety_sensitive: false,
      constitutional_change: false,
      protected_boundaries: [],
      analysis: "No production authority is changed."
    },
    architecture_review: { status: "APPROVED", decision: "APPROVED", reviewers: ["architecture-reviewer"], evidence_refs: ["review:1"] },
    migration_plan: { status: "COMPLETE", compatibility: "backward-compatible", steps: ["stage candidate", "verify consumers"] },
    approval: { status: "APPROVED", authority_type: "GOVERNANCE", approved_by: ["architecture-authority"], evidence_refs: ["approval:1"] },
    staged_adoption: { status: "PENDING", stages: ["shadow", "paper"] },
    verification: { status: "PENDING", criteria: ["contract tests pass"], evidence_refs: [] },
    rollback: { status: "READY", triggers: ["verification failure"], procedure: ["restore previous architecture version"] },
    history: [
      { stage: "PROPOSAL", status: "COMPLETE", observed_at: "2026-08-07T01:00:00Z" },
      { stage: "IMPACT_ANALYSIS", status: "COMPLETE", observed_at: "2026-08-07T01:01:00Z" },
      { stage: "ARCHITECTURE_REVIEW", status: "APPROVED", observed_at: "2026-08-07T01:02:00Z", evidence_refs: ["review:1"] },
      { stage: "MIGRATION_PLAN", status: "COMPLETE", observed_at: "2026-08-07T01:03:00Z" },
      { stage: "APPROVAL", status: "APPROVED", observed_at: "2026-08-07T01:04:00Z", evidence_refs: ["approval:1"] }
    ]
  };
  return Object.assign(record, overrides);
}

function fixture(records = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-arch-lifecycle-"));
  fs.mkdirSync(path.join(root, ".aipos", "architecture-changes"), { recursive: true });
  fs.writeFileSync(path.join(root, ".aipos", "architecture-governance.json"), JSON.stringify(governance(), null, 2));
  records.forEach((record, index) => fs.writeFileSync(path.join(root, ".aipos", "architecture-changes", `ARCH-${index + 1}.json`), JSON.stringify(record, null, 2)));
  return root;
}

function cleanup(root) { fs.rmSync(root, { recursive: true, force: true }); }

test("no governed architecture mutation passes without a change record", () => {
  const root = fixture();
  try { assert.equal(validateLifecycle({ repoRoot: root, changedPaths: ["packages/core/src/index.ts"] }).ok, true); }
  finally { cleanup(root); }
});

test("governed architecture mutation without an approved record fails closed", () => {
  const root = fixture();
  try {
    const result = validateLifecycle({ repoRoot: root, changedPaths: [GOVERNED] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes(`GOVERNED_PATH_CHANGE_WITHOUT_APPROVAL:${GOVERNED}`));
  } finally { cleanup(root); }
});

test("approved lifecycle record covering the governed path passes", () => {
  const root = fixture([approvedRecord()]);
  try { assert.equal(validateLifecycle({ repoRoot: root, changedPaths: [GOVERNED] }).ok, true); }
  finally { cleanup(root); }
});

test("skipped lifecycle history stage fails", () => {
  const record = approvedRecord();
  record.history = record.history.filter((entry) => entry.stage !== "ARCHITECTURE_REVIEW");
  const root = fixture([record]);
  try {
    const result = validateLifecycle({ repoRoot: root, changedPaths: [GOVERNED] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("LIFECYCLE_HISTORY_STAGE_SKIPPED") || error.includes("LIFECYCLE_HISTORY_MISSING_ARCHITECTURE_REVIEW")));
  } finally { cleanup(root); }
});

test("approval without rollback readiness fails", () => {
  const record = approvedRecord();
  record.rollback = { status: "PENDING", triggers: [], procedure: [] };
  const root = fixture([record]);
  try {
    const result = validateLifecycle({ repoRoot: root, changedPaths: [GOVERNED] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("ROLLBACK_PLAN_MISSING_BEFORE_APPROVAL")));
  } finally { cleanup(root); }
});

test("safety-sensitive architecture change requires HUMAN approval", () => {
  const record = approvedRecord();
  record.impact_analysis.safety_sensitive = true;
  record.impact_analysis.protected_boundaries = ["human_live_authority"];
  const root = fixture([record]);
  try {
    const result = validateLifecycle({ repoRoot: root, changedPaths: [GOVERNED] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("HUMAN_APPROVAL_REQUIRED")));
  } finally { cleanup(root); }
});

test("constitutional path change must be explicitly classified and human-approved", () => {
  const record = approvedRecord();
  record.impact_analysis.affected_paths = [CORE];
  const root = fixture([record]);
  try {
    const result = validateLifecycle({ repoRoot: root, changedPaths: [CORE] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("CONSTITUTIONAL_PATH_NOT_CLASSIFIED")));
  } finally { cleanup(root); }
});

test("two approved records claiming the same governed mutation fail as ambiguous", () => {
  const first = approvedRecord();
  const second = approvedRecord({ id: "ARCH-0002", title: "Second overlapping change" });
  const root = fixture([first, second]);
  try {
    const result = validateLifecycle({ repoRoot: root, changedPaths: [GOVERNED] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes(`GOVERNED_PATH_CHANGE_AMBIGUOUS:${GOVERNED}`));
  } finally { cleanup(root); }
});
