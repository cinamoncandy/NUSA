import type { MobileDashboardResponse } from "../../../packages/contracts/src/mobileDashboard";
import { readCloudRuntimeConfig, createSharedSecretTokenVerifier } from "./cloudRuntimeConfig";
import { createShutdownController, type ShutdownController } from "./cloudRuntimeShutdown";
import { startCloudDashboardServer, type CloudDashboardServerHandle } from "./server";

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
 * Registers SIGTERM/SIGINT handlers that stop the server and exit. The actual shutdown state
 * machine lives in cloudRuntimeShutdown.ts, as a function of injected `stop`/`exit` -- this
 * function's only job is wiring real OS signals to it.
 *
 * On Windows, sending a signal to a child process (`child.kill("SIGTERM")`) does not invoke this
 * handler at all -- Node documents that Windows has no real POSIX signal delivery, and
 * `child.kill()` there terminates the process directly. That is a real, correct platform
 * difference, not something this function can paper over: forcing POSIX signal semantics onto
 * Windows would mean faking behavior the OS doesn't provide. The handlers below are registered
 * unconditionally (they are harmless no-ops if nothing ever calls them), and the *integration*
 * test that verifies "SIGTERM actually reaches this handler and exits cleanly" is POSIX-only for
 * the same reason -- see tests/cloud-runtime-bootstrap.test.js. The shutdown state machine itself
 * (createShutdownController) is tested directly, without any OS signal, on every platform.
 */
export function registerGracefulShutdown(handle: CloudDashboardServerHandle, exit: (code: number) => void = process.exit): ShutdownController {
  const controller = createShutdownController({ stop: () => handle.stop(), exit });
  process.on("SIGTERM", () => controller.trigger("SIGTERM"));
  process.on("SIGINT", () => controller.trigger("SIGINT"));
  return controller;
}

function main(): void {
  const handle = startCloudRuntime();
  registerGracefulShutdown(handle);
}

if (require.main === module) main();
