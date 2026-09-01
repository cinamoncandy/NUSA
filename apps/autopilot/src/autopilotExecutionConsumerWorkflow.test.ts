import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

function loadConsumerWorkflow(): string {
  const relative = ".github/workflows/autopilot-execution-consumer.yml";
  const candidates = [
    resolve(process.cwd(), relative),
    resolve(process.cwd(), "../..", relative),
    resolve(process.cwd(), "../../..", relative),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  assert.ok(path, "Autopilot Execution Consumer workflow must be resolvable from the test working directory");
  return readFileSync(path, "utf8");
}

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing workflow section: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing workflow section terminator: ${end}`);
  return source.slice(from, to);
}

describe("Autopilot Execution Consumer workflow contract", () => {
  it("executes the OIDC Audit without ambiguous CommonJS/top-level-await syntax", () => {
    const workflow = loadConsumerWorkflow();
    const auditStep = between(
      workflow,
      "- name: Execute independent read-only Audit with GitHub OIDC",
      "- name: Re-verify exact head/base/main after Audit execution",
    );

    assert.match(auditStep, /node - <<'NODE'\r?\n\s+\(async \(\) => \{/);
    assert.match(auditStep, /\}\)\(\)\.catch\(\(error\) => \{/);
    assert.match(auditStep, /await fetch\(tokenUrl/);
    assert.match(auditStep, /await fetch\(process\.env\.NUSA_AUDIT_RUNNER_URL/);
  });

  it("keeps direct recovery repository_dispatch payloads within GitHub's 10-field limit", () => {
    const workflow = loadConsumerWorkflow();
    const auditRecovery = between(workflow, "  audit-recovery:", "  release:");
    const releaseRecovery = workflow.slice(workflow.indexOf("  release-recovery:"));

    for (const section of [auditRecovery, releaseRecovery]) {
      assert.match(section, /"kind": "REPOSITORY_AUTOPILOT"/);
      assert.doesNotMatch(section, /"pr_number"\s*:/);
      assert.match(section, /"workflow_run_id"\s*:/);
      assert.match(section, /"execution_id"\s*:/);
      assert.match(section, /"dedupe_key"\s*:/);
      assert.match(section, /"live_authority": "NONE"/);
      assert.match(section, /"production_mutation_allowed": false/);
      assert.match(section, /"ai_authority": "ZERO_AUTHORITY"/);
    }
  });
});
