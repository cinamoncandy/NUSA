const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflowPath = path.resolve(__dirname, "../.github/workflows/ci.yml");

const readWorkflow = () => fs.readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");

test("CI runs once for agent PR changes and still validates main", () => {
  const workflow = readWorkflow();
  const triggerBlock = workflow.slice(0, workflow.indexOf("permissions:"));

  assert.match(triggerBlock, /push:\n\s+branches: \[main\]/);
  assert.match(triggerBlock, /pull_request:\n\s+branches: \[main\]/);
  assert.doesNotMatch(triggerBlock, /agent\/\*\*/);
  assert.match(triggerBlock, /workflow_dispatch:/);
});

test("CI cancels obsolete PR runs but preserves main verification", () => {
  const workflow = readWorkflow();
  assert.match(workflow, /group: ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/);
  assert.match(workflow, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
});
