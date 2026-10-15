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
  assert.ok(app.includes('setStatus(restored || getConfiguredPaperEndpoint() != null ? "SIGNED_IN" : "SIGNED_OUT")'));
  assert.match(connection, /let restoreInFlight: Promise<void> \| null = null/);
  assert.match(connection, /if \(restoreInFlight != null\) await restoreInFlight/);
  assert.match(connection, /RESTORE_RETRY_BASE_MS = 1_000/);
  assert.match(connection, /mobileApprovedSession\(\)\.shouldRetryRestore\(\)/);
  assert.match(connection, /scheduleRestoreRetry\(endpoint, force, silent\)/);
});

test("clean install remains fail-closed while a configured device stays in the recovery shell", () => {
  const app = read("apps/mobile/App.tsx");
  assert.match(app, /if \(endpoint == null\) return false/);
  assert.ok(app.includes('setStatus(restored || getConfiguredPaperEndpoint() != null ? "SIGNED_IN" : "SIGNED_OUT")'));
  assert.match(read("apps/mobile/src/canonicalOrigin.ts"), /DEPLOYMENT_CONFIG_PENDING/);
});


test("initial PAPER projection resolves immediately after the first canonical refresh", () => {
  const app = read("apps/mobile/App.tsx");
  assert.ok(app.includes('void refresh().catch(() => undefined).finally(() => { setInitialPaperProjectionResolved(true); scheduleNext(); });'));
  // The shell no longer waits behind a full-screen gate; the pending projection is masked instead.
  assert.ok(!app.includes('if (!initialPaperProjectionResolved) return'));
  assert.ok(app.includes('const paperProjectionPending = !initialPaperProjectionResolved;'));
  assert.ok(app.includes('const notConfigured = graceNotConfigured(!paperProjectionPending && operations.status === "NOT_CONFIGURED" ? operations.reason : null, resumingQuietly);'));
  assert.ok(app.includes('const readOnlyError = !paperProjectionPending && operations.status === "UNAVAILABLE"'));
  assert.ok(app.includes('operations.failure == null'));
  assert.ok(app.includes('operations.failure.category'));
  assert.ok(app.includes('operations.failure.route'));
  assert.ok(app.includes('const paperLearningServerSource = paperProjectionPending ? "PROJECTION_ABSENT" as const'));
  assert.ok(app.includes('if (active) setStatus("SIGNED_IN");'), "a configured endpoint opens the shell before the network restore settles");
  for (const key of ["shadowReason", "realReason", "unavailableReason"]) assert.match(app, new RegExp(`${key}=\\{[^}]*paperProjectionPending \\? PENDING_REASON`));
  assert.ok(!app.includes("로컬 상태 확인 중") && !app.includes("PAPER 상태 복구 중"));
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
