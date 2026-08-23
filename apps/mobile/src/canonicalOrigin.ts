import { CANONICAL_NUSA_ORIGIN } from "./generatedBuildConfig";

export type CanonicalOriginResult =
  | Readonly<{ status: "READY"; origin: string }>
  | Readonly<{ status: "DEPLOYMENT_CONFIG_PENDING"; reason: string }>;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Resolves the non-secret Cloud origin injected by the release environment.
 * Production never falls back to localhost or an invented hostname.
 */
export function resolveCanonicalCloudOrigin(
  environment: Record<string, string | undefined> = process.env,
  development = false
): CanonicalOriginResult {
  const raw = environment.EXPO_PUBLIC_NUSA_API_BASE_URL?.trim() || CANONICAL_NUSA_ORIGIN.trim();
  if (!raw) return Object.freeze({ status: "DEPLOYMENT_CONFIG_PENDING", reason: "A canonical Cloud PAPER HTTPS origin is not configured for this build." });
  let url: URL;
  try { url = new URL(raw); } catch { return Object.freeze({ status: "DEPLOYMENT_CONFIG_PENDING", reason: "The configured Cloud origin is not a valid URL." }); }
  if (url.username || url.password || url.search || url.hash) return Object.freeze({ status: "DEPLOYMENT_CONFIG_PENDING", reason: "The Cloud origin must not contain credentials, query, or fragment data." });
  const host = url.hostname.toLowerCase();
  const loopback = LOOPBACK_HOSTS.has(host);
  if (url.protocol !== "https:" && !(development && url.protocol === "http:" && loopback)) {
    return Object.freeze({ status: "DEPLOYMENT_CONFIG_PENDING", reason: "Production Cloud PAPER requires an HTTPS origin." });
  }
  return Object.freeze({ status: "READY", origin: url.href.replace(/\/+$/, "") });
}

export function getCanonicalCloudOrigin(environment: Record<string, string | undefined> = process.env): string | null {
  const result = resolveCanonicalCloudOrigin(environment, environment.NODE_ENV === "development" || environment.NODE_ENV === "test");
  return result.status === "READY" ? result.origin : null;
}
