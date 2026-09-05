const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildRuntimeEnv, resolveDashboardToken, start, stripPrivateExchangeCredentials } = require("../scripts/start-cloud-runtime.js");

const TOKEN = "t".repeat(64);

test("an unconfigured launch supplies every input the runtime requires, including live public market data", () => {
  const { env, applied } = buildRuntimeEnv({}, TOKEN);
  // readCloudRuntimeConfig throws on each of these, so a missing one is not a degraded
  // start -- it is a process that exits before it listens.
  assert.equal(env.NUSA_CLOUD_DASHBOARD_PORT, "41731");
  assert.equal(env.NUSA_CLOUD_DASHBOARD_HOST, "127.0.0.1");
  assert.equal(env.NUSA_CLOUD_DASHBOARD_TOKEN, TOKEN);
  // Without public market data the runtime holds killSwitchActive and every PAPER order is
  // rejected as MARKET_DATA_INVALID, which is indistinguishable from a broken product.
  assert.equal(env.NUSA_CLOUD_UPBIT_PUBLIC_DATA, "true");
  // Without initial capital the PAPER execution loop is never constructed at all.
  assert.equal(env.NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW, "10000000");
  assert.ok(applied.includes("NUSA_CLOUD_UPBIT_PUBLIC_DATA"));
  assert.ok(applied.includes("NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW"));
});

test("the launcher pins PAPER authority and cannot be talked into LIVE by the surrounding environment", () => {
  const { env } = buildRuntimeEnv({}, TOKEN);
  assert.equal(env.NUSA_MODE, "PAPER");
  assert.equal(env.NUSA_LIVE_MUTATION, "PROHIBITED");
});

test("explicit configuration always wins over launcher defaults", () => {
  const caller = Object.freeze({
    NUSA_CLOUD_DASHBOARD_PORT: "9999",
    NUSA_CLOUD_DASHBOARD_HOST: "0.0.0.0",
    NUSA_CLOUD_UPBIT_PUBLIC_DATA: "false",
    NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "500000",
    NUSA_CLOUD_DASHBOARD_TOKEN: "caller-supplied-token-caller-supplied-token",
  });
  const { env, applied } = buildRuntimeEnv(caller, TOKEN);
  assert.equal(env.NUSA_CLOUD_DASHBOARD_PORT, "9999");
  assert.equal(env.NUSA_CLOUD_DASHBOARD_HOST, "0.0.0.0");
  // An operator who deliberately turned market data off keeps it off.
  assert.equal(env.NUSA_CLOUD_UPBIT_PUBLIC_DATA, "false");
  assert.equal(env.NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW, "500000");
  assert.equal(env.NUSA_CLOUD_DASHBOARD_TOKEN, "caller-supplied-token-caller-supplied-token");
  for (const key of Object.keys(caller)) assert.ok(!applied.includes(key), `${key} must not be overridden`);
});

test("a blank or whitespace-only value is treated as absent rather than as configuration", () => {
  const { env } = buildRuntimeEnv({ NUSA_CLOUD_DASHBOARD_PORT: "   ", NUSA_CLOUD_UPBIT_PUBLIC_DATA: "" }, TOKEN);
  assert.equal(env.NUSA_CLOUD_DASHBOARD_PORT, "41731");
  assert.equal(env.NUSA_CLOUD_UPBIT_PUBLIC_DATA, "true");
});

test("a configured dashboard token does not require the fallback token file", () => {
  const listeners = new Map(["SIGINT", "SIGTERM"].map((signal) => [signal, new Set(process.listeners(signal))]));
  const child = {
    exitCode: null,
    stderr: { on() {} },
    on() {},
    kill() {}
  };
  let spawnOptions;
  try {
    start({
      env: { NUSA_CLOUD_DASHBOARD_TOKEN: TOKEN },
      resolveToken: () => { throw new Error("fallback token file must not be touched"); },
      spawn: (_command, _args, options) => { spawnOptions = options; return child; },
      write: () => {}
    });
    assert.equal(spawnOptions.env.NUSA_CLOUD_DASHBOARD_TOKEN, TOKEN);
  } finally {
    for (const [signal, before] of listeners) {
      for (const listener of process.listeners(signal)) if (!before.has(listener)) process.removeListener(signal, listener);
    }
  }
});

test("private exchange credentials are stripped from the runtime environment, not forwarded", () => {
  const hostile = {
    UPBIT_ACCESS_KEY: "should-not-reach-the-runtime",
    UPBIT_SECRET_KEY: "should-not-reach-the-runtime",
    BINANCE_API_KEY: "should-not-reach-the-runtime",
    NUSA_CLOUD_DASHBOARD_TOKEN: TOKEN,
    UPBIT_PUBLIC_BASE_URL: "https://api.upbit.com",
    PATH: "/usr/bin",
  };
  const { env, stripped } = buildRuntimeEnv(hostile, TOKEN);
  for (const key of ["UPBIT_ACCESS_KEY", "UPBIT_SECRET_KEY", "BINANCE_API_KEY"]) {
    assert.equal(env[key], undefined, `${key} must not reach the PAPER runtime`);
    assert.ok(stripped.includes(key));
  }
  // Non-credential configuration and unrelated variables are left alone.
  assert.equal(env.UPBIT_PUBLIC_BASE_URL, "https://api.upbit.com");
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(JSON.stringify(env).includes("should-not-reach-the-runtime"), false);
});

test("stripping reports exactly what it removed and leaves the caller's object untouched", () => {
  const source = Object.freeze({ UPBIT_SECRET_KEY: "x", SAFE: "y" });
  const { env, stripped } = stripPrivateExchangeCredentials(source);
  assert.deepEqual([...stripped], ["UPBIT_SECRET_KEY"]);
  assert.equal(env.SAFE, "y");
  assert.equal(source.UPBIT_SECRET_KEY, "x", "input must not be mutated");
});

test("the dashboard token is generated once, owner-only, and stable across restarts", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-launcher-token-"));
  const tokenFile = path.join(directory, "nested", "dashboard-token");
  try {
    const first = resolveDashboardToken(tokenFile);
    // The runtime rejects anything under 32 UTF-8 bytes.
    assert.ok(Buffer.byteLength(first, "utf8") >= 32);
    assert.match(first, /^[0-9a-f]{64}$/);
    // A restart must not invalidate the token already configured on the phone.
    assert.equal(resolveDashboardToken(tokenFile), first);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600, "token file must not be world-readable");
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a truncated or corrupted token file is replaced rather than passed to the runtime", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-launcher-token-short-"));
  const tokenFile = path.join(directory, "dashboard-token");
  try {
    fs.writeFileSync(tokenFile, "too-short\n", "utf8");
    const resolved = resolveDashboardToken(tokenFile);
    assert.notEqual(resolved, "too-short");
    assert.ok(Buffer.byteLength(resolved, "utf8") >= 32);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
