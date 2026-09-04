const { spawn } = require("node:child_process");

const DEFAULT_INITIAL_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;
const DEFAULT_STABLE_WINDOW_MS = 60_000;
const DEFAULT_MAX_RESTARTS = 10;
const DEFAULT_MAX_RESTART_WINDOW_MS = 600_000;

function boundedBackoffMs(attempt, initialMs = DEFAULT_INITIAL_BACKOFF_MS, maxMs = DEFAULT_MAX_BACKOFF_MS) {
  if (!Number.isSafeInteger(attempt) || attempt < 0) throw new Error("supervisor attempt must be a non-negative safe integer");
  if (!Number.isSafeInteger(initialMs) || initialMs < 1) throw new Error("supervisor initial backoff must be positive");
  if (!Number.isSafeInteger(maxMs) || maxMs < initialMs) throw new Error("supervisor max backoff must be >= initial backoff");
  return Math.min(maxMs, initialMs * (2 ** Math.min(attempt, 30)));
}

function supervisorChildEnv(baseEnv, snapshot) {
  const env = {
    ...baseEnv,
    NUSA_PAPER_SUPERVISOR_MANAGED: "true",
    NUSA_PAPER_SUPERVISOR_RESTART_ATTEMPT: String(snapshot.restartAttempt),
    NUSA_PAPER_SUPERVISOR_RESTART_COUNT: String(snapshot.restartCount),
    NUSA_PAPER_SUPERVISOR_STARTED_AT: String(snapshot.startedAt),
  };
  if (baseEnv.NUSA_PAPER_CHAOS_E2E_NON_MUTATING === "true") {
    env.NUSA_CLOUD_PAPER_INVESTMENT_PERCENT = "0";
  }
  if (snapshot.lastExit != null) {
    env.NUSA_PAPER_SUPERVISOR_LAST_EXIT_CODE = snapshot.lastExit.code == null ? "" : String(snapshot.lastExit.code);
    env.NUSA_PAPER_SUPERVISOR_LAST_EXIT_SIGNAL = snapshot.lastExit.signal == null ? "" : String(snapshot.lastExit.signal);
    env.NUSA_PAPER_SUPERVISOR_LAST_EXITED_AT = String(snapshot.lastExit.exitedAt);
    env.NUSA_PAPER_SUPERVISOR_LAST_UPTIME_MS = String(snapshot.lastExit.uptimeMs);
  }
  return env;
}

class PaperRuntimeProcessSupervisor {
  constructor(options = {}) {
    this.spawnFn = options.spawn ?? spawn;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.now = options.now ?? Date.now;
    this.write = options.write ?? ((text) => process.stdout.write(text));
    this.cwd = options.cwd ?? process.cwd();
    this.env = options.env ?? process.env;
    this.initialBackoffMs = options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.stableWindowMs = options.stableWindowMs ?? DEFAULT_STABLE_WINDOW_MS;
    this.maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
    this.maxRestartWindowMs = options.maxRestartWindowMs ?? DEFAULT_MAX_RESTART_WINDOW_MS;
    if (!Number.isSafeInteger(this.maxRestarts) || this.maxRestarts < 1) throw new Error("SUPERVISOR_RESTART_BUDGET_UNBOUNDED: maxRestarts must be a positive safe integer");
    if (!Number.isSafeInteger(this.maxRestartWindowMs) || this.maxRestartWindowMs < this.initialBackoffMs) throw new Error("SUPERVISOR_RESTART_WINDOW_INVALID: maxRestartWindowMs must cover at least one backoff");
    this.unstableWindowStartMs = null;
    this.unstableStreak = 0;
    this.gaveUp = false;
    this.command = options.command ?? process.execPath;
    this.args = options.args ?? ["scripts/start-cloud-runtime.js"];
    this.child = null;
    this.restartTimer = null;
    this.stopping = false;
    this.restartAttempt = 0;
    this.startedAt = null;
    this.restartCount = 0;
    this.lastExit = null;
  }

