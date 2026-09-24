const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const connection = require("../dist/apps/mobile/src/paperConnectionSession.js");
const { mobileApprovedSession } = require("../dist/apps/mobile/src/mobileApprovedSessionBoundary.js");

// Architecture invariants for the Galaxy background report: a trusted device whose session is
// being recovered must not be projected as a setup problem. Trust, session and projection are
// separate states; only a recovery that has actually stopped may ask the owner to act.

const ENDPOINT = "https://paper-projection.example.test";

test("session recovery in flight projects RECOVERING, not setup-required", async () => {
  const session = mobileApprovedSession();
  const originalRestore = session.restore;
  let release;
  try {
    connection.clearConfiguredPaperEndpoint();
    session.restore = () => new Promise((resolve) => { release = resolve; });
    connection.setConfiguredPaperEndpoint(ENDPOINT);
    assert.equal(connection.getPaperSessionState(), "RECOVERING");
    release({ userId: "owner", email: "o@example.test", scopes: ["dashboard:read"] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(connection.getPaperSessionState(), "VERIFIED");
  } finally {
    connection.clearConfiguredPaperEndpoint();
    session.restore = originalRestore;
  }
});

test("an armed bounded retry still projects RECOVERING", async () => {
  const session = mobileApprovedSession();
  const originalRestore = session.restore;
  const originalRetryable = session.shouldRetryRestore;
  try {
    connection.clearConfiguredPaperEndpoint();
    session.restore = async () => null;
    session.shouldRetryRestore = () => true;
    connection.setConfiguredPaperEndpoint(ENDPOINT);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(connection.getPaperSessionState(), "RECOVERING");
  } finally {
    connection.clearConfiguredPaperEndpoint();
    session.restore = originalRestore;
    session.shouldRetryRestore = originalRetryable;
  }
});

test("only a stopped recovery projects RECOVERY_REQUIRED; no endpoint projects NOT_CONFIGURED", async () => {
  const session = mobileApprovedSession();
  const originalRestore = session.restore;
  const originalRetryable = session.shouldRetryRestore;
  try {
    connection.clearConfiguredPaperEndpoint();
    assert.equal(connection.getPaperSessionState(), "NOT_CONFIGURED");
    session.restore = async () => null;
    session.shouldRetryRestore = () => false;
    connection.setConfiguredPaperEndpoint(ENDPOINT);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(connection.getPaperSessionState(), "RECOVERY_REQUIRED");
  } finally {
    connection.clearConfiguredPaperEndpoint();
    session.restore = originalRestore;
    session.shouldRetryRestore = originalRetryable;
  }
});

test("home projection renders a recovering session as reconnecting, never as SETUP", () => {
  const home = fs.readFileSync("apps/mobile/src/homeView.tsx", "utf8");
  const app = fs.readFileSync("apps/mobile/App.tsx", "utf8");
  assert.match(app, /sessionRecovering=\{paperSessionState === "RECOVERING"\}/);
  assert.match(app, /setPaperSessionState\(getPaperSessionState\(\)\)/);
  assert.match(home, /const shownConnectionLabel = recovering \? "RECOVERING" : connectionLabel/);
  assert.match(home, /\{shownConnectionLabel\}/);
  assert.match(home, /recovering \? "PAPER 재연결 중" : disconnected \? "PAPER 연결 필요"/);
});


test("foreground RECOVERING preserves the last PAPER projection while runtime stays blocked", () => {
  const app = fs.readFileSync("apps/mobile/App.tsx", "utf8");
  assert.match(app, /const sessionState = getPaperSessionState\(\)/);
  assert.match(app, /endpoint != null && sessionState === "RECOVERING"/);
  assert.match(app, /dispatchRuntime\(\{ type: "RECOVERY_STARTED" \}\);[\s\S]*return Promise\.resolve\(\)/);
  const recoveringBranch = app.slice(
    app.indexOf('if (endpoint != null && sessionState === "RECOVERING")'),
    app.indexOf('setOperations({ status: "NOT_CONFIGURED"', app.indexOf('if (endpoint != null && sessionState === "RECOVERING")'))
  );
  assert.doesNotMatch(recoveringBranch, /setOperations\(/);
  assert.doesNotMatch(recoveringBranch, /RECOVERY_FAILED/);
});
