const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { runConformance } = require("../scripts/validate-aipos-cross-ai-conformance.js");

function fixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "nusa-cross-ai-"));
  mkdirSync(join(root, ".aipos", "work-orders"), { recursive: true });
  mkdirSync(join(root, ".aipos", "evidence"), { recursive: true });

  const values = {
    claimedWorkOrder: "WO-TEST",
    workOrderId: "WO-TEST",
    workOrderStatus: "IN_PROGRESS",
    activeBranch: "agent/test",
    implementationBranch: "agent/test",
    nextWorkOrderPath: ".aipos/work-orders/WO-TEST.yaml",
    nextReason: "Run deterministic conformance verification before any next work begins.",
    verifiedWorkOrder: "WO-PREV",
    verifiedEvidenceSubject: "WO-PREV",
    evidenceResult: "PASS",
    priorChatDependency: "prohibited",
    hiddenCotDependency: "prohibited",
    providerPrivateDependency: "prohibited",
    ...overrides,
  };

  const state = `version: 1
project: nusa
phase: p0-test
status: in_progress
objective: "Recover identical authoritative state from repository inputs."
base_branch: main
active_branch: ${values.activeBranch}
active_pull_request: null
claimed_state:
  work_order: ${values.claimedWorkOrder}
  status: IN_PROGRESS
verified_state:
  work_order: ${values.verifiedWorkOrder}
  status: COMPLETED
  evidence: ".aipos/evidence/WO-PREV.json"
in_progress:
  - id: ${values.claimedWorkOrder}
blocked: []
next:
  work_order: ${values.nextWorkOrderPath}
  reason: "${values.nextReason}"
verification:
  required:
    - "Cross-AI conformance validation"
    - "Full required CI"
human_authority:
  live_trading_mutation: prohibited
  architecture_override: explicit_only
continuity:
  prior_chat_dependency: ${values.priorChatDependency}
  hidden_chain_of_thought_dependency: ${values.hiddenCotDependency}
  provider_private_context_dependency: ${values.providerPrivateDependency}
`;
  writeFileSync(join(root, ".aipos", "state.yaml"), state);

  if (!values.skipWorkOrder) {
    const workOrder = `id: ${values.workOrderId}
title: "Fixture"
status: ${values.workOrderStatus}
implementation_branch: ${values.implementationBranch}
`;
    const path = join(root, ...values.nextWorkOrderPath.split("/"));
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, workOrder);
  }

  const evidence = {
    version: 1,
    subject: { type: "work_order", id: values.verifiedEvidenceSubject },
    result: values.evidenceResult,
  };
  writeFileSync(join(root, ".aipos", "evidence", "WO-PREV.json"), JSON.stringify(evidence, null, 2));
  return root;
}

test("three independent adapters converge on one canonical handoff fingerprint", () => {
  const report = runConformance(fixture());
  assert.equal(report.result, "PASS");
  assert.equal(report.adapters.length, 3);
  assert.equal(new Set(report.adapters.map((entry) => entry.fingerprint)).size, 1);
  assert.equal(report.canonicalFingerprint?.length, 64);
});

test("non-empty top-level blockers converge across all adapters", () => {
  const root = fixture();
  const statePath = join(root, ".aipos", "state.yaml");
  const state = readFileSync(statePath, "utf8").replace(
    "blocked: []",
    'blocked:\n  - "SIGNED_PRODUCTION_ARTIFACT_EXTERNAL_VERIFICATION_REQUIRED"\n  - "ACTUAL_HUMAN_ACTIVATION_CEREMONY_REQUIRED"',
  );
  writeFileSync(statePath, state);

  const report = runConformance(root);
  assert.equal(report.result, "PASS");
  assert.deepEqual(
    report.adapters.map((entry) => entry.snapshot.blockers),
    [
      ["SIGNED_PRODUCTION_ARTIFACT_EXTERNAL_VERIFICATION_REQUIRED", "ACTUAL_HUMAN_ACTIVATION_CEREMONY_REQUIRED"],
      ["SIGNED_PRODUCTION_ARTIFACT_EXTERNAL_VERIFICATION_REQUIRED", "ACTUAL_HUMAN_ACTIVATION_CEREMONY_REQUIRED"],
      ["SIGNED_PRODUCTION_ARTIFACT_EXTERNAL_VERIFICATION_REQUIRED", "ACTUAL_HUMAN_ACTIVATION_CEREMONY_REQUIRED"],
    ],
  );
});

test("contradictory claimed and active work-order identity fails closed", () => {
  const report = runConformance(fixture({ claimedWorkOrder: "WO-OTHER" }));
  assert.equal(report.result, "FAIL");
  assert.ok(report.failures.includes("ACTIVE_WORK_ORDER_ID_CONTRADICTION"));
});

test("missing active work-order path fails closed", () => {
  const report = runConformance(fixture({ skipWorkOrder: true }));
  assert.equal(report.result, "FAIL");
  assert.ok(report.failures.some((failure) => failure.startsWith("WORK_ORDER_PATH_MISSING:")));
});

test("active branch differing from work-order implementation branch fails closed", () => {
  const report = runConformance(fixture({ activeBranch: "agent/wrong" }));
  assert.equal(report.result, "FAIL");
  assert.ok(report.failures.includes("ACTIVE_BRANCH_CONTRADICTION"));
});

test("provider-private context dependency is prohibited", () => {
  const report = runConformance(fixture({ providerPrivateDependency: "required" }));
  assert.equal(report.result, "FAIL");
  assert.ok(report.failures.includes("PROVIDER_PRIVATE_CONTEXT_NOT_PROHIBITED"));
});

test("prior conversation dependency is prohibited", () => {
  const report = runConformance(fixture({ priorChatDependency: "required" }));
  assert.equal(report.result, "FAIL");
  assert.ok(report.failures.includes("PRIOR_CHAT_DEPENDENCY_NOT_PROHIBITED"));
});

test("verified evidence must prove the exact verified work order", () => {
  const report = runConformance(fixture({ verifiedEvidenceSubject: "WO-WRONG" }));
  assert.equal(report.result, "FAIL");
  assert.ok(report.failures.includes("VERIFIED_EVIDENCE_SUBJECT_CONTRADICTION"));
});

test("missing deterministic next permitted action fails closed", () => {
  const report = runConformance(fixture({ nextReason: "" }));
  assert.equal(report.result, "FAIL");
  assert.ok(report.failures.includes("NEXT_ACTION_MISSING"));
});