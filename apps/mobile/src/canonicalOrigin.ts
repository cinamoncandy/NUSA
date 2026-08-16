export const CANONICAL_ORIGIN_ENV = "EXPO_PUBLIC_NUSA_API_BASE_URL" as const;
import { CANONICAL_NUSA_ORIGIN } from "./generatedBuildConfig";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function normalized(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("canonical NUSA origin is required");
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("canonical NUSA origin is invalid"); }
  if (url.protocol !== "https:") throw new Error("canonical NUSA origin must use HTTPS");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("canonical NUSA origin must be an HTTPS origin without credentials or path state");
  if (LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) throw new Error("canonical NUSA origin cannot be loopback");
  if (url.hostname.toLowerCase().endsWith(".trycloudflare.com")) throw new Error("temporary Cloudflare Quick Tunnel origins are not production origins");
  return url.origin;
}

export function readCanonicalNusaOrigin(environment: Record<string, string | undefined> = process.env): string {
  return normalized(environment[CANONICAL_ORIGIN_ENV] ?? CANONICAL_NUSA_ORIGIN);
}

export function tryReadCanonicalNusaOrigin(environment: Record<string, string | undefined> = process.env): string | null {
  try { return readCanonicalNusaOrigin(environment); } catch { return null; }
}

export function assertReleaseCanonicalNusaOrigin(environment: Record<string, string | undefined>): string {
  return readCanonicalNusaOrigin(environment);
}
