import { mobileApprovedSession } from "./mobileApprovedSessionBoundary";
import { loadUpbitLiveAccounts, UPBIT_LIVE_BASE_URL } from "./upbitLiveClient";
import { normalizeUpbitReadOnlySnapshot, type UpbitReadOnlyAccountSnapshot } from "./upbitReadOnlyAccountModel";
export type { UpbitReadOnlyAccountSnapshot, UpbitReadOnlyAsset } from "./upbitReadOnlyAccountModel";

export type UpbitReadOnlyConnectionStatus = "DISCONNECTED" | "LOADING" | "READY" | "STALE" | "ERROR";
export type UpbitReadOnlyMonitorStatus = "CONNECTED" | "STALE" | "AUTH_ERROR" | "RELAY_ERROR" | "OFFLINE";

export interface UpbitReadOnlyState {
  readonly status: UpbitReadOnlyConnectionStatus;
  readonly monitorStatus: UpbitReadOnlyMonitorStatus;
  readonly snapshot: UpbitReadOnlyAccountSnapshot | null;
  readonly lastSuccessAt: number | null;
  readonly error: string | null;
}

export const initialUpbitReadOnlyState: UpbitReadOnlyState = Object.freeze({
  status: "DISCONNECTED",
  monitorStatus: "OFFLINE",
  snapshot: null,
  lastSuccessAt: null,
  error: null,
});

const REFRESH_INTERVAL_MS = 30_000;
const STALE_AFTER_MS = 90_000;
let currentState: UpbitReadOnlyState = initialUpbitReadOnlyState;
let activeBaseUrl: string | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let refreshInFlight: Promise<UpbitReadOnlyState> | null = null;
let sessionGeneration = 0;
const listeners = new Set<() => void>();

export function getUpbitReadOnlyState(): UpbitReadOnlyState { return currentState; }
export function subscribeUpbitReadOnlyState(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export function setUpbitReadOnlyState(next: UpbitReadOnlyState): void {
  currentState = Object.freeze(next);
  listeners.forEach((listener) => listener());
}

function classifyMonitorFailure(detail: string): UpbitReadOnlyMonitorStatus {
  const normalized = detail.trim().toUpperCase();
  if (normalized.includes("UNAUTHORIZED") || normalized.includes("HTTP_401") || normalized.includes("HTTP_403") || normalized.includes("CREDENTIAL")) return "AUTH_ERROR";
  if (normalized.includes("SERVICE_NOT_CONFIGURED") || normalized.includes("UPSTREAM_FAILURE") || normalized.includes("HTTP_5") || normalized.includes("INVALID UPBIT")) return "RELAY_ERROR";
  return "OFFLINE";
}

function stopRefreshTimer(): void {
  if (refreshTimer !== null) clearInterval(refreshTimer);
  refreshTimer = null;
}

function startRefreshTimer(): void {
  stopRefreshTimer();
  refreshTimer = setInterval(() => { void refreshUpbitReadOnlyAccount(); }, REFRESH_INTERVAL_MS);
}

export function resetUpbitReadOnlyState(): void {
  sessionGeneration += 1;
  stopRefreshTimer();
  refreshInFlight = null;
  activeBaseUrl = null;
  setUpbitReadOnlyState(initialUpbitReadOnlyState);
}

export async function refreshUpbitReadOnlyAccount(): Promise<UpbitReadOnlyState> {
  if (refreshInFlight) return refreshInFlight;
  if (!activeBaseUrl) {
    const next: UpbitReadOnlyState = currentState.snapshot
      ? { status: "STALE", monitorStatus: "STALE", snapshot: currentState.snapshot, lastSuccessAt: currentState.lastSuccessAt, error: "PAPER 보안 세션을 사용할 수 없습니다." }
      : initialUpbitReadOnlyState;
    setUpbitReadOnlyState(next);
    return next;
  }

  const generation = sessionGeneration;
  const baseUrl = activeBaseUrl;
  const previous = currentState.snapshot;
  const previousLastSuccessAt = currentState.lastSuccessAt;
  setUpbitReadOnlyState({
    status: previous ? "STALE" : "LOADING",
    monitorStatus: previous ? "STALE" : currentState.monitorStatus,
    snapshot: previous,
    lastSuccessAt: previousLastSuccessAt,
    error: null,
  });

  const request = (async (): Promise<UpbitReadOnlyState> => {
    try {
      const snapshot = normalizeUpbitReadOnlySnapshot(await loadUpbitLiveAccounts({ credentialProvider: mobileApprovedSession().credentialProvider, baseUrl }));
      if (generation !== sessionGeneration) return currentState;
      const stale = Date.now() - snapshot.fetchedAt > STALE_AFTER_MS;
      const next: UpbitReadOnlyState = {
        status: stale ? "STALE" : "READY",
        monitorStatus: stale ? "STALE" : "CONNECTED",
        snapshot,
        lastSuccessAt: snapshot.fetchedAt,
        error: stale ? "Upbit account snapshot is stale." : null,
      };
      setUpbitReadOnlyState(next);
      return next;
    } catch (error) {
      if (generation !== sessionGeneration) return currentState;
      const detail = error instanceof Error ? error.message : "Upbit bridge connection failed.";
      const classified = classifyMonitorFailure(detail);
      const monitorStatus = classified === "AUTH_ERROR" ? "AUTH_ERROR" : previous ? "STALE" : classified;
      if (monitorStatus === "AUTH_ERROR") {
        stopRefreshTimer();
      }
      const next: UpbitReadOnlyState = {
        status: previous ? "STALE" : "ERROR",
        monitorStatus,
        snapshot: previous,
        lastSuccessAt: previousLastSuccessAt,
        error: detail,
      };
      setUpbitReadOnlyState(next);
      return next;
    }
  })();

  refreshInFlight = request;
  void request.finally(() => {
    if (refreshInFlight === request) refreshInFlight = null;
  });
  return request;
}

export async function connectUpbitReadOnlyAccount(baseUrl: string = UPBIT_LIVE_BASE_URL): Promise<UpbitReadOnlyState> {
  sessionGeneration += 1;
  stopRefreshTimer();
  refreshInFlight = null;
  activeBaseUrl = baseUrl.trim() || UPBIT_LIVE_BASE_URL;
  if ((await mobileApprovedSession().credentialProvider()) == null) {
    activeBaseUrl = null;
    const detail = "PAPER 보안 세션이 유효할 때 Upbit READ ONLY가 자동 연결됩니다.";
    const next: UpbitReadOnlyState = {
      status: "ERROR",
      monitorStatus: "AUTH_ERROR",
      snapshot: currentState.snapshot,
      lastSuccessAt: currentState.lastSuccessAt,
      error: detail,
    };
    setUpbitReadOnlyState(next);
    return next;
  }
  const generation = sessionGeneration;
  const next = await refreshUpbitReadOnlyAccount();
  if (generation !== sessionGeneration) return currentState;
  if (next.monitorStatus !== "AUTH_ERROR") startRefreshTimer();
  return next;
}

export function useUpbitReadOnlyState(): UpbitReadOnlyState {
  // Keep the read-only account core importable by non-React runtime/tests. React
  // is loaded only when the UI hook is actually invoked by the mobile app.
  const { useEffect, useState } = require("react") as typeof import("react");
  const [state, setState] = useState(currentState);
  useEffect(() => { const update = () => setState(currentState); return subscribeUpbitReadOnlyState(update); }, []);
  return state;
}
