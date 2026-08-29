import type { IpcMain } from "electron";
import { loadUpbitCredentials, UpbitConfigurationError, type UpbitOrder } from "../exchange/upbitRestAdapter";
import type { UpbitSubmitOrderRequest } from "../exchange/upbitExecutionRestClient";
import { RestrictedLiveUpbitOrderTransport } from "../exchange/restrictedLiveUpbitOrderTransport";

const PLACE_ORDER_CHANNEL = "restricted-live:place-order";
const CANCEL_ALL_CHANNEL = "restricted-live:cancel-all";
const STATUS_CHANNEL = "restricted-live:status";
const REQUIRED_CONFIRMATION = "CONFIRM_UPBIT_LIVE_ORDER";
const REQUIRED_CANCEL_CONFIRMATION = "CONFIRM_CANCEL_ALL_UPBIT_ORDERS";

export interface RestrictedLiveStatus {
  readonly configured: boolean;
  readonly mutationEnabled: boolean;
  readonly ipcEnabled: boolean;
  readonly maxOrderAmountKrw: number | null;
}

export interface RestrictedLiveOrderIpcRequest {
  readonly confirmation: string;
  readonly order: UpbitSubmitOrderRequest;
}

export interface RestrictedLiveCancelAllIpcRequest {
  readonly confirmation: string;
  readonly market?: string;
}

export function registerLiveTradingIpcHandlers(ipcMain: IpcMain, environment: NodeJS.ProcessEnv = process.env): void {
  ipcMain.handle(STATUS_CHANNEL, async () => readStatus(environment));

  ipcMain.handle(PLACE_ORDER_CHANNEL, async (_event, input: unknown): Promise<UpbitOrder> => {
    const request = parseOrderRequest(input);
    if (request.confirmation !== REQUIRED_CONFIRMATION) throw new UpbitConfigurationError("Explicit live-order confirmation is required");
    const transport = createRestrictedLiveTransport(environment);
    return transport.submitOrder(request.order);
  });

  ipcMain.handle(CANCEL_ALL_CHANNEL, async (_event, input: unknown): Promise<readonly UpbitOrder[]> => {
    const request = parseCancelAllRequest(input);
    if (request.confirmation !== REQUIRED_CANCEL_CONFIRMATION) throw new UpbitConfigurationError("Explicit cancel-all confirmation is required");
    const transport = createRestrictedLiveTransport(environment);
    return transport.cancelAllOpenOrders(request.market);
  });
}

export function readRestrictedLiveStatus(environment: NodeJS.ProcessEnv = process.env): RestrictedLiveStatus {
  return readStatus(environment);
}

function createRestrictedLiveTransport(environment: NodeJS.ProcessEnv): RestrictedLiveUpbitOrderTransport {
  const status = readStatus(environment);
  if (!status.configured) throw new UpbitConfigurationError("Restricted-LIVE requires NUSA_TRADING_ADAPTER_MODE=LIVE and NUSA_ENABLE_LIVE_ADAPTER=true");
  if (!status.mutationEnabled) throw new UpbitConfigurationError("Restricted-LIVE mutation is disabled");
  if (!status.ipcEnabled) throw new UpbitConfigurationError("Restricted-LIVE IPC is disabled");
  if (status.maxOrderAmountKrw === null) throw new UpbitConfigurationError("NUSA_MAX_LIVE_ORDER_AMOUNT_KRW must be an integer >= 5000");
  return new RestrictedLiveUpbitOrderTransport({
    credentials: loadUpbitCredentials(environment),
    maxOrderAmountKrw: status.maxOrderAmountKrw,
  });
}

function readStatus(environment: NodeJS.ProcessEnv): RestrictedLiveStatus {
  const mode = environment.NUSA_TRADING_ADAPTER_MODE?.trim().toUpperCase();
  const liveAdapterEnabled = environment.NUSA_ENABLE_LIVE_ADAPTER?.trim().toLowerCase() === "true";
  const mutationEnabled = environment.NUSA_ENABLE_LIVE_ORDER_MUTATION?.trim().toLowerCase() === "true";
  const ipcEnabled = environment.NUSA_ENABLE_RESTRICTED_LIVE_IPC?.trim().toLowerCase() === "true";
  const rawCap = environment.NUSA_MAX_LIVE_ORDER_AMOUNT_KRW?.trim() ?? "";
  const parsedCap = Number(rawCap);
  const maxOrderAmountKrw = Number.isSafeInteger(parsedCap) && parsedCap >= 5_000 ? parsedCap : null;
  return Object.freeze({
    configured: mode === "LIVE" && liveAdapterEnabled,
    mutationEnabled,
    ipcEnabled,
    maxOrderAmountKrw,
  });
}

function parseOrderRequest(input: unknown): RestrictedLiveOrderIpcRequest {
  if (!isRecord(input)) throw new UpbitConfigurationError("Invalid live-order IPC payload");
  if (typeof input.confirmation !== "string") throw new UpbitConfigurationError("Live-order confirmation is required");
  if (!isRecord(input.order)) throw new UpbitConfigurationError("Live-order request is required");
  const order = input.order;
  if (typeof order.market !== "string" || typeof order.side !== "string" || typeof order.ord_type !== "string") {
    throw new UpbitConfigurationError("Live-order market, side and ord_type are required");
  }
  const parsed: UpbitSubmitOrderRequest = {
    market: order.market,
    side: order.side as UpbitSubmitOrderRequest["side"],
    ord_type: order.ord_type as UpbitSubmitOrderRequest["ord_type"],
    ...(typeof order.volume === "string" ? { volume: order.volume } : {}),
    ...(typeof order.price === "string" ? { price: order.price } : {}),
    ...(typeof order.identifier === "string" ? { identifier: order.identifier } : {}),
    ...(typeof order.time_in_force === "string" ? { time_in_force: order.time_in_force as UpbitSubmitOrderRequest["time_in_force"] } : {}),
    ...(typeof order.smp_type === "string" ? { smp_type: order.smp_type as UpbitSubmitOrderRequest["smp_type"] } : {}),
  };
  return Object.freeze({ confirmation: input.confirmation, order: Object.freeze(parsed) });
}

function parseCancelAllRequest(input: unknown): RestrictedLiveCancelAllIpcRequest {
  if (!isRecord(input) || typeof input.confirmation !== "string") throw new UpbitConfigurationError("Invalid cancel-all IPC payload");
  if (input.market !== undefined && typeof input.market !== "string") throw new UpbitConfigurationError("Cancel-all market must be a string");
  return Object.freeze({ confirmation: input.confirmation, ...(typeof input.market === "string" ? { market: input.market } : {}) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
