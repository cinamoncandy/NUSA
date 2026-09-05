const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { validateRepositoryTruth } = require("../scripts/validate-repository-truth.js");

const BASE_COMMIT = "a".repeat(40);

function write(root, relativePath, content = "") {
  const path = join(root, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "nusa-repository-truth-"));
  write(root, "README.md", `# NUSA\n\n## Cloud PAPER runtime\n\nRun with pnpm cloud:runtime.\n\nAuthority remains liveAuthority NONE and productionMutationAllowed false.\n`);
  write(root, "docs/NEXT_TASK.md", `# Next Task\n\n### WO-0031: canonical strategy research promotion architecture\n\nWO-0031 has one canonical research-promotion authority.\n\nThe evidence manifest owns evidence integrity, provenance, and immutable linkage only. The promotion-gate runner plus independent verifier own the only researchDecision. strategy-research-scorecard.js remains compatibility/readiness only and must not emit, own, or imply an independent research-promotion decision.\n`);
  write(root, "package.json", JSON.stringify({ scripts: {
    "cloud:runtime": "pnpm run build && node scripts/start-cloud-runtime.js",
    "architecture:truth": "node scripts/validate-repository-truth.js"
  } }));
  write(root, "scripts/start-cloud-runtime.js", `const child = "dist/apps/cloud/src/closedLearningProductionRuntime.js";\nvoid child;\n`);
  for (const path of ["apps/cloud/src/runtime.ts", "apps/cloud/src/closedLearningProductionRuntime.ts", "apps/cloud/src/server.ts", "apps/cloud/src/cloudRuntimeConfig.ts"]) write(root, path);
  write(root, ".aipos/work-orders/WO-AI-009-governed-outcome-attribution-learning.yaml", `id: WO-AI-009\nstatus: PLANNED\nverification:\n  result: PASS\nplanning_gate:\n  status: MERGED\n  exact_head: ${"b".repeat(40)}\n  merge_commit: ${"c".repeat(40)}\nimplementation_gate:\n  status: NOT_STARTED\n`);
  write(root, ".aipos/evidence/WO-AI-003-completion.json", "{}\n");
  write(root, ".aipos/current-mission.yaml", `id: WO-AI-004\ntitle: Outcome-Linked Calibration Engine\nstatus: IN_PROGRESS\n`);
  write(root, ".aipos/state.yaml", `version: 1\nbase_commit: ${BASE_COMMIT}\nverified_state:\n  work_order: WO-AI-003\n  status: COMPLETED\n  evidence: .aipos/evidence/WO-AI-003-completion.json\nin_progress:\n  - id: WO-AI-004\nverification:\n  current_commit: verified baseline remains evidence-bound\nrestricted_live_authority:\n  credential_execution_use: prohibited\n  real_money_execution: prohibited\n`);
  return root;
}

function validate(root, isAncestor = () => true) {
  return validateRepositoryTruth(root, { isAncestor });
}

test("repository truth accepts a wired Cloud runtime with evidence-bound AIPOS state", () => {
  const root = fixture();
  try {
    assert.deepEqual(validate(root), { ok: true, failures: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repository truth rejects the obsolete unwired Cloud README claim", () => {
  const root = fixture();
  try {
    write(root, "README.md", `# NUSA\n\n## Cloud PAPER runtime\n\nRun with pnpm cloud:runtime.\nNot currently deployed or wired into a running process.\nliveAuthority NONE; productionMutationAllowed false.\n`);
    const result = validate(root);
    assert.equal(result.ok, false);
    assert.equal(result.failures.some((failure) => failure.startsWith("README_STALE_RUNTIME_CLAIM:")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repository truth rejects stale WO-0031 parallel-authority wording", () => {
  const root = fixture();
  try {
    write(root, "docs/NEXT_TASK.md", `# Next Task\n\n### WO-0031\n\nWO-0031 has one canonical research-promotion authority. strategy-research-scorecard.js must not emit, own, or imply an independent research-promotion decision.\n\nstrategy research promotion gate (parallel second layer)\nTwo WO-0031 layers now exist on this branch and neither has been removed.\nConsolidating onto one is an open owner decision.\n`);
    const result = validate(root);
    assert.equal(result.ok, false);
    assert.equal(result.failures.some((failure) => failure.startsWith("NEXT_TASK_STALE_WO0031_CLAIM:")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repository truth rejects a WO-AI-009 gate that still claims merged planning is blocked", () => {
  const root = fixture();
  try {
    write(root, ".aipos/work-orders/WO-AI-009-governed-outcome-attribution-learning.yaml", `id: WO-AI-009\nstatus: PLANNED\nverification:\n  result: PENDING\nplanning_gate:\n  status: OPEN_PENDING_EXACT_HEAD_VALIDATION\nimplementation_gate:\n  status: BLOCKED_UNTIL_PLANNING_MERGED\n`);
    const result = validate(root);
    assert.equal(result.ok, false);
    assert.equal(result.failures.includes("WO_AI_009_PLANNING_GATE_NOT_MERGED:OPEN_PENDING_EXACT_HEAD_VALIDATION"), true);
    assert.equal(result.failures.includes("WO_AI_009_PLANNING_VERIFICATION_NOT_PASS"), true);
    assert.equal(result.failures.includes("WO_AI_009_IMPLEMENTATION_GATE_STALE_BLOCK"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repository truth rejects completion state that still says verification is pending", () => {
  const root = fixture();
  try {
    const statePath = join(root, ".aipos/state.yaml");
    const source = require("node:fs").readFileSync(statePath, "utf8");
    writeFileSync(statePath, source.replace("verified baseline remains evidence-bound", "completion bookkeeping pending exact-head verification"));
    const result = validate(root);
    assert.equal(result.ok, false);
    assert.equal(result.failures.includes("AIPOS_VERIFIED_STATE_CONTRADICTS_PENDING_WORDING"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repository truth rejects a base commit that is not an ancestor of HEAD", () => {
  const root = fixture();
  try {
    const result = validate(root, () => false);
    assert.equal(result.ok, false);
    assert.equal(result.failures.includes(`AIPOS_BASE_COMMIT_NOT_ANCESTOR:${BASE_COMMIT}`), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repository truth rejects a current mission that is not an in-progress work order", () => {
  const root = fixture();
  try {
    write(root, ".aipos/current-mission.yaml", `id: EP06-012-coverage-baseline\nstatus: COMPLETE\n`);
    const result = validate(root);
    assert.equal(result.ok, false);
    assert.equal(result.failures.includes("AIPOS_CURRENT_MISSION_DRIFT:EP06-012-coverage-baseline"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
