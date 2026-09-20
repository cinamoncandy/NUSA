#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const SAFETY = Object.freeze({
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
});
const SCHEMA_VERSION = 1;
const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 5_000;
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

function finiteInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) return fallback;
  return number;
}

function safeText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stateFilePath(value) {
  const text = safeText(value);
  if (!text || text.length > 512 || text.includes("\0")) throw new Error("AUTOPILOT_STATE_PATH_INVALID");
  return path.resolve(text);
}

function runtimeEndpoint(value) {
  const text = safeText(value);
  if (!text) return null;
  let parsed;
  try { parsed = new URL(text); } catch { throw new Error("AUTOPILOT_RUNTIME_ENDPOINT_INVALID"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname) throw new Error("AUTOPILOT_RUNTIME_ENDPOINT_UNSAFE");
  return parsed.toString();
}

function freshState(now = Date.now()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    status: "STARTING",
    iteration: 0,
    queueDepth: null,
    completedCount: 0,
    failureCount: 0,
    retryCount: 0,
    blockedCount: 0,
    currentTask: null,
    lastSuccessfulWorkAt: null,
    lastHeartbeatAt: now,
    lastCycleAt: null,
    nextCycleAt: null,
    lastResult: null,
    stateRecovery: "FRESH",
    ...SAFETY,
  };
}

function validResult(value) {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (safeText(value.status) === null || safeText(value.reason) === null) return false;
  if (value.headSha !== null && value.headSha !== undefined && (typeof value.headSha !== "string" || value.headSha.length > 128)) return false;
  if (value.workflowRunId !== null && value.workflowRunId !== undefined && !Number.isSafeInteger(value.workflowRunId)) return false;
  return true;
}

function validateState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "STATE_OBJECT_REQUIRED" };
  if (value.schemaVersion !== SCHEMA_VERSION) return { ok: false, reason: "STATE_SCHEMA_UNSUPPORTED" };
  if (value.liveAuthority !== SAFETY.liveAuthority || value.productionMutationAllowed !== false || value.aiAuthority !== SAFETY.aiAuthority) return { ok: false, reason: "STATE_SAFETY_INVARIANT_INVALID" };
  const statuses = new Set(["STARTING", "RUNNING", "IDLE", "RETRYING", "BLOCKED", "STOPPING", "STOPPED"]);
  if (!statuses.has(value.status)) return { ok: false, reason: "STATE_STATUS_INVALID" };
  if (!["FRESH", "RESTORED", "CORRUPT"].includes(value.stateRecovery)) return { ok: false, reason: "STATE_RECOVERY_INVALID" };
  for (const key of ["iteration", "completedCount", "failureCount", "retryCount", "blockedCount"]) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) return { ok: false, reason: `STATE_${key.toUpperCase()}_INVALID` };
  }
  for (const key of ["lastHeartbeatAt"]) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) return { ok: false, reason: `STATE_${key.toUpperCase()}_INVALID` };
  }
  for (const key of ["lastSuccessfulWorkAt", "lastCycleAt", "nextCycleAt"]) {
    if (value[key] !== null && (!Number.isSafeInteger(value[key]) || value[key] < 0)) return { ok: false, reason: `STATE_${key.toUpperCase()}_INVALID` };
  }
  if (value.queueDepth !== null && (!Number.isSafeInteger(value.queueDepth) || value.queueDepth < 0)) return { ok: false, reason: "STATE_QUEUE_DEPTH_INVALID" };
  if (value.currentTask !== null && (typeof value.currentTask !== "string" || value.currentTask.length > 256)) return { ok: false, reason: "STATE_TASK_INVALID" };
  if (!validResult(value.lastResult)) return { ok: false, reason: "STATE_RESULT_INVALID" };
  return { ok: true };
}

async function atomicWrite(file, value) {
  const directory = path.dirname(file);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, file);
  try { await fs.chmod(file, 0o600); } catch { /* best effort on non-POSIX hosts */ }
}

class AutopilotRuntime {
  constructor(options = {}) {
    this.statePath = stateFilePath(options.statePath || path.join(process.env.NUSA_STATE_DIR || "/var/lib/nusa", "autopilot", "runtime-state.json"));
    this.endpoint = runtimeEndpoint(options.endpoint);
    this.token = safeText(options.token);
    this.intervalMs = finiteInteger(options.intervalMs, DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
    this.maxAttempts = finiteInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS, 1, MAX_ATTEMPTS);
    this.backoffMs = finiteInteger(options.backoffMs, DEFAULT_BACKOFF_MS, 0, MAX_BACKOFF_MS);
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.sleep = typeof options.sleep === "function" ? options.sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    this.tick = typeof options.tick === "function" ? options.tick : () => this.fetchTick();
    this.state = freshState(this.now());
    this.timer = null;
    this.running = false;
    this.inFlight = null;
  }

