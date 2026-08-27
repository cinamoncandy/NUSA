import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

const script = path.resolve("scripts/consume-autopilot-dispatch.mjs");

function run(clientPayload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-autopilot-"));
  const input = path.join(dir, "event.json");
  fs.writeFileSync(input, JSON.stringify({ client_payload: clientPayload }));
  const result = spawnSync(process.execPath, [script, input], { cwd: dir, encoding: "utf8" });
  return { dir, result };
}

const base = {
  kind: "REPOSITORY_AUTOPILOT",
  repository: "cinamoncandy/NUSA",
  head_sha: "a".repeat(40),
  workflow_run_id: null,
  reason: "continue-from:main_push",
  live_authority: "NONE",
  production_mutation_allowed: false,
  ai_authority: "ZERO_AUTHORITY",
};

describe("autopilot repository dispatch consumer", () => {
  it("accepts a bounded repository autopilot request", () => {
    const { dir, result } = run(base);
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(fs.readFileSync(path.join(dir, "artifacts/autopilot/dispatch-receipt.json"), "utf8"));
    assert.equal(receipt.accepted, true);
    assert.equal(receipt.productionMutationAllowed, false);
    assert.equal(receipt.aiAuthority, "ZERO_AUTHORITY");
  });

  it("requires workflow identity for CI recovery", () => {
    const { result } = run({ ...base, kind: "CI_RECOVERY" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AUTOPILOT_WORKFLOW_RUN_ID_REQUIRED/);
  });

  it("rejects repository, SHA, and authority drift", () => {
    for (const clientPayload of [
      { ...base, repository: "other/repo" },
      { ...base, head_sha: "not-a-sha" },
      { ...base, live_authority: "LIVE" },
      { ...base, production_mutation_allowed: true },
      { ...base, ai_authority: "WRITE" },
    ]) {
      const { result } = run(clientPayload);
      assert.notEqual(result.status, 0);
    }
  });
});
