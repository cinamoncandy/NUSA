import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import { validatePersonalPaperOperationsSnapshot } from "../../../packages/contracts/src/personalPaperOperations";
import { CACHE_KEY, parseCache, serializeCache, shouldSaveCache, type CachedEntry } from "./cachedSnapshotModel";

type Snapshot = ReturnType<typeof validatePersonalPaperOperationsSnapshot>;

/**
 * The contract rejects a snapshot older than 15 s, which is right for a live reading. A stored one is judged
 * for structure against its own timestamp; how old it is is shown separately from savedAt and it is never live.
 */
function validateStored(value: unknown): Snapshot {
  const generatedAt = (value as { generatedAt?: unknown } | null)?.generatedAt;
  if (typeof generatedAt !== "number" || !Number.isFinite(generatedAt)) throw new Error("stored snapshot has no timestamp");
  return validatePersonalPaperOperationsSnapshot(value as Snapshot, generatedAt);
}

export async function clearCachedSnapshot(): Promise<void> {
  try { await AsyncStorage.removeItem(CACHE_KEY); } catch { /* storage unavailable: nothing to clear */ }
}

/**
 * Loads the stored snapshot once at launch (validated, endpoint-bound, expiring) and stores each fresh
 * READY snapshot at most once a minute. Returns null until loaded, when absent or invalid.
 */
export function useCachedSnapshot(endpoint: string | null, fresh: Snapshot | null): CachedEntry<Snapshot> | null {
  const [cached, setCached] = useState<CachedEntry<Snapshot> | null>(null);
  const lastSavedAt = useRef<number | null>(null);
  useEffect(() => {
    if (endpoint == null) { setCached(null); return; }
    let cancelled = false;
    void AsyncStorage.getItem(CACHE_KEY)
      .then((raw) => { if (!cancelled) setCached(parseCache(raw, Date.now(), endpoint, validateStored)); })
      .catch(() => { if (!cancelled) setCached(null); });
    return () => { cancelled = true; };
  }, [endpoint]);
  useEffect(() => {
    if (fresh == null || endpoint == null) return;
    const now = Date.now();
    if (!shouldSaveCache(lastSavedAt.current, now)) return;
    const raw = serializeCache(fresh, now, endpoint);
    if (raw == null) return;
    lastSavedAt.current = now;
    void AsyncStorage.setItem(CACHE_KEY, raw).catch(() => undefined);
  }, [fresh, endpoint]);
  return cached;
}
