import { CANONICAL_NUSA_ORIGIN } from "./generatedBuildConfig";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function isNonPublicHost(host: string): boolean {
  const normalized = host.toLowerCase();
  const unbracketed = normalized.replace(/^\[/, "").replace(/\]$/, "");
  return LOOPBACK_HOSTS.has(normalized)
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || normalized.endsWith(".internal")
    || IPV4_LITERAL.test(unbracketed)
    || unbracketed.includes(":");
}

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
  if (isNonPublicHost(host)) throw new Error("canonical NUSA origin must use a stable public hostname, not loopback, internal, or an IP literal");
  if (host.endsWith(".trycloudflare.com")) throw new Error("temporary Cloudflare Quick Tunnel origins are not release origins");
  return url.origin;
}

export function tryNormalizeCanonicalNusaOrigin(value: string): string | null {
  if (!value.trim()) return null;
  try { return normalizeCanonicalNusaOrigin(value); } catch { return null; }
}

export function tryReadCanonicalNusaOrigin(): string | null {
  if (!CANONICAL_NUSA_ORIGIN.trim()) return null;
  return normalizeCanonicalNusaOrigin(CANONICAL_NUSA_ORIGIN);
}

export function resolvePaperEndpoint(personalEndpoint: string, canonicalOrigin = CANONICAL_NUSA_ORIGIN): string {
  if (!canonicalOrigin.trim()) return personalEndpoint;
  return normalizeCanonicalNusaOrigin(canonicalOrigin);
}
