/**
 * Last-known PAPER snapshot kept on the device so a cold start shows the previous values (clearly marked
 * as old) instead of an empty screen. Presentation only: a cached value never counts as a live reading,
 * is bound to the endpoint it came from, expires, and is re-validated on load by the caller's validator.
 */
export const CACHE_KEY = "nusa.home.lastSnapshot.v1";
export const CACHE_MAX_AGE_MS = 24 * 3_600_000;
export const CACHE_MIN_SAVE_INTERVAL_MS = 60_000;
const MAX_SERIALIZED_CHARS = 400_000;
const CLOCK_SKEW_MS = 60_000;

export interface CachedEntry<T> {
  readonly savedAt: number;
  readonly endpoint: string;
  readonly snapshot: T;
}

export function serializeCache(snapshot: unknown, savedAt: number, endpoint: string): string | null {
  if (!Number.isSafeInteger(savedAt) || savedAt <= 0 || endpoint.trim() === "") return null;
  try {
    const raw = JSON.stringify({ savedAt, endpoint, snapshot });
    return typeof raw === "string" && raw.length <= MAX_SERIALIZED_CHARS ? raw : null;
  } catch {
    return null;
  }
}

/** Returns the entry only when it is well-formed, from this endpoint, not from the future, not expired, and valid. */
export function parseCache<T>(raw: string | null, now: number, endpoint: string, validate: (value: unknown) => T): CachedEntry<T> | null {
  if (raw == null || raw === "" || raw.length > MAX_SERIALIZED_CHARS || endpoint.trim() === "") return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (value == null || typeof value !== "object") return null;
    const savedAt = value.savedAt;
    if (typeof savedAt !== "number" || !Number.isSafeInteger(savedAt) || savedAt <= 0) return null;
    if (value.endpoint !== endpoint) return null;
    if (savedAt > now + CLOCK_SKEW_MS || now - savedAt > CACHE_MAX_AGE_MS) return null;
    return Object.freeze({ savedAt, endpoint, snapshot: validate(value.snapshot) });
  } catch {
    return null;
  }
}

export function shouldSaveCache(lastSavedAt: number | null, now: number): boolean {
  return lastSavedAt == null || !Number.isFinite(lastSavedAt) || now - lastSavedAt >= CACHE_MIN_SAVE_INTERVAL_MS || now < lastSavedAt;
}

export function staleLabel(savedAt: number, now: number): string {
  const elapsed = now - savedAt;
  if (!Number.isFinite(elapsed) || elapsed < 0) return "마지막 확인 시각 불명";
  if (elapsed < 60_000) return "마지막 확인 방금 전";
  if (elapsed < 3_600_000) return `마지막 확인 ${Math.floor(elapsed / 60_000)}분 전`;
  if (elapsed < 86_400_000) return `마지막 확인 ${Math.floor(elapsed / 3_600_000)}시간 전`;
  return `마지막 확인 ${Math.floor(elapsed / 86_400_000)}일 전`;
}
