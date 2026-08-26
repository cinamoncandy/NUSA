const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const config = fs.readFileSync(path.join(root, "config", "cloudflared", "nusa-paper.example.yml"), "utf8");
const runbook = fs.readFileSync(path.join(root, "docs", "ANDROID_PAPER_HTTPS_BRIDGE.md"), "utf8");
const runtimeConfig = fs.readFileSync(path.join(root, "apps", "cloud", "src", "cloudRuntimeConfig.ts"), "utf8");

test("Android PAPER tunnel keeps the NUSA origin loopback-only and fails unmatched ingress closed", () => {
  assert.match(config, /service: http:\/\/127\.0\.0\.1:8787/);
  assert.match(config, /- service: http_status:404/);
  assert.doesNotMatch(config, /0\.0\.0\.0/);
  assert.match(runtimeConfig, /host !== "127\.0\.0\.1" && host\.toLowerCase\(\) !== "localhost"/);
});

test("Android PAPER bridge documents trusted HTTPS without embedding the dashboard bearer", () => {
  assert.match(runbook, /https:\/\/<PAPER_HOSTNAME>/);
  assert.match(runbook, /Do not place it in the hostname, path, query string, tunnel config, DNS record, or repository/);
  assert.match(runbook, /Do not change the host to `0\.0\.0\.0`/);
  assert.match(runbook, /liveAuthority=NONE/);
  assert.match(runbook, /productionMutationAllowed=false/);
  assert.match(runbook, /ZERO_AUTHORITY/);
  assert.doesNotMatch(config, /NUSA_CLOUD_DASHBOARD_TOKEN\s*:/);
  assert.doesNotMatch(config, /Bearer\s+[A-Za-z0-9._~-]{16,}/);
});
