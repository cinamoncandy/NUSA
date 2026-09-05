const { randomBytes } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { PaperRuntimeProcessSupervisor } = require("./paper-runtime-supervisor.js");

/**
 * Starts the Cloud PAPER runtime with a configuration that actually works out of the box.
 *
 * `readCloudRuntimeConfig` is deliberately fail-closed: every operational input is required,
 * and Upbit public market data is off unless NUSA_CLOUD_UPBIT_PUBLIC_DATA is exactly "true".
 * That is the right default for a library and the wrong default for the one command a person
 * runs to use the product -- unconfigured, the runtime exits on the first missing variable,
 * and if it did start it would carry no market data, which leaves the kill switch closed and
 * PAPER trading permanently blocked. This launcher supplies the operational defaults so the
 * product runs, without changing the library's fail-closed behaviour for anything else.
 *
 * Authority is unchanged and non-negotiable here: PAPER only, liveAuthority=NONE,
 * productionMutationAllowed=false. Only Upbit's PUBLIC quotation feed is enabled -- it needs
 * no credentials and grants no execution authority. Any private exchange credential present in
 * the environment is stripped from the child process rather than forwarded.
 */

const CONFIG_DIR = path.join(os.homedir(), ".nusa", "cloud");
const TOKEN_FILE = path.join(CONFIG_DIR, "dashboard-token");
const DEFAULT_PORT = "41731";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PAPER_CAPITAL_KRW = "10000000";
const SUPERVISOR_CHILD_ENV = "NUSA_PAPER_RUNTIME_SUPERVISOR_CHILD";

/** Environment variables that would hand the runtime real-money authority. Never forwarded. */
const PRIVATE_CREDENTIAL_PATTERN = /(ACCESS|SECRET|PRIVATE|API[_-]?KEY|TOKEN)/i;
const EXCHANGE_PATTERN = /UPBIT|BINANCE|BYBIT|OKX/i;

function stripPrivateExchangeCredentials(source) {
  const env = { ...source };
  const stripped = [];
  for (const key of Object.keys(env)) {
    if (EXCHANGE_PATTERN.test(key) && PRIVATE_CREDENTIAL_PATTERN.test(key)) {
      stripped.push(key);
      delete env[key];
    }
  }
  return { env, stripped: Object.freeze(stripped.sort()) };
}

/**
 * A stable local token, so the phone does not have to be reconfigured on every restart.
 * Written owner-only and kept outside the repository.
 */
