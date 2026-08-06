const test = require("node:test");
const assert = require("node:assert/strict");
const { readCloudRuntimeConfig, createSharedSecretTokenVerifier } = require("../dist/apps/cloud/src/cloudRuntimeConfig.js");

const VALID_ENV = Object.freeze({
  NUSA_CLOUD_DASHBOARD_PORT: "41799",
  NUSA_CLOUD_DASHBOARD_TOKEN: "a-real-secret"
});

test("a complete, valid environment produces a config", () => {
  const config = readCloudRuntimeConfig(VALID_ENV);
  assert.equal(config.port, 41799);
  assert.equal(config.dashboardToken, "a-real-secret");
  assert.equal("host" in config, false, "host must be omitted, not defaulted here -- server.ts owns that default");
  assert.deepEqual([...config.upbitMarkets], ["KRW-BTC", "KRW-ETH"]);
  assert.equal(config.upbitPublicDataEnabled, false);
});

test("public Upbit data requires explicit enablement and accepts only bounded KRW markets", () => {
  const config = readCloudRuntimeConfig({ ...VALID_ENV, NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true", NUSA_CLOUD_UPBIT_MARKETS: "KRW-BTC,KRW-XRP" });
  assert.equal(config.upbitPublicDataEnabled, true);
  assert.deepEqual([...config.upbitMarkets], ["KRW-BTC", "KRW-XRP"]);
  assert.throws(() => readCloudRuntimeConfig({ ...VALID_ENV, NUSA_CLOUD_UPBIT_MARKETS: "BTC-USDT" }), /KRW markets/);
  assert.throws(() => readCloudRuntimeConfig({ ...VALID_ENV, NUSA_CLOUD_UPBIT_MARKETS: "" }), /KRW markets/);
});

test("paper initial capital is opt-in and validated", () => {
  assert.equal(readCloudRuntimeConfig(VALID_ENV).paperInitialCapitalKrw, undefined);
  assert.equal(readCloudRuntimeConfig({ ...VALID_ENV, NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "1000000" }).paperInitialCapitalKrw, 1_000_000);
  for (const value of ["0", "-1", "not-a-number"]) {
    assert.throws(() => readCloudRuntimeConfig({ ...VALID_ENV, NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: value }), /NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW/);
  }
});

test("an explicit host is passed through", () => {
  const config = readCloudRuntimeConfig({ ...VALID_ENV, NUSA_CLOUD_DASHBOARD_HOST: "0.0.0.0" });
  assert.equal(config.host, "0.0.0.0");
});

test("a missing port fails closed", () => {
  const { NUSA_CLOUD_DASHBOARD_PORT, ...rest } = VALID_ENV;
  assert.throws(() => readCloudRuntimeConfig(rest), /NUSA_CLOUD_DASHBOARD_PORT is required/);
});

test("an empty-string port fails closed, not silently defaulted", () => {
  assert.throws(() => readCloudRuntimeConfig({ ...VALID_ENV, NUSA_CLOUD_DASHBOARD_PORT: "" }), /NUSA_CLOUD_DASHBOARD_PORT is required/);
});

test("a non-numeric or out-of-range port fails closed", () => {
  for (const bad of ["not-a-number", "0", "1023", "65536", "-1", "3.5"]) {
    assert.throws(() => readCloudRuntimeConfig({ ...VALID_ENV, NUSA_CLOUD_DASHBOARD_PORT: bad }), new RegExp("NUSA_CLOUD_DASHBOARD_PORT"), `port ${bad} must be rejected`);
  }
});

test("a missing token fails closed -- no default accepts any token", () => {
  const { NUSA_CLOUD_DASHBOARD_TOKEN, ...rest } = VALID_ENV;
  assert.throws(() => readCloudRuntimeConfig(rest), /NUSA_CLOUD_DASHBOARD_TOKEN is required/);
});

test("an empty-string token fails closed", () => {
  assert.throws(() => readCloudRuntimeConfig({ ...VALID_ENV, NUSA_CLOUD_DASHBOARD_TOKEN: "   " }), /NUSA_CLOUD_DASHBOARD_TOKEN is required/);
});

test("the shared-secret verifier accepts only the exact configured token", () => {
  const verifier = createSharedSecretTokenVerifier("correct-secret");
  const principal = verifier.verify("correct-secret");
  assert.ok(principal);
  assert.equal(principal.userId, "operator");
  assert.deepEqual([...principal.scopes], ["dashboard:read"]);
});

test("the shared-secret verifier rejects a wrong token, a prefix, and a suffix", () => {
  const verifier = createSharedSecretTokenVerifier("correct-secret");
  assert.equal(verifier.verify("wrong-secret"), undefined);
  assert.equal(verifier.verify("correct-secre"), undefined);
  assert.equal(verifier.verify("correct-secretX"), undefined);
});

test("the shared-secret verifier rejects an empty or non-string token without throwing", () => {
  const verifier = createSharedSecretTokenVerifier("correct-secret");
  assert.equal(verifier.verify(""), undefined);
  assert.doesNotThrow(() => verifier.verify(undefined));
  assert.equal(verifier.verify(undefined), undefined);
});

test("constructing a verifier with an empty shared secret is refused, not silently permissive", () => {
  assert.throws(() => createSharedSecretTokenVerifier(""), /shared secret must not be empty/);
  assert.throws(() => createSharedSecretTokenVerifier("   "), /shared secret must not be empty/);
});
