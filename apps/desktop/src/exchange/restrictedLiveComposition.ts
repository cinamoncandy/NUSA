import type { IpcMain } from "electron";
import { registerLiveTradingIpcHandlers } from "../ipc/registerLiveTradingIpcHandlers";
import { readTradingAdapterEnvironment } from "./liveTradingAdapter";

/**
 * Explicit composition root for a future Restricted-LIVE desktop/runtime entrypoint.
 * The ordinary NUSA desktop main process must not call this function while its production
 * policy advertises live/private/credential capabilities as disabled.
 */
export function composeRestrictedLiveTrading(ipcMain: IpcMain, environment: NodeJS.ProcessEnv = process.env): void {
  const configuration = readTradingAdapterEnvironment(environment);
  if (configuration.mode !== "LIVE" || !configuration.liveAdapterEnabled || !configuration.liveOrderMutationEnabled) {
    throw new Error("Restricted-LIVE composition requires LIVE adapter and live-order mutation switches");
  }
  if (environment.NUSA_ENABLE_RESTRICTED_LIVE_IPC?.trim().toLowerCase() !== "true") {
    throw new Error("Restricted-LIVE IPC requires NUSA_ENABLE_RESTRICTED_LIVE_IPC=true");
  }
  registerLiveTradingIpcHandlers(ipcMain, environment);
}
