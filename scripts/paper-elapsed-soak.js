const { randomBytes } = require("node:crypto");
const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const { createServer } = require("node:net");
const { dirname, resolve } = require("node:path");
const { spawn } = require("node:child_process");

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function availablePort() {
  return await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePromise(port));
    });
  });
}

function scrubPrivateExchangeEnv(source) {
  const env = { ...source };
  const removed = [];
  for (const key of Object.keys(env)) {
    if (/UPBIT/i.test(key) && /(ACCESS|SECRET|PRIVATE|API[_-]?KEY|TOKEN)/i.test(key)) {
      removed.push(key);
      delete env[key];
    }
  }
  return { env, removed: Object.freeze(removed.sort()) };
}

function parsePositiveInteger(value, fallback, name) {
  const parsed = Number(value == null || value === "" ? fallback : value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function summarizeSnapshot(snapshot) {
  const heartbeat = snapshot?.operations?.heartbeat;
  return Object.freeze({
    observedAt: new Date().toISOString(),
    generatedAt: snapshot?.generatedAt ?? null,
    runtimeState: snapshot?.operations?.runtimeState ?? null,
    schedulerRunning: snapshot?.operations?.schedulerRunning === true,
    eventCount: Number(heartbeat?.eventCount ?? 0),
    decisionCount: Number(heartbeat?.decisionCount ?? 0),
    lastHeartbeatAt: heartbeat?.lastHeartbeatAt ?? null,
    lastMarketEventAt: heartbeat?.lastMarketEventAt ?? null,
    liveAuthority: snapshot?.liveAuthority,
    productionMutationAllowed: snapshot?.productionMutationAllowed,
  });
}

function validateSoakObservations(observations, minimumElapsedMs) {
  const reasons = [];
  if (!Array.isArray(observations) || observations.length < 2) reasons.push("INSUFFICIENT_OBSERVATIONS");
  const first = observations?.[0];
  const last = observations?.[observations.length - 1];
  const firstMs = Date.parse(first?.observedAt ?? "");
  const lastMs = Date.parse(last?.observedAt ?? "");
  const elapsedMs = Number.isFinite(firstMs) && Number.isFinite(lastMs) ? lastMs - firstMs : 0;
  if (elapsedMs < minimumElapsedMs) reasons.push("INSUFFICIENT_REAL_ELAPSED_TIME");

  let previousEventCount = -1;
  let previousDecisionCount = -1;
  let previousObservedAt = -1;
  for (const observation of observations || []) {
    const observedAt = Date.parse(observation.observedAt ?? "");
    if (!Number.isFinite(observedAt) || observedAt <= previousObservedAt) reasons.push("NON_MONOTONIC_WALL_CLOCK");
    previousObservedAt = observedAt;
    if (observation.liveAuthority !== "NONE" || observation.productionMutationAllowed !== false) reasons.push("AUTHORITY_INVARIANT_VIOLATION");
    if (observation.schedulerRunning !== true || !["RUNNING", "DEGRADED"].includes(observation.runtimeState)) reasons.push("PAPER_RUNTIME_NOT_ACTIVE");
    if (!Number.isSafeInteger(observation.eventCount) || observation.eventCount < previousEventCount) reasons.push("EVENT_COUNT_REGRESSION");
    if (!Number.isSafeInteger(observation.decisionCount) || observation.decisionCount < previousDecisionCount) reasons.push("DECISION_COUNT_REGRESSION");
    previousEventCount = observation.eventCount;
    previousDecisionCount = observation.decisionCount;
  }

  return Object.freeze({
    accepted: reasons.length === 0,
    elapsedMs,
    reasons: Object.freeze([...new Set(reasons)].sort()),
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

async function loadOperations(baseUrl, token) {
  const response = await fetch(`${baseUrl}/api/paper-operations`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!response.ok) throw new Error(`PAPER operations returned HTTP ${response.status}`);
  return await response.json();
}

async function waitForReady(baseUrl, token, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const snapshot = await loadOperations(baseUrl, token);
      const summary = summarizeSnapshot(snapshot);
      if (summary.schedulerRunning && ["RUNNING", "DEGRADED"].includes(summary.runtimeState)) return snapshot;
    } catch (error) {
      lastError = error;
    }
    await sleep(750);
  }
  throw new Error(`PAPER runtime readiness timeout${lastError ? `: ${lastError.message}` : ""}`);
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolvePromise) => child.once("exit", () => resolvePromise(true))),
    sleep(10_000).then(() => false),
  ]);
  if (!exited && child.exitCode == null) child.kill("SIGKILL");
}