  snapshot() {
    return Object.freeze({
      mode: "PAPER_ONLY",
      status: this.stopping ? "STOPPING" : this.gaveUp ? "FAILED" : this.child == null ? (this.restartTimer == null ? "OFFLINE" : "RECOVERING") : "RUNNING",
      restartAttempt: this.restartAttempt,
      restartCount: this.restartCount,
      startedAt: this.startedAt,
      lastExit: this.lastExit == null ? null : Object.freeze({ ...this.lastExit }),
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    });
  }

  start() {
    if (this.stopping) throw new Error("PAPER_RUNTIME_SUPERVISOR_STOPPING");
    if (this.child != null || this.restartTimer != null) return this.snapshot();
    if (this.gaveUp) {
      this.gaveUp = false;
      this.restartAttempt = 0;
      this.unstableStreak = 0;
      this.unstableWindowStartMs = null;
      this.write("[paper-supervisor] manual restart after FAILED; restart budget restored\n");
    }
    this.launch();
    return this.snapshot();
  }

  stop(signal = "SIGTERM") {
    this.stopping = true;
    if (this.restartTimer != null) {
      this.clearTimer(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    if (child != null && child.exitCode == null) child.kill(signal);
    return this.snapshot();
  }

  launch() {
    if (this.stopping) return;
    this.startedAt = this.now();
    const launchSnapshot = this.snapshot();
    const child = this.spawnFn(this.command, this.args, {
      cwd: this.cwd,
      env: supervisorChildEnv(this.env, { ...launchSnapshot, startedAt: this.startedAt }),
      stdio: "inherit",
      shell: false,
    });
    this.child = child;
    this.write(`[paper-supervisor] runtime started pid=${child.pid ?? "unknown"}\n`);
    child.once("exit", (code, signal) => this.onExit(code, signal));
    child.once("error", (error) => this.onError(error));
  }

  onError(error) {
    this.write(`[paper-supervisor] child process error: ${error instanceof Error ? error.message : "unknown"}\n`);
  }

  onExit(code, signal) {
    const exitedAt = this.now();
    const uptimeMs = this.startedAt == null ? 0 : Math.max(0, exitedAt - this.startedAt);
    this.lastExit = Object.freeze({ code: code ?? null, signal: signal ?? null, exitedAt, uptimeMs });
    this.child = null;
    if (this.stopping) return;

    // Consecutive unstable exits consume the restart budget; a stable run
    // restores it in full. restartAttempt keeps its legacy backoff meaning
    // (and snapshot shape); unstableStreak counts budget consumption.
    if (uptimeMs >= this.stableWindowMs) {
      this.restartAttempt = 0;
      this.unstableStreak = 0;
      this.unstableWindowStartMs = null;
    } else {
      if (this.unstableWindowStartMs == null) this.unstableWindowStartMs = exitedAt;
      this.unstableStreak += 1;
    }
    if (this.unstableStreak > this.maxRestarts || (this.unstableWindowStartMs != null && exitedAt - this.unstableWindowStartMs >= this.maxRestartWindowMs)) {
      this.gaveUp = true;
      this.write(`[paper-supervisor] restart budget exhausted after ${this.restartCount} restarts; FAILED, manual start() required\n`);
      return;
    }
    const delay = boundedBackoffMs(this.restartAttempt, this.initialBackoffMs, this.maxBackoffMs);
    this.restartAttempt += 1;
    this.restartCount += 1;
    this.write(`[paper-supervisor] runtime exited code=${code ?? "null"} signal=${signal ?? "none"}; restart in ${delay}ms\n`);
    this.restartTimer = this.setTimer(() => {
      this.restartTimer = null;
      this.launch();
    }, delay);
    this.restartTimer?.unref?.();
  }
}

function run(options = {}) {
  const supervisor = new PaperRuntimeProcessSupervisor(options);
  supervisor.start();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => supervisor.stop(signal));
  }
  return supervisor;
}

if (require.main === module) run();

module.exports = {
  PaperRuntimeProcessSupervisor,
  boundedBackoffMs,
  run,
  supervisorChildEnv,
};
