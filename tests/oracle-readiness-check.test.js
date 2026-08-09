const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const script = path.resolve(__dirname, "..", "scripts", "oracle-readiness-check.js");

test("Oracle readiness dry-run reads the secret from file without printing it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ready-"));
  const envFile = path.join(root, "cloud-runtime.env");
  const token = "z".repeat(32);
  fs.writeFileSync(envFile, `NUSA_CLOUD_DASHBOARD_PORT=41799\nNUSA_CLOUD_DASHBOARD_HOST=127.0.0.1\nNUSA_CLOUD_DASHBOARD_TOKEN=${token}\n`, { mode: 0o640 });
  const result = spawnSync(process.execPath, [script], {
    env: { ...process.env, NUSA_DRY_RUN: "1", NUSA_ENV_FILE: envFile },
    encoding: "utf8"
  });
  try {
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, new RegExp(token));
    assert.deepEqual(JSON.parse(result.stdout), {
      status: "DRY_RUN",
      host: "127.0.0.1",
      port: 41799,
      path: "/ready",
      authenticated: true
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Oracle readiness refuses public binding and weak secrets before network access", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-ready-"));
  const envFile = path.join(root, "cloud-runtime.env");
  try {
    fs.writeFileSync(envFile, "NUSA_CLOUD_DASHBOARD_PORT=41799\nNUSA_CLOUD_DASHBOARD_HOST=0.0.0.0\nNUSA_CLOUD_DASHBOARD_TOKEN=short\n");
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, NUSA_DRY_RUN: "1", NUSA_ENV_FILE: envFile },
      encoding: "utf8"
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /readiness host must be localhost|dashboard token must be at least 32 bytes/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