async function run(options = {}) {
  const root = resolve(options.root || process.cwd());
  const durationMs = parsePositiveInteger(options.durationMs ?? process.env.NUSA_SOAK_DURATION_MS, 60 * 60 * 1000, "durationMs");
  const pollMs = parsePositiveInteger(options.pollMs ?? process.env.NUSA_SOAK_POLL_MS, 30_000, "pollMs");
  if (pollMs >= durationMs) throw new Error("pollMs must be smaller than durationMs");
  const outputPath = resolve(root, options.outputPath || process.env.NUSA_SOAK_OUTPUT || "artifacts/operational-evidence/paper-elapsed-soak.json");
  const runtimePath = resolve(root, "dist/apps/cloud/src/runtime.js");
  if (!existsSync(runtimePath)) throw new Error("compiled Cloud runtime is missing; run `pnpm run build` first");

  const port = await availablePort();
  const token = randomBytes(32).toString("hex");
  const { env: cleanEnv, removed: scrubbedPrivateKeys } = scrubPrivateExchangeEnv(process.env);
  const env = {
    ...cleanEnv,
    NUSA_MODE: "PAPER",
    NUSA_LIVE_MUTATION: "PROHIBITED",
    NUSA_CLOUD_DASHBOARD_PORT: String(port),
    NUSA_CLOUD_DASHBOARD_HOST: "127.0.0.1",
    NUSA_CLOUD_DASHBOARD_TOKEN: token,
    NUSA_CLOUD_UPBIT_PUBLIC_DATA: "true",
    NUSA_CLOUD_UPBIT_MARKETS: String(options.market || process.env.NUSA_SOAK_MARKET || "KRW-BTC").trim().toUpperCase(),
    NUSA_CLOUD_STATE_DB_PATH: resolve(root, options.databasePath || ".runtime-evidence/paper-soak/state.sqlite"),
    NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "10000000",
    NUSA_CLOUD_PAPER_INVESTMENT_PERCENT: "10",
  };
  const baseUrl = `http://127.0.0.1:${port}`;
  const stdout = [];
  const stderr = [];
  const child = spawn(process.execPath, [runtimePath], { cwd: root, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => stdout.push(String(chunk).slice(-4000)));
  child.stderr.on("data", (chunk) => stderr.push(String(chunk).slice(-4000)));

  const observations = [];
  const startedAtMs = Date.now();
  try {
    const firstSnapshot = await waitForReady(baseUrl, token);
    observations.push(summarizeSnapshot(firstSnapshot));
    const deadline = startedAtMs + durationMs;
    while (Date.now() < deadline) {
      if (child.exitCode != null) throw new Error(`PAPER runtime exited during soak (${child.exitCode}): ${stderr.join("").slice(-4000)}`);
      await sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
      const snapshot = await loadOperations(baseUrl, token);
      observations.push(summarizeSnapshot(snapshot));
    }

    const validation = validateSoakObservations(observations, durationMs);
    const receipt = {
      schemaVersion: 1,
      evidenceType: "PAPER_REAL_ELAPSED_SOAK",
      startedAt: observations[0]?.observedAt ?? new Date(startedAtMs).toISOString(),
      completedAt: observations[observations.length - 1]?.observedAt ?? new Date().toISOString(),
      requiredElapsedMs: durationMs,
      pollIntervalMs: pollMs,
      observationCount: observations.length,
      scrubbedPrivateExchangeEnvKeys: scrubbedPrivateKeys,
      observations,
      validation,
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    };
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    if (!validation.accepted) throw new Error(`elapsed PAPER soak evidence rejected: ${validation.reasons.join(",")}`);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return receipt;
  } finally {
    await stopChild(child);
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}

module.exports = { run, summarizeSnapshot, validateSoakObservations };
