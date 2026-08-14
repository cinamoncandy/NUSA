import type { UpbitLiveSnapshot } from "./upbitLiveClient";

export type UpbitReadOnlyState = Readonly<{
  endpoint: string | null;
  snapshot: UpbitLiveSnapshot | null;
}>;

let sharedEndpoint: string | null = null;
let sharedSnapshot: UpbitLiveSnapshot | null = null;

/**
 * Process-memory-only non-secret state shared between Settings and Portfolio.
 * Credentials remain exclusively in InMemoryUpbitCredentialSession.
 */
export function rememberUpbitReadOnlyState(endpoint: string, snapshot: UpbitLiveSnapshot): void {
  sharedEndpoint = endpoint.trim();
  sharedSnapshot = snapshot;
}

export function clearUpbitReadOnlyState(): void {
  sharedEndpoint = null;
  sharedSnapshot = null;
}

export function getUpbitReadOnlyState(): UpbitReadOnlyState {
  return Object.freeze({ endpoint: sharedEndpoint, snapshot: sharedSnapshot });
}
