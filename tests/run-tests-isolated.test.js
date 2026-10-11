const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, symlinkSync, writeFileSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

test("invalid checked-in shard cost evidence leaves a durable isolated-test diagnostic", () => {
  const root = mkdtempSync(join(tmpdir(), "nusa-invalid-shard-cost-"));
  try {
    symlinkSync(resolve("tests"), join(root, "tests"));
    const shim = join(root, "invalid-cost-profile.cjs");
    writeFileSync(shim, `
      const Module = require("node:module");
      const originalLoad = Module._load;
      Module._load = function(request, parent, isMain) {
        if (request === "./lib/deterministic-test-shard-costs.json") {
          return { schemaVersion: 1, sourceRuns: [], defaultDurationMs: 0, costsMs: { "bad.test.js": 0 } };
        }
        return originalLoad.call(this, request, parent, isMain);
      };
    `);
    const runner = resolve("scripts/run-tests-isolated.js");
    const result = spawnSync(process.execPath, ["--require", shim, runner], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(readFileSync(join(root, "isolated-test-failure.txt"), "utf8"), /^INVALID_TEST_SHARD_COST_EVIDENCE /);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
