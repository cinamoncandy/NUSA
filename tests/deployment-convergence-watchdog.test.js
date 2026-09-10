import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const watchdog = fs.readFileSync(".github/workflows/deployment-convergence-watchdog.yml", "utf8");

test("deployment convergence actively repairs exact-main credential preflight", () => {
  assert.match(watchdog, /"Credential Preflight"/);
  assert.match(watchdog, /"Autopilot Cloudflare Credential Preflight"/);
  assert.match(watchdog, /"autopilot-cloudflare-credential-preflight\.yml"/);
});

test("deployment receipt is fail-closed on exact-main credential preflight", () => {
  assert.match(
    watchdog,
    /workflow_success "Autopilot Cloudflare Credential Preflight"[\s\S]*workflow_success "Actual PAPER Public-Market Runtime Evidence"/,
  );
  assert.match(
    watchdog,
    /Convergence receipt waits for exact-main deploy, promote, runtime proof, credential preflight, PAPER runtime, and stable distribution proofs\./,
  );
});
