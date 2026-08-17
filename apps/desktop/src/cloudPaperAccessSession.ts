const MIN_TOKEN_UTF8_BYTES = 32;
const MAX_TOKEN_UTF8_BYTES = 4096;

export interface CloudPaperAccessSessionSnapshot {
  readonly configured: boolean;
  readonly endpoint: string | null;
  readonly generation: number;
}

export interface CloudPaperAccessLease {
  readonly endpoint: string;
  readonly token: string;
  readonly generation: number;
}

function normalizeEndpoint(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  let url: URL;
  try { url = new URL(trimmed); }
  catch { throw new Error("Cloud PAPER endpoint is invalid."); }
  if (url.username || url.password) throw new Error("Cloud PAPER endpoint credentials in URLs are prohibited.");
  if (url.search || url.hash) throw new Error("Cloud PAPER endpoint query/hash components are prohibited.");
  if (url.pathname !== "/") throw new Error("Cloud PAPER endpoint must name the server origin only.");
  const host = url.hostname.toLowerCase();
  const localhost = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localhost)) {
    throw new Error("Cloud PAPER credential will not be sent over insecure remote HTTP.");
  }
  return url.origin;
}

function normalizeToken(value: string): string {
  const token = value.trim();
  const byteLength = Buffer.byteLength(token, "utf8");
  if (byteLength < MIN_TOKEN_UTF8_BYTES || byteLength > MAX_TOKEN_UTF8_BYTES) {
    throw new Error("Cloud PAPER access credential length is invalid.");
  }
  if (/[\u0000-\u001f\u007f]/.test(token)) throw new Error("Cloud PAPER access credential contains prohibited control characters.");
  return token;
}

/**
 * Process-memory-only application session for the existing Cloud stable-user bearer contract.
 * It never issues credentials, persists them, or exposes them in a renderer-safe snapshot.
 */
export class CloudPaperAccessSession {
  private endpoint: string | null = null;
  private token: string | null = null;
  private generation = 0;

  public connect(endpointValue: string, tokenValue: string): CloudPaperAccessSessionSnapshot {
    const endpoint = normalizeEndpoint(endpointValue);
    const token = normalizeToken(tokenValue);
    this.endpoint = endpoint;
    this.token = token;
    this.generation += 1;
    return this.snapshot();
  }

  public clear(): CloudPaperAccessSessionSnapshot {
    this.endpoint = null;
    this.token = null;
    this.generation += 1;
    return this.snapshot();
  }

  public snapshot(): CloudPaperAccessSessionSnapshot {
    return Object.freeze({ configured: this.endpoint != null && this.token != null, endpoint: this.endpoint, generation: this.generation });
  }

  public lease(): CloudPaperAccessLease | null {
    if (this.endpoint == null || this.token == null) return null;
    return Object.freeze({ endpoint: this.endpoint, token: this.token, generation: this.generation });
  }

  public isCurrent(lease: CloudPaperAccessLease): boolean {
    return this.endpoint === lease.endpoint && this.token === lease.token && this.generation === lease.generation;
  }
}
