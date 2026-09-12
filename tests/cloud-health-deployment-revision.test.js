"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { deployedRevision, deploymentHealthPayload, UNVERIFIED_REVISION } = require("../dist/apps/cloud/src/health/deploymentHealth.js");

/**
 * The point of this endpoint is that an operator holding no credential -- on a phone, in a
 * browser, from anywhere -- can tell which build is answering, and that an automated update can
 * check its own work. Both uses depend on the value being either an exact commit or an admission
 * that the host does not know, never something in between.
 */

const SHA = "a".repeat(40);

test("an exactly recorded commit is reported", () => {
  assert.equal(deployedRevision({ NUSA_SOURCE_COMMIT: SHA }), SHA);
  assert.equal(deployedRevision({ NUSA_SOURCE_COMMIT: ` ${SHA.toUpperCase()} ` }), SHA);
  assert.equal(deployedRevision({ GITHUB_SHA: SHA }), SHA, "a CI-built host records the same thing under a different name");
});

test("anything that is not an exact commit reports UNVERIFIED rather than being echoed", () => {
  for (const declared of ["", "   ", "main", "v10", "local-paper-build", "unknown", SHA.slice(0, 39), `${SHA}0`, "z".repeat(40), "not a sha at all"]) {
    assert.equal(
      deployedRevision({ NUSA_SOURCE_COMMIT: declared }),
      UNVERIFIED_REVISION,
      `${JSON.stringify(declared)} reached an unauthenticated response`
    );
  }
  assert.equal(deployedRevision({}), UNVERIFIED_REVISION);
});

test("a host that recorded nothing cannot be mistaken for a host running the expected build", () => {
  // The failure this prevents: a redeploy that silently did not happen, read as success.
  const expected = SHA;
  assert.notEqual(deploymentHealthPayload("2026-09-10T00:00:00.000Z", {}).deploymentRevision, expected);
  assert.notEqual(deploymentHealthPayload("2026-09-10T00:00:00.000Z", { NUSA_SOURCE_COMMIT: "main" }).deploymentRevision, expected);
});

test("health carries the standing authority invariants, so they are checkable without a credential", () => {
  const payload = deploymentHealthPayload("2026-09-10T00:00:00.000Z", { NUSA_SOURCE_COMMIT: SHA });
  assert.equal(payload.ok, true);
  assert.equal(payload.observedAt, "2026-09-10T00:00:00.000Z");
  assert.equal(payload.liveAuthority, "NONE");
  assert.equal(payload.productionMutationAllowed, false);
  assert.equal(payload.aiAuthority, "ZERO_AUTHORITY");
});

test("health discloses nothing beyond the revision and the invariants", () => {
  // An unauthenticated endpoint must not grow into a status page: every added key is published.
  const payload = deploymentHealthPayload("2026-09-10T00:00:00.000Z", {
    NUSA_SOURCE_COMMIT: SHA,
    NUSA_CLOUD_DASHBOARD_TOKEN: "must-never-appear",
    UPBIT_SECRET_KEY: "must-never-appear"
  });
  assert.deepEqual(
    Object.keys(payload).sort(),
    ["aiAuthority", "deploymentRevision", "liveAuthority", "observedAt", "ok", "passwordSignIn", "productionMutationAllowed"]
  );
  assert.equal(JSON.stringify(payload).includes("must-never-appear"), false);
});

test("the server answers /health with this payload", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "apps/cloud/src/server.ts"), "utf8");
  assert.match(source, /respond\("health", dashboardJsonResponse\(200, deploymentHealthPayload\(/);
});

test("a running server answers /health with the recorded revision, unauthenticated", async () => {
  const http = require("node:http");
  const { startCloudDashboardServer } = require("../dist/apps/cloud/src/server.js");
  const previous = process.env.NUSA_SOURCE_COMMIT;
  process.env.NUSA_SOURCE_COMMIT = SHA;
  const handle = startCloudDashboardServer({
    port: 41822,
    tokenVerifier: { ownerPrincipal: { userId: "operator", email: "operator@nusa.local", scopes: ["users:manage"] }, verify: () => undefined },
    loadDashboard: () => { throw new Error("not needed"); }
  });
  try {
    const body = await new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: handle.port, path: "/health", method: "GET", headers: { connection: "close" } }, (res) => {
        let text = "";
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, text }));
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(body.status, 200);
    const payload = JSON.parse(body.text);
    assert.equal(payload.deploymentRevision, SHA, "an operator with no credential can read which build answered");
    assert.equal(payload.liveAuthority, "NONE");
  } finally {
    await handle.stop();
    if (previous === undefined) delete process.env.NUSA_SOURCE_COMMIT; else process.env.NUSA_SOURCE_COMMIT = previous;
  }
});

test("health says whether password sign-in exists, without saying anything about an account", () => {
  // Sign-in answers the same 401 for a wrong password and a server that was never set up, so an
  // owner needs this to tell "I typed it wrong" from "nobody has run the setup script yet". It is
  // a fact about the deployment: it names no user and changes with no account's state.
  const configured = deploymentHealthPayload("2026-09-12T00:00:00.000Z", { NUSA_SOURCE_COMMIT: SHA }, true);
  const absent = deploymentHealthPayload("2026-09-12T00:00:00.000Z", { NUSA_SOURCE_COMMIT: SHA }, false);
  assert.equal(configured.passwordSignIn, "CONFIGURED");
  assert.equal(absent.passwordSignIn, "NOT_CONFIGURED");
  assert.equal(deploymentHealthPayload("2026-09-12T00:00:00.000Z", {}).passwordSignIn, "NOT_CONFIGURED", "the default must not claim a credential exists");
  for (const payload of [configured, absent]) {
    assert.equal(JSON.stringify(payload).toLowerCase().includes("user"), false, "health must not name an account");
  }
});
