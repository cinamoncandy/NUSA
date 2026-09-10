const test = require("node:test");
const assert = require("node:assert/strict");

const { loadPersonalPaperOperations } = require("../dist/apps/mobile/src/personalPaperOperationsClient.js");
const {
  InMemoryDashboardCredentialSession,
  describeCredentialFailure,
  takeLastCredentialFailure
} = require("../dist/apps/mobile/src/dashboardCredentialSession.js");
const { MobileSessionRequestError } = require("../dist/apps/mobile/src/mobileApprovedSession.js");
const {
  clearConfiguredPaperEndpoint,
  markPaperConnectionVerified,
  setConfiguredPaperEndpoint
} = require("../dist/apps/mobile/src/paperConnectionSession.js");

const ENDPOINT = "https://paper-failure-reason.example.test";
const TOKEN_FIXTURE = ["failure", "reason", "bootstrap", "fixture", "1234567890"].join("-");

function verifiedEndpoint() {
  clearConfiguredPaperEndpoint();
  setConfiguredPaperEndpoint(ENDPOINT);
  markPaperConnectionVerified(ENDPOINT);
}

test("a rejected exchange is described by its cause, not as a configuration problem", () => {
  assert.match(describeCredentialFailure(new MobileSessionRequestError(401)), /만료되었거나 이미 사용/);
  assert.match(describeCredentialFailure(new MobileSessionRequestError(403)), /만료되었거나 이미 사용/);
  assert.match(describeCredentialFailure(new MobileSessionRequestError(429)), /일시적으로 제한/);
  assert.match(describeCredentialFailure(new MobileSessionRequestError(503)), /HTTP 503/);
  assert.match(describeCredentialFailure(new MobileSessionRequestError(418)), /HTTP 418/);
  assert.equal(describeCredentialFailure(new Error("transport failed")), "transport failed");
  assert.match(describeCredentialFailure(null), /보안 세션 교환에 실패/);
});

test("a described failure stays bounded", () => {
  const long = describeCredentialFailure(new Error("x".repeat(5_000)));
  assert.ok(long.length <= 300, "a failure reason must stay bounded");
  // Status-derived reasons are fixed strings plus a number, so they cannot carry request data.
  assert.equal(describeCredentialFailure(new MobileSessionRequestError(401)).includes(TOKEN_FIXTURE), false);
});

test("reading the recorded reason clears it", () => {
  takeLastCredentialFailure();
  assert.equal(takeLastCredentialFailure(), null);
});

test("an unconfigured credential still reports a configuration problem", async () => {
  verifiedEndpoint();
  takeLastCredentialFailure();
  const result = await loadPersonalPaperOperations({
    baseUrl: ENDPOINT,
    credentialProvider: async () => null,
    request: async () => { throw new Error("no request expected"); }
  });
  assert.equal(result.status, "NOT_CONFIGURED");
  assert.match(result.reason, /not configured/);
  clearConfiguredPaperEndpoint();
});

// End-to-end through the real provider. Outside Android there is no secure storage, so the
// bootstrap exchange fails with a concrete cause; before this fix that cause was discarded and
// the caller reported "Secure dashboard credential is not configured."
test("a failed exchange surfaces its real cause through the client", async () => {
  verifiedEndpoint();
  takeLastCredentialFailure();
  const session = new InMemoryDashboardCredentialSession();
  session.connect(TOKEN_FIXTURE);
  const result = await loadPersonalPaperOperations({
    baseUrl: ENDPOINT,
    credentialProvider: session.credentialProvider,
    request: async () => { throw new Error("no request expected"); }
  });
  assert.equal(result.status, "UNAVAILABLE", "a rejected exchange is not a configuration problem");
  assert.doesNotMatch(result.reason, /not configured/);
  assert.ok(result.reason.length > 0);
  assert.equal(result.reason.includes(TOKEN_FIXTURE), false, "the reason must never contain the token");
  clearConfiguredPaperEndpoint();
});


test("Settings maps fallback enrollment rejection through the safe credential failure formatter", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const settings = fs.readFileSync(path.join(__dirname, "..", "apps/mobile/src/settingsView.tsx"), "utf8");
  assert.match(settings, /describeCredentialFailure/);
  assert.match(settings, /reason: describeCredentialFailure\(connectionError\)/);
  assert.doesNotMatch(settings, /reason: connectionError instanceof Error \? connectionError\.message/);
});
