import { useEffect, useState } from "react";
import type { UpbitReadOnlyAccountSnapshot } from "./upbitReadOnlyAccountModel";
export type { UpbitReadOnlyAccountSnapshot, UpbitReadOnlyAsset } from "./upbitReadOnlyAccountModel";

export type UpbitReadOnlyConnectionStatus = "DISCONNECTED" | "LOADING" | "READY" | "STALE" | "ERROR";

export interface UpbitReadOnlyState {
  readonly status: UpbitReadOnlyConnectionStatus;
  readonly snapshot: UpbitReadOnlyAccountSnapshot | null;
  readonly error: string | null;
}

export const initialUpbitReadOnlyState: UpbitReadOnlyState = Object.freeze({ status: "DISCONNECTED", snapshot: null, error: null });

let currentState: UpbitReadOnlyState = initialUpbitReadOnlyState;
const listeners = new Set<() => void>();

export function getUpbitReadOnlyState(): UpbitReadOnlyState { return currentState; }
export function subscribeUpbitReadOnlyState(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export function setUpbitReadOnlyState(next: UpbitReadOnlyState): void {
  currentState = Object.freeze(next);
  listeners.forEach((listener) => listener());
}
export function resetUpbitReadOnlyState(): void { setUpbitReadOnlyState(initialUpbitReadOnlyState); }

export function useUpbitReadOnlyState(): UpbitReadOnlyState {
  const [state, setState] = useState(currentState);
  useEffect(() => { const update = () => setState(currentState); return subscribeUpbitReadOnlyState(update); }, []);
  return state;
}
