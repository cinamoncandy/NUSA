import { useEffect, useState } from "react";
import { InMemoryUpbitCredentialSession } from "./upbitCredentialSession";
import { loadUpbitLiveAccounts, UPBIT_LIVE_BASE_URL } from "./upbitLiveClient";
import { normalizeUpbitReadOnlySnapshot, type UpbitReadOnlyAccountSnapshot } from "./upbitReadOnlyAccountModel";
export type { UpbitReadOnlyAccountSnapshot, UpbitReadOnlyAsset } from "./upbitReadOnlyAccountModel";

export type UpbitReadOnlyConnectionStatus = "DISCONNECTED" | "LOADING" | "READY" | "STALE" | "ERROR";

export interface UpbitReadOnlyState {
  readonly status: UpbitReadOnlyConnectionStatus;
  readonly snapshot: UpbitReadOnlyAccountSnapshot | null;
  readonly error: string | null;
}

export const initialUpbitReadOnlyState: UpbitReadOnlyState = Object.freeze({ status: "DISCONNECTED", snapshot: null, error: null });

const REFRESH_INTERVAL_MS = 30_000;
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
    const next = currentState.snapshot
      ? { status: "STALE" as const, snapshot: currentState.snapshot, error: "Upbit bridge credential is not configured." }
      : initialUpbitReadOnlyState;
    setUpbitReadOnlyState(next);
    return next;
  }

  const generation = sessionGeneration;
  const baseUrl = activeBaseUrl;
  const previous = currentState.snapshot;
  setUpbitReadOnlyState({ status: previous ? "STALE" : "LOADING", snapshot: previous, error: null });
  let request: Promise<UpbitReadOnlyState>;
  request = (async (): Promise<UpbitReadOnlyState> => {
    try {
      const snapshot = await loadUpbitLiveAccounts({ credentialProvider: credentialSession.credentialProvider, baseUrl });
      if (generation !== sessionGeneration) return currentState;
      const next: UpbitReadOnlyState = { status: "READY", snapshot: normalizeUpbitReadOnlySnapshot(snapshot), error: null };
      setUpbitReadOnlyState(next);
      return next;
    } catch (error) {
      if (generation !== sessionGeneration) return currentState;
      const detail = error instanceof Error ? error.message : "Upbit bridge connection failed.";
      const next: UpbitReadOnlyState = { status: previous ? "STALE" : "ERROR", snapshot: previous, error: detail };
      setUpbitReadOnlyState(next);
      return next;
    } finally {
      if (refreshInFlight === request) refreshInFlight = null;
    }
  })();
  refreshInFlight = request;
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
    const next: UpbitReadOnlyState = { status: "ERROR", snapshot: currentState.snapshot, error: detail };
    setUpbitReadOnlyState(next);
    return next;
  }
  const generation = sessionGeneration;
  const next = await refreshUpbitReadOnlyAccount();
  if (generation !== sessionGeneration) return currentState;
  if (next.status === "READY") startRefreshTimer();
  else credentialSession.clear();
  return next;
}

export function useUpbitReadOnlyState(): UpbitReadOnlyState {
  const [state, setState] = useState(currentState);
  useEffect(() => { const update = () => setState(currentState); return subscribeUpbitReadOnlyState(update); }, []);
  return state;
}
