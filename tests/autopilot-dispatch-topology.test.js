import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("one nusa_autopilot_execution event has one effective workflow consumer", () => {
  const workflowDir = path.resolve(".github", "workflows");
  const workflows = fs.readdirSync(workflowDir)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
  const consumers = workflows.filter((name) => /types:\s*\[nusa_autopilot_execution\]/.test(fs.readFileSync(path.join(workflowDir, name), "utf8")));

  assert.deepEqual(consumers, ["autopilot-execution-consumer.yml"]);
  const canonical = fs.readFileSync(path.join(workflowDir, consumers[0]), "utf8");
  assert.match(canonical, /NUSA_CODING_RUNNER_URL/);
  assert.match(canonical, /id-token:\s*write/);
  assert.match(canonical, /DUPLICATE_EXECUTION_SUPPRESSED/);
  assert.match(canonical, /autopilot-dispatch-retry\.js/);
  assert.match(canonical, /execution-attempts\.json/);
  assert.match(canonical, /execution-summary\.json/);
});
