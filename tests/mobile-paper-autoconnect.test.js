const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const connection = require("../dist/apps/mobile/src/paperConnectionSession.js");
const { mobileApprovedSession } = require("../dist/apps/mobile/src/mobileApprovedSessionBoundary.js");

test("mobile startup restores an enrolled PAPER session without a second manual connect", () => {
  const app = read("apps/mobile/App.tsx");
  const connection = read("apps/mobile/src/paperConnectionSession.ts");
  assert.match(app, /restoreConfiguredPaperSession\(endpoint\)/);
  assert.match(app, /setStatus\(restored \? "SIGNED_IN" : "SIGNED_OUT"\)/);
  assert.match(connection, /let restoreInFlight: Promise<void> \| null = null/);
  assert.match(connection, /if \(restoreInFlight != null\) await restoreInFlight/);
  assert.match(connection, /RESTORE_RETRY_BASE_MS = 1_000/);
  assert.match(connection, /mobileApprovedSession\(\)\.shouldRetryRestore\(\)/);
  assert.match(connection, /scheduleRestoreRetry\(endpoint\)/);
});

test("clean install remains fail-closed when no canonical origin or session is available", () => {
  const app = read("apps/mobile/App.tsx");
  assert.match(app, /if \(endpoint == null\) return false/);
  assert.match(app, /setStatus\(restored \? "SIGNED_IN" : "SIGNED_OUT"\)/);
  assert.match(read("apps/mobile/src/canonicalOrigin.ts"), /DEPLOYMENT_CONFIG_PENDING/);
});

test("temporary approved-session restore failure schedules a bounded automatic retry", async () => {
  const session = mobileApprovedSession();
  const originalRestore = session.restore;
  const originalRetryable = session.shouldRetryRestore;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let restoreCalls = 0;
  global.setTimeout = (callback) => { queueMicrotask(callback); return {}; };
  global.clearTimeout = () => {};
  try {
    connection.clearConfiguredPaperEndpoint();
    session.restore = async () => {
      restoreCalls += 1;
      return restoreCalls === 1 ? null : { userId: "mobile-user", email: "mobile@example.com", scopes: ["dashboard:read", "paper:trade"] };
    };
    session.shouldRetryRestore = () => restoreCalls === 1;
    connection.setConfiguredPaperEndpoint("https://cloud.example.com");
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(restoreCalls, 2);
    assert.equal(connection.isPaperConnectionVerified("https://cloud.example.com"), true);
  } finally {
    connection.clearConfiguredPaperEndpoint();
    session.restore = originalRestore;
    session.shouldRetryRestore = originalRetryable;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});
