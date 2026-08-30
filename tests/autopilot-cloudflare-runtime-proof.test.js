const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const script = fs.readFileSync(path.join(__dirname, "..", "scripts", "verify-autopilot-cloudflare-runtime.mjs"), "utf8");
const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "autopilot-cloudflare-runtime-proof.yml"), "utf8");

test("runtime proof runs hourly away from the scheduler burst and uploads bounded evidence", () => {
  assert.equal(workflow.includes("cron: '37 * * * *'"), true);
  assert.equal(workflow.includes("NUSA_RUNTIME_PROOF_OUTPUT"), true);
  assert.equal(workflow.includes("name: Upload runtime proof evidence"), true);
  assert.equal(workflow.includes("if: always()"), true);
  assert.equal(workflow.includes("retention-days: 7"), true);
});

test("runtime proof distinguishes scheduler, receipt, and worker failures without exposing credentials", () => {
  for (const classification of ["proof_not_scheduled", "proof_scheduled_late", "worker_receipt_stale", "worker_unreachable", "proof_invalid"]) {
    assert.equal(script.includes('"' + classification + '"'), true, classification);
  }
  assert.equal(script.includes("schemaVersion: 1"), true);
  assert.equal(script.includes('liveAuthority: "NONE"'), true);
  assert.equal(script.includes("productionMutationAllowed: false"), true);
  assert.equal(script.includes('aiAuthority: "ZERO_AUTHORITY"'), true);
  assert.doesNotMatch(script, /Authorization|Bearer|cookie|secret/i);
});