  async load() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.statePath, "utf8"));
      const validation = validateState(parsed);
      if (!validation.ok) throw new Error(validation.reason);
      this.state = { ...parsed, stateRecovery: "RESTORED", lastHeartbeatAt: this.now(), ...SAFETY };
    } catch (error) {
      if (error && error.code === "ENOENT") {
        this.state = freshState(this.now());
        await this.persist();
        return this.snapshot();
      }
      const corruptPath = `${this.statePath}.corrupt-${this.now()}`;
      try { await fs.rename(this.statePath, corruptPath); } catch { /* preserve original when rename is unavailable */ }
      this.state = { ...freshState(this.now()), status: "BLOCKED", stateRecovery: "CORRUPT", lastResult: { status: "BLOCKED", reason: "STATE_CORRUPT", headSha: null, workflowRunId: null }, ...SAFETY };
      await this.persist();
      return this.snapshot();
    }
    await this.persist();
    return this.snapshot();
  }

  async persist() {
    await atomicWrite(this.statePath, this.state);
  }

  snapshot() {
    return Object.freeze(JSON.parse(JSON.stringify(this.state)));
  }

  async fetchTick() {
    if (!this.endpoint || !this.token) throw new Error("AUTOPILOT_RUNTIME_ENDPOINT_OR_TOKEN_REQUIRED");
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ source: "nusa-persistent-runtime", observedAt: this.now(), ...SAFETY }),
    });
    if (!response.ok) throw new Error(`AUTOPILOT_TICK_HTTP_${response.status}`);
    const value = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AUTOPILOT_TICK_RESPONSE_INVALID");
    return value;
  }

  async cycle() {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runCycle();
    try { return await this.inFlight; } finally { this.inFlight = null; }
  }

  async runCycle() {
    const startedAt = this.now();
    this.state = { ...this.state, status: "RETRYING", iteration: this.state.iteration + 1, lastHeartbeatAt: startedAt, lastCycleAt: startedAt, nextCycleAt: startedAt + this.intervalMs, ...SAFETY };
    await this.persist();
    let lastError = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const result = await this.tick();
        const status = safeText(result?.status) || "ABSTAINED";
        if (status === "EXECUTION_NOT_DISPATCHED") throw new Error(safeText(result?.reason) || status);
        if (status !== "EXECUTION_DISPATCHED" && status !== "DUPLICATE_EXECUTION_SUPPRESSED" && status !== "ABSTAINED") throw new Error("AUTOPILOT_TICK_STATUS_UNSUPPORTED");
        const now = this.now();
        this.state = {
          ...this.state,
          status: status === "EXECUTION_DISPATCHED" ? "RUNNING" : "IDLE",
          completedCount: status === "EXECUTION_DISPATCHED" ? this.state.completedCount + 1 : this.state.completedCount,
          lastSuccessfulWorkAt: now,
          lastHeartbeatAt: now,
          lastResult: { status, reason: safeText(result?.reason) || "UNSPECIFIED", headSha: typeof result?.headSha === "string" ? result.headSha.slice(0, 128) : null, workflowRunId: Number.isSafeInteger(result?.workflowRunId) ? result.workflowRunId : null },
          ...SAFETY,
        };
        await this.persist();
        return this.snapshot();
      } catch (error) {
        lastError = error instanceof Error ? error.message : "AUTOPILOT_TICK_FAILED";
        if (attempt < this.maxAttempts) {
          this.state = { ...this.state, retryCount: this.state.retryCount + 1, lastHeartbeatAt: this.now(), ...SAFETY };
          await this.persist();
          await this.sleep(Math.min(MAX_BACKOFF_MS, this.backoffMs * attempt));
        }
      }
    }
    const now = this.now();
    this.state = { ...this.state, status: "BLOCKED", failureCount: this.state.failureCount + 1, blockedCount: this.state.blockedCount + 1, lastHeartbeatAt: now, lastResult: { status: "BLOCKED", reason: lastError || "AUTOPILOT_TICK_FAILED", headSha: null, workflowRunId: null }, ...SAFETY };
    await this.persist();
    return this.snapshot();
  }

  async start() {
    if (this.running) return this.snapshot();
    await this.load();
    if (this.state.stateRecovery === "CORRUPT") return this.snapshot();
    this.running = true;
    const schedule = async () => {
      if (!this.running) return;
      await this.cycle();
      if (this.running) this.timer = setTimeout(schedule, this.intervalMs);
    };
    await schedule();
    return this.snapshot();
  }

  async stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.state = { ...this.state, status: "STOPPING", lastHeartbeatAt: this.now(), ...SAFETY };
    await this.persist();
    this.state = { ...this.state, status: "STOPPED", lastHeartbeatAt: this.now(), ...SAFETY };
    await this.persist();
    return this.snapshot();
  }
}

function createRuntimeFromEnv(env = process.env) {
  return new AutopilotRuntime({
    endpoint: env.NUSA_AUTOPILOT_RUNTIME_ENDPOINT,
    token: env.NUSA_AUTOPILOT_RUNTIME_TOKEN,
    statePath: env.NUSA_AUTOPILOT_STATE_PATH,
    intervalMs: env.NUSA_AUTOPILOT_INTERVAL_MS,
    maxAttempts: env.NUSA_AUTOPILOT_MAX_ATTEMPTS,
    backoffMs: env.NUSA_AUTOPILOT_BACKOFF_MS,
  });
}

if (require.main === module) {
  const runtime = createRuntimeFromEnv();
  if (!runtime.endpoint || !runtime.token) {
    console.error("AUTOPILOT_RUNTIME_ENDPOINT_AND_TOKEN_REQUIRED");
    process.exitCode = 1;
  } else {
    runtime.start().catch((error) => {
      console.error(error instanceof Error ? error.message : "AUTOPILOT_RUNTIME_START_FAILED");
      process.exitCode = 1;
    });
  }
  const shutdown = () => { runtime.stop().catch(() => { process.exitCode = 1; }); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

module.exports = { AutopilotRuntime, createRuntimeFromEnv, freshState, validateState, SAFETY, SCHEMA_VERSION };
