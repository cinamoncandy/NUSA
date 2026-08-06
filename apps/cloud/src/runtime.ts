import { buildMobileDashboardResponse } from "./mobileDashboardApi";
import { InMemoryCloudDashboardStateProvider, type CloudDashboardStateProvider } from "./cloudDashboardStateProvider";
import { readCloudRuntimeConfig, createSharedSecretTokenVerifier } from "./cloudRuntimeConfig";
import { createShutdownController, type ShutdownController } from "./cloudRuntimeShutdown";
import { startCloudDashboardServer, type CloudDashboardServerHandle } from "./server";
import { CloudRuntimeDashboardHydrator } from "./cloudRuntimeDashboardHydrator";
import { UpbitWebSocketClient, type UpbitTicker, type UpbitWebSocketOptions } from "./upbitWebSocket";
import { upbitTickerToIntelligenceObservation } from "./upbitTickerObservation";
import type { IntelligenceObservation } from "./marketIntelligenceFusion";

export interface CloudRuntimeDashboardHydratorLike {
  hydrate(provider: CloudDashboardStateProvider, observations?: readonly IntelligenceObservation[]): void;
}

export interface CloudRuntimeMarketDataClientLike {
  subscribe(markets: readonly string[]): void;
  start(): void;
  stop(): void;
}

export type CloudRuntimeMarketDataClientFactory = (
  markets: readonly string[],
  onTicker: (ticker: UpbitTicker) => void,
  onConnectionState: (state: string) => void
) => CloudRuntimeMarketDataClientLike;

export function startCloudRuntime(
  env: NodeJS.ProcessEnv = process.env,
  stateProvider: CloudDashboardStateProvider = new InMemoryCloudDashboardStateProvider(),
  dashboardHydrator: CloudRuntimeDashboardHydratorLike = new CloudRuntimeDashboardHydrator(),
  marketDataClientFactory: CloudRuntimeMarketDataClientFactory = (markets, onTicker, onConnectionState) =>
    new UpbitWebSocketClient(markets, onTicker, undefined, undefined, undefined, { onConnectionState: (diagnostics) => onConnectionState(diagnostics.marketConnectionState) } satisfies UpbitWebSocketOptions)
): CloudDashboardServerHandle {
  const config = readCloudRuntimeConfig(env);
  const tokenVerifier = createSharedSecretTokenVerifier(config.dashboardToken);
  try {
    dashboardHydrator.hydrate(stateProvider);
  } catch {
    stateProvider.clear();
  }
  const observations = new Map<string, IntelligenceObservation>();
  const safeHydrate = (next: readonly IntelligenceObservation[]): void => {
    try { dashboardHydrator.hydrate(stateProvider, next); } catch { stateProvider.clear(); }
  };
  const marketDataClient = config.upbitPublicDataEnabled
    ? marketDataClientFactory(
      config.upbitMarkets,
      (ticker) => {
        const observation = upbitTickerToIntelligenceObservation(ticker, { now: Date.now() });
        if (!observation) { safeHydrate([]); return; }
        observations.set(observation.id, observation);
        while (observations.size > 50) observations.delete(observations.keys().next().value!);
        safeHydrate([...observations.values()]);
      },
      (state) => {
        if (state !== "CONNECTED") {
          observations.clear();
          safeHydrate([]);
        }
      }
    )
    : undefined;
  if (marketDataClient) {
    marketDataClient.subscribe(config.upbitMarkets);
    marketDataClient.start();
  }
  const handle = startCloudDashboardServer({
    port: config.port,
    ...(config.host ? { host: config.host } : {}),
    tokenVerifier,
    loadDashboard: (principal) => {
      const input = stateProvider.read(principal);
      if (input === undefined) throw new Error("dashboard state is not ready");
      return buildMobileDashboardResponse(input);
    }
  });
  process.stdout.write(`[cloud-runtime] listening on ${handle.host}:${handle.port}\n`);
  return {
    ...handle,
    stop: async () => {
      marketDataClient?.stop();
      await handle.stop();
    }
  };
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
