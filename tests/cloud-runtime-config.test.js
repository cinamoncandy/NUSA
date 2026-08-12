const test = require("node:test");
const assert = require("node:assert/strict");
const { readCloudRuntimeConfig, createSharedSecretTokenVerifier } = require("../dist/apps/cloud/src/cloudRuntimeConfig.js");

const VALID_TOKEN = "a-real-secret-that-is-at-least-32-bytes-long";
const USER_TOKEN = "ordinary-user-secret-that-is-at-least-32-bytes";
const VALID_ENV = Object.freeze({
  NUSA_CLOUD_DASHBOARD_PORT: "41799",
  NUSA_CLOUD_DASHBOARD_TOKEN: VALID_TOKEN,
  NUSA_OWNER_ID: "owner-1",
  NUSA_OWNER_EMAIL: "owner@example.com"
});

test("a complete, valid environment produces a config", () => {
  const config = readCloudRuntimeConfig(VALID_ENV);
  assert.equal(config.port, 41799);
  assert.equal(config.dashboardToken, VALID_TOKEN);
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
  for (const value of ["0", "-1", "not-a-number"]) assert.throws(() => readCloudRuntimeConfig({ ...VALID_ENV, NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: value }), /NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW/);
});

test("an explicit loopback host is passed through and non-loopback binding is refused", () => {
  assert.equal(readCloudRuntimeConfig({ ...VALID_ENV, NUSA_CLOUD_DASHBOARD_HOST: "127.0.0.1" }).host, "127.0.0.1");
  assert.throws(() => readCloudRuntimeConfig({ ...VALID_ENV, NUSA_CLOUD_DASHBOARD_HOST: "0.0.0.0" }), /must be 127\.0\.0\.1 or localhost/);
});

test("a missing port fails closed", () => { const { NUSA_CLOUD_DASHBOARD_PORT, ...rest } = VALID_ENV; assert.throws(() => readCloudRuntimeConfig(rest), /NUSA_CLOUD_DASHBOARD_PORT is required/); });
test("an empty-string port fails closed, not silently defaulted", () => { assert.throws(() => readCloudRuntimeConfig({ ...VALID_ENV, NUSA_CLOUD_DASHBOARD_PORT: "" }), /NUSA_CLOUD_DASHBOARD_PORT is required/); });
test("a non-numeric or out-of-range port fails closed", () => { for (const bad of ["not-a-number", "0", "1023", "65536", "-1", "3.5"]) assert.throws(() => readCloudRuntimeConfig({ ...VALID_ENV, NUSA_CLOUD_DASHBOARD_PORT: bad }), new RegExp("NUSA_CLOUD_DASHBOARD_PORT")); });
test("a missing token fails closed -- no default accepts any token", () => { const { NUSA_CLOUD_DASHBOARD_TOKEN, ...rest } = VALID_ENV; assert.throws(() => readCloudRuntimeConfig(rest), /NUSA_CLOUD_DASHBOARD_TOKEN is required/); });
test("an empty-string token fails closed", () => { assert.throws(() => readCloudRuntimeConfig({ ...VALID_ENV, NUSA_CLOUD_DASHBOARD_TOKEN: "   " }), /NUSA_CLOUD_DASHBOARD_TOKEN is required/); });

test("the owner token is bound to configured owner identity and management scope", () => {
  const verifier = createSharedSecretTokenVerifier(VALID_TOKEN, VALID_ENV);
  const principal = verifier.verify(VALID_TOKEN);
  assert.ok(principal);
  assert.equal(principal.userId, "owner-1");
  assert.equal(principal.email, "owner@example.com");
  assert.equal(verifier.ownerPrincipal.userId, "owner-1");
  assert.deepEqual([...principal.scopes], ["dashboard:read", "settings:read", "settings:write", "users:manage"]);
});

test("configured ordinary bearer token carries stable identity without users:manage", () => {
  const env = {
    ...VALID_ENV,
    NUSA_CLOUD_USER_IDENTITIES_JSON: JSON.stringify([{ token: USER_TOKEN, userId: "user-1", email: "user@example.com", displayName: "User One" }])
  };
  readCloudRuntimeConfig(env);
  const principal = createSharedSecretTokenVerifier(VALID_TOKEN, env).verify(USER_TOKEN);
  assert.ok(principal);
  assert.equal(principal.userId, "user-1");
  assert.equal(principal.email, "user@example.com");
  assert.equal(principal.displayName, "User One");
  assert.equal(principal.scopes.includes("users:manage"), false);
});

test("identity registry rejects duplicate owner/user identity and weak user tokens", () => {
  assert.throws(() => readCloudRuntimeConfig({ ...VALID_ENV, NUSA_CLOUD_USER_IDENTITIES_JSON: JSON.stringify([{ token: USER_TOKEN, userId: "owner-1", email: "user@example.com" }]) }), /duplicate token or identity/);
  assert.throws(() => readCloudRuntimeConfig({ ...VALID_ENV, NUSA_CLOUD_USER_IDENTITIES_JSON: JSON.stringify([{ token: "short", userId: "user-1", email: "user@example.com" }]) }), /at least 32 UTF-8 bytes/);
});

test("the verifier rejects a wrong token, a prefix, and a suffix", () => {
  const verifier = createSharedSecretTokenVerifier(VALID_TOKEN, VALID_ENV);
  assert.equal(verifier.verify("wrong-secret"), undefined);
  assert.equal(verifier.verify(VALID_TOKEN.slice(0, -1)), undefined);
  assert.equal(verifier.verify(`${VALID_TOKEN}X`), undefined);
});

test("the verifier rejects an empty or non-string token without throwing", () => {
  const verifier = createSharedSecretTokenVerifier(VALID_TOKEN, VALID_ENV);
  assert.equal(verifier.verify(""), undefined);
  assert.doesNotThrow(() => verifier.verify(undefined));
  assert.equal(verifier.verify(undefined), undefined);
});

test("constructing a verifier below the minimum secret length is refused, not silently permissive", () => {
  assert.throws(() => createSharedSecretTokenVerifier("", VALID_ENV), /at least 32 UTF-8 bytes/);
  assert.throws(() => createSharedSecretTokenVerifier("   ", VALID_ENV), /at least 32 UTF-8 bytes/);
  assert.throws(() => createSharedSecretTokenVerifier("short-secret", VALID_ENV), /at least 32 UTF-8 bytes/);
});
