/**
 * Display only, off by default (WO-OPS-20261027-HOST-INDEPENDENT-HEALTH, option A).
 * Every interval it reads this runtime's own public GET /health and appends exactly its `runtime`, `learningPipeline`
 * and `observedAt` to an external append-only store, so the runtime can be read back when the host is too busy to run a
 * self-hosted job, and a stopped host shows as a stale last record. It reuses the /health allowlist instead of building
 * a second one: nothing /health does not publish can be sent. It never reads anything back, never throws into the
 * runtime, and is enabled only by an https URL plus a write-only token in the runtime environment.
 */

export const HEALTH_EXPORT_DEFAULT_INTERVAL_MS = 5 * 60_000;
export const HEALTH_EXPORT_MIN_INTERVAL_MS = 60_000;
/** One hour. Node clamps a timer delay above 2^31-1 ms to 1 ms, so an unbounded interval could turn into a tight loop. */
export const HEALTH_EXPORT_MAX_INTERVAL_MS = 60 * 60_000;
export const HEALTH_EXPORT_TIMEOUT_MS = 5_000;
export const HEALTH_EXPORT_MAX_BYTES = 64 * 1024;

export interface HealthExportConfig {
  readonly url: string;
  readonly token: string;
  readonly intervalMs: number;
}

/** Returns null (export off) unless the URL is https without credentials and the token is a plain bearer value. */
export function healthExportConfig(env: Readonly<Record<string, string | undefined>>): HealthExportConfig | null {
  const rawUrl = env.NUSA_HEALTH_EXPORT_URL?.trim();
  const token = env.NUSA_HEALTH_EXPORT_TOKEN?.trim();
  if (!rawUrl || !token || !/^[A-Za-z0-9._~+/=-]{16,512}$/.test(token)) return null;
  let url: URL;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "" || url.search !== "") return null;
  const rawInterval = Number(env.NUSA_HEALTH_EXPORT_INTERVAL_MS ?? HEALTH_EXPORT_DEFAULT_INTERVAL_MS);
  const intervalMs = Number.isSafeInteger(rawInterval) && rawInterval >= HEALTH_EXPORT_MIN_INTERVAL_MS && rawInterval <= HEALTH_EXPORT_MAX_INTERVAL_MS ? rawInterval : HEALTH_EXPORT_DEFAULT_INTERVAL_MS;
  return Object.freeze({ url: url.toString(), token, intervalMs });
}

/** The exported record: only these three fields of the public /health body, or null when the body is not a usable health object. */
export function healthExportRecord(body: unknown): string | null {
  if (body == null || typeof body !== "object" || Array.isArray(body)) return null;
  const source = body as Record<string, unknown>;
  if (source.ok !== true || typeof source.observedAt !== "string" || source.runtime == null || typeof source.runtime !== "object") return null;
  const record = JSON.stringify({
    schemaVersion: 1,
    observedAt: source.observedAt,
    runtime: source.runtime,
    ...(source.learningPipeline != null && typeof source.learningPipeline === "object" ? { learningPipeline: source.learningPipeline } : {}),
  });
  return Buffer.byteLength(record) <= HEALTH_EXPORT_MAX_BYTES ? record : null;
}

export interface HealthExportDependencies {
  readonly readLocalHealth: () => Promise<unknown>;
  readonly post: (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal; redirect: "error" }) => Promise<{ readonly ok: boolean; readonly body?: { cancel(): Promise<void> } | null }>;
  readonly onResult?: (result: "SENT" | "SKIPPED_INVALID_HEALTH" | "FAILED") => void;
}

/** One export attempt; resolves with the outcome code and never rejects. */
export async function exportHealthOnce(config: HealthExportConfig, deps: HealthExportDependencies): Promise<"SENT" | "SKIPPED_INVALID_HEALTH" | "FAILED"> {
  let outcome: "SENT" | "SKIPPED_INVALID_HEALTH" | "FAILED";
  try {
    const record = healthExportRecord(await deps.readLocalHealth());
    if (record === null) {
      outcome = "SKIPPED_INVALID_HEALTH";
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEALTH_EXPORT_TIMEOUT_MS);
      try {
        const response = await deps.post(config.url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
          body: record,
          signal: controller.signal,
          redirect: "error",
        });
        outcome = response.ok ? "SENT" : "FAILED";
        // Nothing is read back: release the connection without reading the response body.
        try { await response.body?.cancel(); } catch { /* display only */ }
      } finally {
        clearTimeout(timer);
      }
    }
  } catch {
    outcome = "FAILED";
  }
  try { deps.onResult?.(outcome); } catch { /* display only */ }
  return outcome;
}

/** Starts the periodic export; returns a stop function. One attempt at a time; a slow attempt skips the next tick. */
export function startHealthExport(config: HealthExportConfig, deps: HealthExportDependencies): () => void {
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    void exportHealthOnce(config, deps).finally(() => { running = false; });
  };
  const timer = setInterval(tick, config.intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
