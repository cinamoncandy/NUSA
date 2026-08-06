/**
 * The graceful-shutdown state machine, pulled out of runtime.ts so it can be exercised as a pure
 * function of its inputs -- no real process, no real OS signal, no real HTTP listener -- on every
 * platform this repo's CI runs on (including Windows, where OS signal delivery to a child process
 * does not behave the way it does on POSIX; see the module doc on registerGracefulShutdown in
 * runtime.ts for why the *integration* test that actually sends SIGTERM/SIGINT is POSIX-only).
 *
 * This module makes no assumption about how `trigger` gets called -- a signal handler, a test, or
 * anything else -- which is exactly what makes it testable without an OS signal in the loop.
 */

export interface ShutdownDependencies {
  /** Stops whatever is running. Rejecting is a legitimate outcome, not a bug -- see the
   * `.catch` below. */
  readonly stop: () => Promise<void>;
  readonly exit: (code: number) => void;
  /** Milliseconds to wait for `stop()` before forcing exit(1). Defaults to 10s in production;
   * tests override this to keep the force-exit path fast to exercise. */
  readonly timeoutMs?: number;
  readonly log?: (line: string) => void;
  readonly errorLog?: (line: string) => void;
}

export interface ShutdownController {
  /** Idempotent: the first call starts shutdown; every call after that (whatever signal name it
   * carries) is a no-op. A second SIGTERM while already shutting down must not restart the
   * force-exit timer or call stop() twice. */
  readonly trigger: (signal: string) => void;
  readonly isShuttingDown: () => boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function createShutdownController(deps: ShutdownDependencies): ShutdownController {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const log = deps.log ?? ((line: string) => { process.stdout.write(line); });
  const errorLog = deps.errorLog ?? ((line: string) => { process.stderr.write(line); });
  let shuttingDown = false;

  const trigger = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`[cloud-runtime] received ${signal}, shutting down\n`);

    const forceExitTimer = setTimeout(() => {
      errorLog("[cloud-runtime] graceful shutdown timed out, forcing exit\n");
      deps.exit(1);
    }, timeoutMs);
    forceExitTimer.unref?.();

    deps.stop()
      .then(() => {
        clearTimeout(forceExitTimer);
        log("[cloud-runtime] stopped\n");
        deps.exit(0);
      })
      .catch((error: unknown) => {
        clearTimeout(forceExitTimer);
        errorLog(`[cloud-runtime] error during shutdown: ${error instanceof Error ? error.message : String(error)}\n`);
        deps.exit(1);
      });
  };

  return Object.freeze({ trigger, isShuttingDown: () => shuttingDown });
}
