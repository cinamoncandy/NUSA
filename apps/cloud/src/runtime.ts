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
import type { ResearchRuntimeMarketDataTick } from "./researchRuntimeCoordinator";
import type { ResearchRecoveryResult } from "../../../packages/contracts/src/researchRecovery";
import type { ResearchStatusProjection } from "../../../packages/contracts/src/researchAutomation";
import { buildPersonalPaperOperationsSnapshot } from "../../../packages/contracts/src/personalPaperOperations";

export interface CloudRuntimeDashboardHydratorLike {
  hydrate(provider: CloudDashboardStateProvider, observations?: readonly IntelligenceObservation[]): void;
}

export interface CloudRuntimeMarketDataClientLike {
  subscribe(markets: readonly string[]): void;
  start(): void;
  stop(): void;
}

export interface CloudRuntimeResearchRuntimeLike {
  onMarketData(tick: ResearchRuntimeMarketDataTick): void;
}

export interface CloudRuntimeResearchRecoveryLike {
  recover(): ResearchRecoveryResult;
}

export interface CloudRuntimeResearchAutomationLike {
  recover?(): ResearchRecoveryResult;
  onMarketData(tick: ResearchRuntimeMarketDataTick): void;
  /** Optional read-only status projection; absence is represented conservatively as Research unavailable. */
  statusProjection?(): ResearchStatusProjection | null;
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
  paperExecutionLoop?: PaperTradingExecutionLoop,
  researchRuntime?: CloudRuntimeResearchRuntimeLike,
  researchRecoveryCoordinator?: CloudRuntimeResearchRecoveryLike,
  researchAutomation?: CloudRuntimeResearchAutomationLike
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
  const effectiveResearchRuntime: CloudRuntimeResearchRuntimeLike | undefined = researchAutomation ?? researchRuntime;
  try {
    researchAutomation?.recover?.() ?? researchRecoveryCoordinator?.recover();
  } catch {
    // Research recovery owns its own fail-closed state. It must not abort or mutate PAPER/dashboard startup.
  }
  const clearPaperProjection = (): void => {
    try { effectivePaperRepository?.clear(); } catch { /* remain fail-closed */ }
    effectiveProvider.clear();
  };
  const projectPaperAccount = (): void => {
    if (effectivePaperLoop == null) return;
    const state = effectiveProvider.read({ userId: "operator", scopes: ["dashboard:read"] });
    if (state == null) { clearPaperProjection(); return; }
    try {
      effectiveProvider.set(effectivePaperLoop.applyToDashboard(state, Date.now()));
    } catch {
      clearPaperProjection();
    }
  };
  try {
    if (!recovered) dashboardHydrator.hydrate(effectiveProvider);
    projectPaperAccount();
  } catch {
    clearPaperProjection();
  }
  const observations = new Map<string, IntelligenceObservation>();
  const safeHydrate = (next: readonly IntelligenceObservation[]): void => {
    try { dashboardHydrator.hydrate(effectiveProvider, next); } catch { effectiveProvider.clear(); }
  };
  let marketConnectionState = config.upbitPublicDataEnabled ? "DISCONNECTED" : "DISABLED";
  const marketDataClient = config.upbitPublicDataEnabled
    ? marketDataClientFactory(
      config.upbitMarkets,
      (ticker) => {
        const observation = upbitTickerToIntelligenceObservation(ticker, { now: Date.now() });
        if (!observation) { safeHydrate([]); return; }
        observations.set(observation.id, observation);
        while (observations.size > 50) observations.delete(observations.keys().next().value!);
        safeHydrate([...observations.values()]);
        const researchTick = { market: ticker.code, price: ticker.trade_price, observedAt: ticker.trade_timestamp, now: Date.now() };
        try {
          effectiveResearchRuntime?.onMarketData(researchTick);
        } catch {
          // Research is a separate fail-closed bounded context. Its failure must not erase or mutate PAPER state.
        }
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
          if (result.status === "FAILED") clearPaperProjection();
          else projectPaperAccount();
        } else if (effectivePaperLoop != null) {
          clearPaperProjection();
        }
      },
      (state) => {
        marketConnectionState = state;
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
    },
    loadPaperOperations: (principal) => {
      const input = effectiveProvider.read(principal);
      if (input === undefined) throw new Error("dashboard state is not ready");
      const dashboard = buildMobileDashboardResponse(input);
      const paperSnapshot = effectivePaperLoop?.snapshot();
      const transport = marketConnectionState === "CONNECTED" ? "ONLINE" as const : "OFFLINE" as const;
      const runtimeState = dashboard.mode === "FAULTED" || dashboard.killSwitchActive
        ? "HALTED" as const
        : dashboard.mode === "STOPPED"
          ? "STOPPED" as const
          : effectivePaperLoop == null
            ? "STOPPED" as const
            : transport === "ONLINE"
              ? "READY" as const
              : "READY_OFFLINE" as const;
      return buildPersonalPaperOperationsSnapshot({
        dashboard,
        research: researchAutomation?.statusProjection?.() ?? null,
        operations: {
          runtimeState,
          schedulerRunning: false,
          schedulerMode: "OFF",
          pipelineStage: effectivePaperLoop == null ? "READ_ONLY_DASHBOARD" : "PAPER_EXECUTION_LOOP",
          transport,
          killSwitchActive: dashboard.killSwitchActive,
          accountHalted: dashboard.mode === "FAULTED",
          pendingWrites: 0,
          ...(paperSnapshot != null && paperSnapshot.updatedAt > 0 ? { lastEventAt: paperSnapshot.updatedAt } : {}),
          updatedAt: dashboard.generatedAt
        }
      }, dashboard.generatedAt);
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
