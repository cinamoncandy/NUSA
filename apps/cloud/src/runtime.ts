import { buildMobileDashboardResponse } from "./mobileDashboardApi";
import { InMemoryCloudDashboardStateProvider, type CloudDashboardStateProvider } from "./cloudDashboardStateProvider";
import { readCloudRuntimeConfig, createSharedSecretTokenVerifier } from "./cloudRuntimeConfig";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import { DurableCloudDashboardStateProvider } from "./durableCloudDashboardStateProvider";
import { SqliteCloudDashboardSnapshotRepository, type CloudDashboardSnapshotRepository } from "./cloudDashboardSnapshotRepository";
import { PaperTradingExecutionLoop, SqliteCloudPaperAccountRepository, type PaperAccountRepository } from "./paperTradingExecutionLoop";
import fs from "node:fs";
import path from "node:path";
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

function createSnapshotRepository(pathname: string): CloudDashboardSnapshotRepository {
  if (pathname !== ":memory:") {
    const absolute = path.resolve(pathname);
    const sourceTree = path.resolve(process.cwd()) + path.sep;
    if (absolute === path.resolve(process.cwd()) || absolute.startsWith(sourceTree)) throw new Error("cloud state database must not be inside the source tree");
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
  }
  return new SqliteCloudDashboardSnapshotRepository(new SqliteDatabase(pathname));
}

export function startCloudRuntime(
  env: NodeJS.ProcessEnv = process.env,
  stateProvider: CloudDashboardStateProvider = new InMemoryCloudDashboardStateProvider(),
  dashboardHydrator: CloudRuntimeDashboardHydratorLike = new CloudRuntimeDashboardHydrator(),
  marketDataClientFactory: CloudRuntimeMarketDataClientFactory = (markets, onTicker, onConnectionState) =>
    new UpbitWebSocketClient(markets, onTicker, undefined, undefined, undefined, { onConnectionState: (diagnostics) => onConnectionState(diagnostics.marketConnectionState) } satisfies UpbitWebSocketOptions),
  snapshotRepository?: CloudDashboardSnapshotRepository,
  paperAccountRepository?: PaperAccountRepository,
  paperExecutionLoop?: PaperTradingExecutionLoop
): CloudDashboardServerHandle {
  const config = readCloudRuntimeConfig(env);
  const tokenVerifier = createSharedSecretTokenVerifier(config.dashboardToken);
  const durableRepository = snapshotRepository ?? (env.NUSA_CLOUD_STATE_DB_PATH === undefined ? undefined : createSnapshotRepository(config.cloudStateDbPath));
  const effectiveProvider = durableRepository == null
    ? stateProvider
    : new DurableCloudDashboardStateProvider(stateProvider, durableRepository, env.NUSA_SOURCE_COMMIT?.trim() || "unknown", env.NUSA_CLOUD_SOURCE_VERSION?.trim() || "unknown");
  const recovered = durableRepository != null && effectiveProvider instanceof DurableCloudDashboardStateProvider && effectiveProvider.recover();
  const effectivePaperRepository = paperAccountRepository ?? (config.paperInitialCapitalKrw !== undefined && durableRepository instanceof SqliteCloudDashboardSnapshotRepository
    ? new SqliteCloudPaperAccountRepository(durableRepository.database())
    : undefined);
  const effectivePaperLoop = paperExecutionLoop ?? (config.paperInitialCapitalKrw === undefined || effectivePaperRepository === undefined
    ? undefined
    : new PaperTradingExecutionLoop({ initialCapital: config.paperInitialCapitalKrw, repository: effectivePaperRepository }));
  try {
    if (!recovered) dashboardHydrator.hydrate(effectiveProvider);
  } catch {
    effectiveProvider.clear();
  }
  const observations = new Map<string, IntelligenceObservation>();
  const safeHydrate = (next: readonly IntelligenceObservation[]): void => {
    try { dashboardHydrator.hydrate(effectiveProvider, next); } catch { effectiveProvider.clear(); }
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
        const state = effectiveProvider.read({ userId: "operator", scopes: ["dashboard:read"] });
        if (effectivePaperLoop != null && state != null) {
          const dashboard = buildMobileDashboardResponse(state);
          const result = effectivePaperLoop.processTick({
            now: Date.now(),
            market: ticker.code,
            price: ticker.trade_price,
            observedAt: ticker.trade_timestamp,
            mode: state.mode,
            killSwitchActive: state.killSwitchActive,
            tradingAllowed: dashboard.tradingAllowed,
            overallHealth: state.overallHealth,
            decisions: state.decisions
          });
          if (result.status === "FILLED") {
            try {
              effectiveProvider.set(effectivePaperLoop.applyToDashboard(state, Date.now()));
            } catch {
              // The account is durable before the dashboard projection. Clear both sides on a
              // projection failure so restart cannot observe a paper account without its snapshot.
              try { effectivePaperRepository?.clear(); } catch { /* remain fail-closed */ }
              effectiveProvider.clear();
            }
          }
        }
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
      const input = effectiveProvider.read(principal);
      if (input === undefined) throw new Error("dashboard state is not ready");
      return buildMobileDashboardResponse(input);
    }
  });
  process.stdout.write(`[cloud-runtime] listening on ${handle.host}:${handle.port}\n`);
  return {
    ...handle,
    stop: async () => {
      try {
        marketDataClient?.stop();
        await handle.stop();
      } finally {
        if (durableRepository != null) effectiveProvider instanceof DurableCloudDashboardStateProvider ? effectiveProvider.close() : durableRepository.close();
      }
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
  const config = readCloudRuntimeConfig(process.env);
  const handle = startCloudRuntime(process.env, undefined, undefined, undefined, createSnapshotRepository(config.cloudStateDbPath));
  registerGracefulShutdown(handle);
}

if (require.main === module) main();
