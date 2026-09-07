"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { stripPrivateExchangeCredentials } = require("./start-cloud-runtime.js");

const DEFAULT_STATE_PATH = path.join(process.env.HOME || process.cwd(), ".nusa", "cloud", "supervisor.json");
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

function assertPaperOnly(env) {
  if (env.NUSA_MODE !== "PAPER") throw new Error("NUSA_PAPER_SUPERVISOR_REQUIRES_PAPER_MODE");
  if (env.NUSA_LIVE_MUTATION !== "PROHIBITED") throw new Error("NUSA_PAPER_SUPERVISOR_REQUIRES_LIVE_MUTATION_PROHIBITED");
  if (!env.NUSA_CLOUD_DASHBOARD_TOKEN || Buffer.byteLength(env.NUSA_CLOUD_DASHBOARD_TOKEN, "utf8") < 32) {
    throw new Error("NUSA_CLOUD_DASHBOARD_TOKEN must be configured for supervised production runtime");
  }
  if (!env.NUSA_CLOUD_STATE_DB_PATH || env.NUSA_CLOUD_STATE_DB_PATH.trim() === ":memory:") {
    throw new Error("NUSA_CLOUD_STATE_DB_PATH must point to durable storage for supervised production runtime");
  }
}

function readState(statePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return {
      restartCount: Number.isSafeInteger(parsed.restartCount) && parsed.restartCount >= 0 ? parsed.restartCount : 0,
      lastExit: parsed.lastExit && typeof parsed.lastExit === "object" ? parsed.lastExit : null,
    };
  } catch {
    return { restartCount: 0, lastExit: null };
  }
}

function writeState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, statePath);
}

function supervisorEnv(baseEnv, state, startedAt, restartAttempt) {
  const { env, stripped } = stripPrivateExchangeCredentials(baseEnv);
  const next = {
    ...env,
    NUSA_PAPER_SUPERVISOR_MANAGED: "true",
    NUSA_PAPER_SUPERVISOR_RESTART_ATTEMPT: String(restartAttempt),
    NUSA_PAPER_SUPERVISOR_RESTART_COUNT: String(state.restartCount),
    NUSA_PAPER_SUPERVISOR_STARTED_AT: String(startedAt),
  };
  if (state.lastExit) {
    next.NUSA_PAPER_SUPERVISOR_LAST_EXIT_CODE = state.lastExit.code == null ? "" : String(state.lastExit.code);
    next.NUSA_PAPER_SUPERVISOR_LAST_EXIT_SIGNAL = state.lastExit.signal || "";
    next.NUSA_PAPER_SUPERVISOR_LAST_EXITED_AT = String(state.lastExit.exitedAt);
    next.NUSA_PAPER_SUPERVISOR_LAST_UPTIME_MS = String(state.lastExit.uptimeMs);
  }
  return { env: next, stripped };
}

function start(options = {}) {
  const baseEnv = { ...(options.env || process.env) };
  assertPaperOnly(baseEnv);
  const statePath = baseEnv.NUSA_PAPER_SUPERVISOR_STATE_PATH || DEFAULT_STATE_PATH;
  // Production must enter through the composition root that restores closed-learning
  // challenger provenance before public market data starts flowing.
  const runtimePath = options.runtimePath || path.resolve(process.cwd(), "dist/apps/cloud/src/closedLearningProductionRuntime.js");
  const spawnFn = options.spawn || spawn;
  const setTimer = options.setTimeout || setTimeout;
  const now = options.now || Date.now;
  const startedAt = now();
  let state = readState(statePath);
  let child = null;
  let childStartedAt = 0;
  let stopping = false;
  let restartAttempt = 0;

  const launch = () => {
    if (stopping) return;
    const composed = supervisorEnv(baseEnv, state, startedAt, restartAttempt);
    if (composed.stripped.length > 0) process.stderr.write(`NUSA supervisor stripped private exchange credentials: ${composed.stripped.join(", ")}\n`);
    childStartedAt = now();
    child = spawnFn(process.execPath, [runtimePath], {
      cwd: options.cwd || process.cwd(),
      env: composed.env,
      stdio: "inherit",
      shell: false,
    });
    child.once("exit", (code, signal) => {
      const exitedAt = now();
      child = null;
      if (stopping) return;
      state = {
        restartCount: state.restartCount + 1,
        lastExit: { code: code == null ? null : code, signal: signal || null, exitedAt, uptimeMs: Math.max(0, exitedAt - childStartedAt) },
      };
      writeState(statePath, state);
      restartAttempt += 1;
      const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.min(restartAttempt - 1, 5));
      process.stderr.write(`NUSA PAPER runtime exited; fail-closed restart scheduled in ${delay}ms (count=${state.restartCount}).\n`);
      setTimer(launch, delay);
    });
  };

  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    if (child && child.exitCode == null) child.kill(signal);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
  launch();
  return { stop, statePath };
}

if (require.main === module) {
  try { start(); }
  catch (error) { console.error(error instanceof Error ? error.stack || error.message : error); process.exitCode = 1; }
}

module.exports = { assertPaperOnly, readState, start, supervisorEnv, writeState };
