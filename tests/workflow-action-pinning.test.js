const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { validateWorkflowActionPins } = require("../scripts/validate-workflow-action-pins.js");

function fixture(workflow) {
  const root = mkdtempSync(join(tmpdir(), "nusa-workflow-pins-"));
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, ".github", "workflows", "ci.yml"), workflow, "utf8");
  return root;
}

test("workflow action pin validator accepts immutable commit references, reusable workflows, local actions, and Docker digests", () => {
  const root = fixture(`jobs:\n  test:\n    uses: owner/repo/.github/workflows/reusable.yml@${"b".repeat(40)}\n  steps-job:\n    steps:\n      - uses: actions/checkout@${"a".repeat(40)} # v4\n      - uses: ./local-action\n      - uses: docker://registry.example/image@sha256:${"c".repeat(64)}\n`);
  try {
    const result = validateWorkflowActionPins(root);
    assert.equal(result.ok, true, result.failures.join("\n"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("workflow action pin validator rejects mutable step refs, quoted refs, and job-level reusable workflow refs", () => {
  const root = fixture("jobs:\n  reusable:\n    uses: owner/repo/.github/workflows/reusable.yml@main\n  test:\n    steps:\n      - uses: actions/checkout@v4\n      - uses: 'owner/action@main'\n");
  try {
    const result = validateWorkflowActionPins(root);
    assert.equal(result.ok, false);
    assert.equal(result.failures.some((failure) => failure.includes("actions/checkout@v4")), true);
    assert.equal(result.failures.some((failure) => failure.includes("owner/action@main")), true);
    assert.equal(result.failures.some((failure) => failure.includes("reusable.yml@main")), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("workflow action pin validator rejects mutable Docker image tags", () => {
  const root = fixture("jobs:\n  test:\n    steps:\n      - uses: docker://alpine:3.20\n");
  try {
    const result = validateWorkflowActionPins(root);
    assert.equal(result.ok, false);
    assert.equal(result.failures.some((failure) => failure.startsWith("WORKFLOW_DOCKER_ACTION_NOT_DIGEST_PINNED:")), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("current repository workflows pin every external action to an immutable reference", () => {
  const result = validateWorkflowActionPins(process.cwd());
  assert.equal(result.ok, true, result.failures.join("\n"));
});
