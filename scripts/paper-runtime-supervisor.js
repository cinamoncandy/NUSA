const { spawn } = require("node:child_process");

const DEFAULT_INITIAL_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 30_000;
const DEFAULT_STABLE_WINDOW_MS = 60_000;

function boundedBackoffMs(attempt, initialMs = DEFAULT_INITIAL_BACKOFF_MS, maxMs = DEFAULT_MAX_BACKOFF_MS) {
  if (!Number.isSafeInteger(attempt) || attempt < 0) throw new Error("supervisor attempt must be a non-negative safe integer");
  if (!Number.isSafeInteger(initialMs) || initialMs < 1) throw new Error("supervisor initial backoff must be positive");
  if (!Number.isSafeInteger(maxMs) || maxMs < initialMs) throw new Error("supervisor max backoff must be >= initial backoff");
  return Math.min(maxMs, initialMs * (2 ** Math.min(attempt, 30)));
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
      status: this.stopping ? "STOPPING" : this.child == null ? (this.restartTimer == null ? "OFFLINE" : "RECOVERING") : "RUNNING",
      restartAttempt: this.restartAttempt,
      restartCount: this.restartCount,
      startedAt: this.startedAt,
      lastExit: this.lastExit == null ? null : Object.freeze({ ...this.lastExit }),
      liveAuthority: "NONE",
      productionMutationAllowed: false,
    });
  }

  start() {
    if (this.stopping) throw new Error("PAPER_RUNTIME_SUPERVISOR_STOPPING");
    if (this.child != null || this.restartTimer != null) return this.snapshot();
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
    const child = this.spawnFn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
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

    if (uptimeMs >= this.stableWindowMs) this.restartAttempt = 0;
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
};
