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

test("workflow action pin validator accepts immutable commit references and local actions", () => {
  const root = fixture(`jobs:\n  test:\n    steps:\n      - uses: actions/checkout@${"a".repeat(40)} # v4\n      - uses: ./local-action\n`);
  try {
    const result = validateWorkflowActionPins(root);
    assert.equal(result.ok, true, result.failures.join("\n"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("workflow action pin validator rejects mutable major tags and branches", () => {
  const root = fixture("jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n      - uses: owner/action@main\n");
  try {
    const result = validateWorkflowActionPins(root);
    assert.equal(result.ok, false);
    assert.equal(result.failures.some((failure) => failure.includes("actions/checkout@v4")), true);
    assert.equal(result.failures.some((failure) => failure.includes("owner/action@main")), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("current repository workflows pin every external action to a full commit SHA", () => {
  const result = validateWorkflowActionPins(process.cwd());
  assert.equal(result.ok, true, result.failures.join("\n"));
});
