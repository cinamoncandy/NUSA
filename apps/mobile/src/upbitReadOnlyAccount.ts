import { useEffect, useState } from "react";
import { InMemoryUpbitCredentialSession } from "./upbitCredentialSession";
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
const credentialSession = new InMemoryUpbitCredentialSession();
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
  credentialSession.clear();
  setUpbitReadOnlyState(initialUpbitReadOnlyState);
}

export async function refreshUpbitReadOnlyAccount(): Promise<UpbitReadOnlyState> {
  if (refreshInFlight) return refreshInFlight;
  if (!activeBaseUrl || !credentialSession.isConfigured()) {
    const next: UpbitReadOnlyState = currentState.snapshot
      ? { status: "STALE", monitorStatus: "STALE", snapshot: currentState.snapshot, lastSuccessAt: currentState.lastSuccessAt, error: "Upbit bridge credential is not configured." }
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
      const snapshot = normalizeUpbitReadOnlySnapshot(await loadUpbitLiveAccounts({ credentialProvider: credentialSession.credentialProvider, baseUrl }));
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
      const monitorStatus = previous ? "STALE" : classifyMonitorFailure(detail);
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

export async function connectUpbitReadOnlyAccount(token: string, baseUrl: string = UPBIT_LIVE_BASE_URL): Promise<UpbitReadOnlyState> {
  sessionGeneration += 1;
  stopRefreshTimer();
  refreshInFlight = null;
  credentialSession.clear();
  activeBaseUrl = baseUrl.trim() || UPBIT_LIVE_BASE_URL;
  try {
    credentialSession.connect(token);
  } catch (error) {
    activeBaseUrl = null;
    const detail = error instanceof Error ? error.message : "Upbit bridge credential is invalid.";
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
  if (next.status === "READY" || next.status === "STALE") startRefreshTimer();
  else credentialSession.clear();
  return next;
}

export function useUpbitReadOnlyState(): UpbitReadOnlyState {
  const [state, setState] = useState(currentState);
  useEffect(() => { const update = () => setState(currentState); return subscribeUpbitReadOnlyState(update); }, []);
  return state;
}
