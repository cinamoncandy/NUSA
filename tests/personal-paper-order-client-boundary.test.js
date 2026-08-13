const test = require("node:test");
const assert = require("node:assert/strict");
const { submitPersonalPaperOrder } = require("../dist/apps/mobile/src/personalPaperOrderClient.js");
const { InMemoryDashboardCredentialSession } = require("../dist/apps/mobile/src/dashboardCredentialSession.js");
const { clearConfiguredPaperEndpoint, markPaperConnectionVerified, setConfiguredPaperEndpoint } = require("../dist/apps/mobile/src/paperConnectionSession.js");

const command = () => ({ schemaVersion: 1, authority: "PAPER_ONLY", productionMutationAllowed: false, idempotencyKey: "paper-client-00000001", market: "KRW-BTC", side: "BUY", orderType: "MARKET", quantity: 0.001 });
const blocked = () => ({ schemaVersion: 1, status: "BLOCKED", idempotencyKey: "paper-client-00000001", market: "KRW-BTC", side: "BUY", orderType: "MARKET", quantity: 0.001, reason: "TEST", liveAuthority: "NONE", productionMutationAllowed: false });

const clear = () => clearConfiguredPaperEndpoint();
test.beforeEach(clear); test.afterEach(clear);

test("endpoint identity change revokes shared ephemeral credential", async () => {
  const a = new InMemoryDashboardCredentialSession(); const b = new InMemoryDashboardCredentialSession();
  setConfiguredPaperEndpoint("https://paper.example.test"); a.connect("shared-token-00000001"); markPaperConnectionVerified("https://paper.example.test");
  assert.equal(await b.credentialProvider(), "shared-token-00000001");
  setConfiguredPaperEndpoint("https://other.example.test");
  assert.equal(await b.credentialProvider(), null);
});

test("order client sends no credential before Settings endpoint verification", async () => {
  setConfiguredPaperEndpoint("https://paper.example.test");
  const session = new InMemoryDashboardCredentialSession(); session.connect("shared-token-00000001"); let calls = 0;
  const result = await submitPersonalPaperOrder({ baseUrl: "https://ignored.invalid", credentialProvider: session.credentialProvider, request: async () => { calls++; throw new Error("must not call"); } }, command());
  assert.equal(result.status, "NOT_CONFIGURED"); assert.equal(calls, 0);
});

test("order client refuses insecure remote HTTP before credential transport", async () => {
  setConfiguredPaperEndpoint("http://192.168.1.5:41731"); markPaperConnectionVerified("http://192.168.1.5:41731");
  const session = new InMemoryDashboardCredentialSession(); session.connect("shared-token-00000001"); let calls = 0;
  const result = await submitPersonalPaperOrder({ baseUrl: "https://ignored.invalid", credentialProvider: session.credentialProvider, request: async () => { calls++; throw new Error("must not call"); } }, command());
  assert.equal(result.status, "UNAVAILABLE"); assert.equal(calls, 0); assert.match(result.reason, /insecure remote HTTP/i);
});

test("verified endpoint is authoritative and redirects are rejected", async () => {
  setConfiguredPaperEndpoint("https://paper.example.test"); markPaperConnectionVerified("https://paper.example.test");
  const session = new InMemoryDashboardCredentialSession(); session.connect("shared-token-00000001"); let observed = "";
  const result = await submitPersonalPaperOrder({ baseUrl: "https://attacker.invalid", credentialProvider: session.credentialProvider, request: async (url) => { observed = String(url); return { ok: true, status: 200, redirected: false, url: "https://paper.example.test/api/paper-orders", json: async () => blocked() }; } }, command());
  assert.equal(result.status, "READY"); assert.equal(observed, "https://paper.example.test/api/paper-orders");
  const redirected = await submitPersonalPaperOrder({ baseUrl: "https://ignored.invalid", credentialProvider: session.credentialProvider, request: async () => ({ ok: true, status: 200, redirected: true, url: "https://other.example.test/api/paper-orders", json: async () => blocked() }) }, command());
  assert.equal(redirected.status, "UNAVAILABLE"); assert.match(redirected.reason, /redirect/i);
});
