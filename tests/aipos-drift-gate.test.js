const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { dirname, join } = require("node:path");
const { validateRepository } = require("../scripts/validate-aipos-drift.js");

function write(root, relativePath, content) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function fixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "nusa-aipos-drift-"));
  const files = {
    ".aipos/architecture.md": "# Architecture\n",
    ".aipos/AI_HANDOFF_CONTRACT.md": "# Handoff\n",
    "docs/NUSA_CORE_ARCHITECTURE_PRINCIPLE.md": "# Core\n",
    "docs/NUSA_AI_ARCHITECTURE_V1.md": "# AI\n",
    ".aipos/aipos.yaml": `version: "1.1-draft"\npaths:\n  architecture: .aipos/architecture.md\n  core_architecture_principle: docs/NUSA_CORE_ARCHITECTURE_PRINCIPLE.md\n  ai_architecture: docs/NUSA_AI_ARCHITECTURE_V1.md\n  handoff_contract: .aipos/AI_HANDOFF_CONTRACT.md\n  state: .aipos/state.yaml\n  work_orders: .aipos/work-orders\narchitecture_sync:\n  enabled: true\n  direction: architecture_to_aipos\n  silent_reverse_mutation: prohibited\n  require_impact_analysis: true\n`,
    ".aipos/state.yaml": `version: 1\nactive_branch: agent/p0-a-architecture-aipos-drift-gate\nin_progress:\n  - id: WO-0020\nnext:\n  work_order: .aipos/work-orders/WO-0020.yaml\n`,
    ".aipos/work-orders/WO-0020.yaml": `id: WO-0020\nstatus: IN_PROGRESS\nimplementation_branch: agent/p0-a-architecture-aipos-drift-gate\narchitecture_impact:\n  acknowledged: true\n  analysis: "Enforces existing architecture synchronization rules."\n  references:\n    - docs/NUSA_CORE_ARCHITECTURE_PRINCIPLE.md\n`
  };
  for (const [path, content] of Object.entries({ ...files, ...overrides })) {
    if (content !== null) write(root, path, content);
  }
  return root;
}

function withFixture(overrides, callback) {
  const root = fixture(overrides);
  try {
    callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("valid synchronized Architecture/AIPOS state passes", () => {
  withFixture({}, (root) => {
    const result = validateRepository(root);
    assert.equal(result.ok, true, result.failures.join("\n"));
    assert.deepEqual(result.failures, []);
  });
});

test("non-LIVE successor may run while the constitutional gate remains registered", () => {
  withFixture({
    ".aipos/state.yaml": `version: 1\nactive_branch: agent/p0-a-architecture-aipos-drift-gate\nin_progress:\n  - id: WO-0051\n  - id: WO-0020\nserialized_human_environment_gate:\n  work_order: WO-0051\nnext:\n  work_order: .aipos/work-orders/WO-0020.yaml\n`
  }, (root) => {
    const result = validateRepository(root);
    assert.equal(result.ok, true, result.failures.join("\n"));
  });
});

test("missing governing architecture path fails closed", () => {
  withFixture({ "docs/NUSA_AI_ARCHITECTURE_V1.md": null }, (root) => {
    const result = validateRepository(root);
    assert.equal(result.ok, false);
    assert.ok(result.failures.includes("MISSING_PATH:docs/NUSA_AI_ARCHITECTURE_V1.md"));
  });
});

test("disabled architecture-to-AIPOS synchronization fails", () => {
  withFixture({
    ".aipos/aipos.yaml": `paths:\n  architecture: .aipos/architecture.md\n  core_architecture_principle: docs/NUSA_CORE_ARCHITECTURE_PRINCIPLE.md\n  ai_architecture: docs/NUSA_AI_ARCHITECTURE_V1.md\n  handoff_contract: .aipos/AI_HANDOFF_CONTRACT.md\n  state: .aipos/state.yaml\n  work_orders: .aipos/work-orders\narchitecture_sync:\n  enabled: false\n  direction: architecture_to_aipos\n  silent_reverse_mutation: prohibited\n  require_impact_analysis: true\n`
  }, (root) => {
    const result = validateRepository(root);
    assert.ok(result.failures.includes("ARCHITECTURE_SYNC_DISABLED"));
  });
});

test("state and work-order branch identity drift fails", () => {
  withFixture({
    ".aipos/state.yaml": `active_branch: agent/wrong-branch\nin_progress:\n  - id: WO-0020\nnext:\n  work_order: .aipos/work-orders/WO-0020.yaml\n`
  }, (root) => {
    const result = validateRepository(root);
    assert.ok(result.failures.some((failure) => failure.startsWith("ACTIVE_BRANCH_DRIFT:")));
  });
});

test("state pointing at a different active work-order identity fails", () => {
  withFixture({
    ".aipos/state.yaml": `active_branch: agent/p0-a-architecture-aipos-drift-gate\nin_progress:\n  - id: WO-9999\nnext:\n  work_order: .aipos/work-orders/WO-0020.yaml\n`
  }, (root) => {
    const result = validateRepository(root);
    assert.ok(result.failures.some((failure) => failure.startsWith("STATE_WORK_ORDER_ID_DRIFT:")));
  });
});

test("unacknowledged architecture impact fails", () => {
  withFixture({
    ".aipos/work-orders/WO-0020.yaml": `id: WO-0020\nstatus: IN_PROGRESS\nimplementation_branch: agent/p0-a-architecture-aipos-drift-gate\narchitecture_impact:\n  acknowledged: false\n  analysis: "Present but not acknowledged."\n  references:\n    - docs/NUSA_CORE_ARCHITECTURE_PRINCIPLE.md\n`
  }, (root) => {
    const result = validateRepository(root);
    assert.ok(result.failures.includes("ARCHITECTURE_IMPACT_NOT_ACKNOWLEDGED"));
  });
});

test("missing architecture impact reference fails", () => {
  withFixture({
    ".aipos/work-orders/WO-0020.yaml": `id: WO-0020\nstatus: IN_PROGRESS\nimplementation_branch: agent/p0-a-architecture-aipos-drift-gate\narchitecture_impact:\n  acknowledged: true\n  analysis: "Acknowledged."\n  references:\n    - docs/DOES_NOT_EXIST.md\n`
  }, (root) => {
    const result = validateRepository(root);
    assert.ok(result.failures.includes("ARCHITECTURE_IMPACT_REFERENCE_MISSING:docs/DOES_NOT_EXIST.md"));
  });
});