function resolveDashboardToken(tokenFile = TOKEN_FILE) {
  if (existsSync(tokenFile)) {
    const existing = readFileSync(tokenFile, "utf8").trim();
    if (Buffer.byteLength(existing, "utf8") >= 32) return existing;
  }
  const token = randomBytes(32).toString("hex");
  mkdirSync(path.dirname(tokenFile), { recursive: true });
  writeFileSync(tokenFile, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  return token;
}

const isBlank = (value) => value === undefined || value.trim() === "";

/** Fills in operational defaults without overriding anything the caller set explicitly. */
function buildRuntimeEnv(baseEnv, token) {
  const { env, stripped } = stripPrivateExchangeCredentials(baseEnv);
  const defaults = {
    NUSA_MODE: "PAPER",
    NUSA_LIVE_MUTATION: "PROHIBITED",
    NUSA_CLOUD_DASHBOARD_PORT: DEFAULT_PORT,
    NUSA_CLOUD_DASHBOARD_HOST: DEFAULT_HOST,
    NUSA_CLOUD_DASHBOARD_TOKEN: token,
    // Public quotation feed: no credentials, no execution authority. Without this the runtime
    // has no prices, so every PAPER order is blocked as MARKET_DATA_INVALID.
    NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true",
    // Required for the PAPER execution loop to be constructed at all.
    NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: DEFAULT_PAPER_CAPITAL_KRW,
  };
  const applied = [];
  for (const [key, value] of Object.entries(defaults)) {
    if (isBlank(env[key])) {
      env[key] = value;
      applied.push(key);
    }
  }
  return { env, applied: Object.freeze(applied), stripped };
}

function banner(env, stripped) {
  const endpoint = `http://${env.NUSA_CLOUD_DASHBOARD_HOST}:${env.NUSA_CLOUD_DASHBOARD_PORT}`;
  const lines = [
    "",
    "  NUSA Cloud PAPER runtime",
    `  endpoint   ${endpoint}`,
    `  token      ${env.NUSA_CLOUD_DASHBOARD_TOKEN}`,
    `  token file ${TOKEN_FILE}`,
    "",
    "  PAPER only - liveAuthority=NONE, productionMutationAllowed=false",
    "  Upbit PUBLIC quotation feed only - no exchange credentials are used",
  ];
  if (stripped.length > 0) lines.push(`  stripped from child env: ${stripped.join(", ")}`);
  lines.push(
    "",
    "  Android emulator: adb reverse tcp:" + env.NUSA_CLOUD_DASHBOARD_PORT + " tcp:" + env.NUSA_CLOUD_DASHBOARD_PORT,
    "  Then in the app: Settings -> PAPER server -> paste the endpoint and token above.",
    "",
  );
  return lines.join("\n");
}

/**
 * The writer lease refuses a takeover it cannot prove is safe, which is correct, but on its own it
 * leaves the operator with a stack trace and no stated way forward. Name the recovery instead.
 */
function leaseRecoveryGuidance(stderrTail) {
  const stillActive = /PAPER_WRITER_ALREADY_ACTIVE/.test(stderrTail);
  return [
    "",
    "  The PAPER writer lease blocked startup.",
    stillActive
      ? "  Another NUSA runtime currently holds it. Stop that runtime, or wait for its lease to expire."
      : "  A previous runtime did not shut down cleanly and its lease is too old to take over safely.",
    stillActive ? "" : "  Once nothing is running, clear the abandoned lease with:",
    stillActive ? "" : "    node scripts/reset-paper-writer-lease.js",
    "",
  ].filter((line) => line !== "").join("\n") + "\n";
}

function start(options = {}) {
  const baseEnv = options.env ?? process.env;
  const token = (options.resolveToken ?? resolveDashboardToken)();
  const { env, stripped } = buildRuntimeEnv(baseEnv, token);
  const write = options.write ?? ((text) => process.stdout.write(text));
  write(banner(env, stripped));
  const spawnFn = options.spawn ?? spawn;
  const child = spawnFn(process.execPath, ["dist/apps/cloud/src/runtime.js"], {
    cwd: options.cwd ?? process.cwd(),
    env,
    // stderr is piped so a writer-lease failure can be answered with the recovery command
    // instead of a bare stack trace; it is still echoed through unchanged.
    stdio: ["ignore", "inherit", "pipe"],
    shell: false,
  });
  let stderrTail = "";
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(chunk);
    stderrTail = `${stderrTail}${chunk}`.slice(-4000);
  });
  child.on("exit", (code, signal) => {
    if (code !== 0 && /PAPER_WRITER_CLOCK_ANOMALY|PAPER_WRITER_ALREADY_ACTIVE/.test(stderrTail)) {
      write(leaseRecoveryGuidance(stderrTail));
    }
    process.exitCode = signal ? 1 : code ?? 0;
  });
  // The runtime installs its own SIGTERM/SIGINT shutdown controller; forward the signal so it
  // releases the PAPER writer lease instead of being killed underneath its own handler.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => { if (child.exitCode == null) child.kill(signal); });
  }
  return child;
}

/**
 * Production entrypoint: keep PAPER runtime alive across unexpected process exits while preserving
 * the existing launcher as the supervised child. The child marker prevents recursive supervisors.
 */
function runManaged(options = {}) {
  const baseEnv = options.env ?? process.env;
  if (baseEnv[SUPERVISOR_CHILD_ENV] === "true") return start(options);

  const supervisor = new PaperRuntimeProcessSupervisor({
    cwd: options.cwd ?? process.cwd(),
    env: { ...baseEnv, [SUPERVISOR_CHILD_ENV]: "true" },
    command: process.execPath,
    args: ["scripts/start-cloud-runtime.js"],
    write: options.write,
    spawn: options.spawnSupervisor,
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
    now: options.now,
    initialBackoffMs: options.initialBackoffMs,
    maxBackoffMs: options.maxBackoffMs,
    stableWindowMs: options.stableWindowMs,
    maxRestarts: options.maxRestarts,
    maxRestartWindowMs: options.maxRestartWindowMs,
  });
  supervisor.start();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => supervisor.stop(signal));
  }
  return supervisor;
}

if (require.main === module) runManaged();

module.exports = {
  buildRuntimeEnv,
  resolveDashboardToken,
  runManaged,
  start,
  stripPrivateExchangeCredentials,
  SUPERVISOR_CHILD_ENV,
  TOKEN_FILE,
};
