import { CANONICAL_NUSA_ORIGIN } from "./generatedBuildConfig";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function normalizeCanonicalNusaOrigin(value: string): string {
  const input = value.trim();
  if (!input) throw new Error("canonical NUSA origin is required");
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("canonical NUSA origin is invalid"); }
  if (url.protocol !== "https:") throw new Error("canonical NUSA origin must use HTTPS");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("canonical NUSA origin must be an HTTPS origin without credentials or path state");
  }
  const host = url.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) throw new Error("canonical NUSA origin cannot be loopback");
  if (host.endsWith(".trycloudflare.com")) throw new Error("temporary Cloudflare Quick Tunnel origins are not release origins");
  return url.origin;
}

export function tryNormalizeCanonicalNusaOrigin(value: string): string | null {
  if (!value.trim()) return null;
  try { return normalizeCanonicalNusaOrigin(value); } catch { return null; }
}

export function tryReadCanonicalNusaOrigin(): string | null {
  return tryNormalizeCanonicalNusaOrigin(CANONICAL_NUSA_ORIGIN);
}

export function resolvePaperEndpoint(personalEndpoint: string, canonicalOrigin = CANONICAL_NUSA_ORIGIN): string {
  const canonical = tryNormalizeCanonicalNusaOrigin(canonicalOrigin);
  return canonical ?? personalEndpoint;
}
