"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * One owner for PAPER session restores (WO-20260924-MOBILE-PAPER-SESSION-SINGLE-OWNER).
 *
 * Every connect/double-press bug so far came from a second place starting its own restore on
 * MobileApprovedSession while paperConnectionSession was already restoring. Only the coordinator
 * (paperConnectionSession) and the bearer credential provider may start restores; UI code must go
 * through connectPaperSessionSilently / resumePaperConnection / setConfiguredPaperEndpoint.
 */

const {
  setConfiguredPaperEndpoint,
  clearConfiguredPaperEndpoint,
  connectPaperSessionSilently,
  getPaperSessionState,
} = require("../dist/apps/mobile/src/paperConnectionSession.js");
const { mobileApprovedSession } = require("../dist/apps/mobile/src/mobileApprovedSessionBoundary.js");

const ENDPOINT = "https://paper-single-owner.example.test";
const ALLOWED_RESTORE_CALLERS = new Set(["paperConnectionSession.ts", "mobileApprovedSession.ts"]);

test("no mobile UI module starts a silent restore outside the session coordinator", () => {
  const root = path.resolve(__dirname, "../apps/mobile");
  const files = [path.join(root, "App.tsx"), ...fs.readdirSync(path.join(root, "src")).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)).map((f) => path.join(root, "src", f))];
  for (const file of files) {
    if (ALLOWED_RESTORE_CALLERS.has(path.basename(file))) continue;
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\.restoreWithSilentDevice\(/, `${path.basename(file)} must use connectPaperSessionSilently, not start its own silent restore`);
  }
});

test("a silent connect supersedes an in-flight bearer restore and returns its identity", { timeout: 5_000 }, async () => {
  const session = mobileApprovedSession();
  const original = { restore: session.restore, silent: session.restoreWithSilentDevice, retry: session.shouldRetryRestore };
  let bearerCalls = 0;
  let silentCalls = 0;
  let rejectBearer;
  try {
    clearConfiguredPaperEndpoint();
    session.restore = () => { bearerCalls += 1; return new Promise((_resolve, reject) => { rejectBearer = reject; }); };
    session.restoreWithSilentDevice = async () => { silentCalls += 1; return { userId: "owner", email: "owner@example.com", scopes: [] }; };
    session.shouldRetryRestore = () => false;
    setConfiguredPaperEndpoint(ENDPOINT);
    assert.equal(bearerCalls, 1, "saving settings starts the bearer restore");
    const native = {};
    const [first, second] = await Promise.all([
      connectPaperSessionSilently(ENDPOINT, { deviceId: "device", native }),
      connectPaperSessionSilently(ENDPOINT, { deviceId: "device", native }),
    ]);
    assert.equal(silentCalls, 1, "a double press coalesces into one silent proof");
    assert.equal(first.userId, "owner");
    assert.deepEqual(second, first);
    rejectBearer(new Error("late bearer failure"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(getPaperSessionState(), "VERIFIED", "the superseded bearer failure must not undo the silent connect");
  } finally {
    clearConfiguredPaperEndpoint();
    session.restore = original.restore;
    session.restoreWithSilentDevice = original.silent;
    session.shouldRetryRestore = original.retry;
  }
});

test("connect rejects an endpoint that is not the configured one", async () => {
  clearConfiguredPaperEndpoint();
  await assert.rejects(connectPaperSessionSilently(ENDPOINT, { deviceId: "d", native: {} }), /mismatch/);
});
