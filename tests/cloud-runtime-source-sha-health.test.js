const assert = require("node:assert/strict");
const { test } = require("node:test");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { startCloudRuntime } = require("../dist/apps/cloud/src/runtime.js");

test("the production runtime publishes the build commit it was started with on /health", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-source-sha-"));
  const sha = "fedcba9876543210fedcba9876543210fedcba98";
  let handle;
  try {
    handle = startCloudRuntime({
      NUSA_CLOUD_STATE_DB_PATH: join(directory, "state.sqlite"),
      NUSA_CLOUD_DASHBOARD_PORT: "42987",
      NUSA_CLOUD_DASHBOARD_TOKEN: ["source", "sha", "health", "fixture", "token", "0123456789"].join("-"),
      NUSA_SOURCE_COMMIT_SHA: sha,
    });
    let body;
    for (let attempt = 0; attempt < 50 && body === undefined; attempt += 1) {
      try { body = await (await fetch("http://127.0.0.1:42987/health")).json(); } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    assert.equal(body.runtime.sourceCommitSha, sha);
  } finally {
    if (handle) await handle.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});
