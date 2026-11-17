"use strict";
// The controller against the REAL /health of the cloud runtime (apps/cloud/src/server.ts, compiled to dist), not a hand-written fake.
// Why: on the real host (2026-11-16) the controller never parsed the runtime's answer because the real server sends it chunked, and every
// earlier test used a fake server that set content-length by hand. This test starts the real server and runs the controller's real
// host client (and a full verify) against it, so a change on either side that breaks the other fails here.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const posixOnly = process.platform !== "linux" ? { skip: "the controller identifies the sender through /proc (Linux only)" } : {};
const distServer = path.join(__dirname, "..", "dist", "apps", "cloud", "src", "server.js");
const { hostIdentifiedHealth } = require("../deploy/control/nusa-control.js");

const ownerPrincipal = Object.freeze({ userId: "operator", email: "operator@nusa.local", scopes: Object.freeze(["dashboard:read", "paper:trade", "users:manage"]) });
const base = Object.freeze({ tokenVerifier: Object.freeze({ ownerPrincipal, verify: () => undefined }), loadDashboard: () => { throw new Error("not used"); } });
const SHA = "a".repeat(40);

async function withRealServer(runtimeLiveness, run) {
  assert.ok(fs.existsSync(distServer), "dist/apps/cloud/src/server.js is missing: build first (npx tsc -p tsconfig.json)");
  const { startCloudDashboardServer } = require(distServer);
  const handle = startCloudDashboardServer({ port: 31_000 + Math.floor(Math.random() * 1000), ...base, runtimeLiveness });
  try { await run(handle); } finally { await handle.stop(); }
}

const liveness = (over = {}) => ({ startedAt: 1_000, lastHeartbeatAt: 2_000, lastMarketEventAt: Date.now() - 1_000, lastPaperDecisionAt: null, lastPaperOrderAt: null, lastPaperFillAt: null, eventCount: 42, decisionCount: 0, paperOrderCount: 0, paperFillCount: 0, lastError: null, sourceCommitSha: SHA, runMode: "COLLECT_ONLY", orderPathReady: false, ...over });

test("the controller's real client parses the real runtime /health, identifies its own process as the sender, and reads the build and the mode", posixOnly, async () => {
  await withRealServer(() => liveness(), async (handle) => {
    const r = await hostIdentifiedHealth(handle.port);
    assert.equal(r.diag.responseStatus, 200);
    assert.equal(r.diag.bodyParsed, true, `the real /health must be parsed (diag ${JSON.stringify(r.diag)})`);
    assert.ok(r.ownerPids.includes(process.pid), "the server socket is held by this (test) process");
    assert.equal(r.body.runtime.sourceCommitSha, SHA);
    assert.equal(r.body.runtime.runMode, "COLLECT_ONLY");
    assert.equal(r.body.runtime.orderPathReady, false);
  });
});

test("the real runtime /health carries every field the off-host watch and the controller read", posixOnly, async () => {
  await withRealServer(() => liveness(), async (handle) => {
    const r = await hostIdentifiedHealth(handle.port);
    const rt = r.body.runtime;
    for (const key of ["sourceCommitSha", "runMode", "orderPathReady", "paperOrderCount", "lastMarketEventAt", "startedAt"]) assert.notEqual(rt[key], undefined, `runtime.${key} is published`);
    assert.equal(typeof r.body.observedAt, "string");
    assert.equal(r.body.ok, true);
  });
});
