import type { MobileDashboardResponse } from "../../../packages/contracts/src/mobileDashboard";
import { readCloudRuntimeConfig, createSharedSecretTokenVerifier } from "./cloudRuntimeConfig";
import { startCloudDashboardServer, type CloudDashboardServerHandle } from "./server";

const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Nothing in apps/cloud/src wires a real portfolio/control-plane data source into
 * `loadDashboard` yet -- that is the cloud-vs-mobile architecture question the paper-engine port
 * (3-2) explicitly left open, not something this bootstrap can invent. Throwing here is the
 * honest answer: `handleMobileDashboardHttp` catches it and reports 503 DASHBOARD_UNAVAILABLE,
 * so the process is genuinely up (health check below reflects that) while plainly saying the
 * data path is not configured, instead of returning fabricated numbers.
 */
function loadDashboardNotConfigured(): MobileDashboardResponse {
  throw new Error("no dashboard data source is wired into the cloud runtime yet");
}

export function startCloudRuntime(env: NodeJS.ProcessEnv = process.env): CloudDashboardServerHandle {
  const config = readCloudRuntimeConfig(env);
  const tokenVerifier = createSharedSecretTokenVerifier(config.dashboardToken);
  const handle = startCloudDashboardServer({
    port: config.port,
    ...(config.host ? { host: config.host } : {}),
    tokenVerifier,
    loadDashboard: loadDashboardNotConfigured
  });
  process.stdout.write(`[cloud-runtime] listening on ${handle.host}:${handle.port}\n`);
  return handle;
}

/**
 * Registers SIGTERM/SIGINT handlers that stop the server and exit. A second signal, or a stop()
 * that never resolves, must not leave the process hanging forever under a process supervisor --
 * the timeout forces exit(1) so systemd (or whatever starts this) sees a real failure to shut
 * down cleanly rather than an indefinite stop/restart wait.
 */
export function registerGracefulShutdown(handle: CloudDashboardServerHandle, exit: (code: number) => void = process.exit): void {
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`[cloud-runtime] received ${signal}, shutting down\n`);
    const forceExitTimer = setTimeout(() => {
      process.stderr.write("[cloud-runtime] graceful shutdown timed out, forcing exit\n");
      exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExitTimer.unref();
    handle.stop()
      .then(() => {
        clearTimeout(forceExitTimer);
        process.stdout.write("[cloud-runtime] stopped\n");
        exit(0);
      })
      .catch((error: unknown) => {
        clearTimeout(forceExitTimer);
        process.stderr.write(`[cloud-runtime] error during shutdown: ${error instanceof Error ? error.message : String(error)}\n`);
        exit(1);
      });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

function main(): void {
  const handle = startCloudRuntime();
  registerGracefulShutdown(handle);
}

if (require.main === module) main();
