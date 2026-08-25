import type { DesktopCloudSessionStore } from "./desktopCloudSessionStore";

interface SessionTokensResponse {
  readonly accessToken: string;
  readonly accessExpiresAt: number;
  readonly refreshToken: string;
  readonly refreshExpiresAt: number;
  readonly scopes: readonly string[];
}

export interface DesktopCloudIdentity {
  readonly userId: string;
  readonly email: string;
  readonly displayName?: string;
  readonly scopes: readonly string[];
}

export interface DesktopCloudSessionLease {
  readonly endpoint: string;
  readonly accessToken: string;
  readonly accessExpiresAt: number;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const normalizeEndpoint = (value: string): string => {
  const url = new URL(value);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("invalid desktop cloud endpoint");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("invalid desktop cloud endpoint");
  return url.origin;
};

const parseTokens = (value: unknown): SessionTokensResponse => {
  if (value == null || typeof value !== "object") throw new Error("invalid desktop session response");
  const item = value as Record<string, unknown>;
  const scopes = Array.isArray(item.scopes) && item.scopes.every((scope) => typeof scope === "string") ? item.scopes as string[] : undefined;
  if (typeof item.accessToken !== "string" || item.accessToken.length < 32 || typeof item.refreshToken !== "string" || item.refreshToken.length < 32 ||
      typeof item.accessExpiresAt !== "number" || typeof item.refreshExpiresAt !== "number" || scopes == null ||
      scopes.some((scope) => scope !== "dashboard:read" && scope !== "paper:trade")) throw new Error("invalid desktop session response");
  return Object.freeze({ accessToken: item.accessToken, accessExpiresAt: item.accessExpiresAt, refreshToken: item.refreshToken, refreshExpiresAt: item.refreshExpiresAt, scopes: Object.freeze([...scopes]) });
};

export class DesktopCloudSessionClient {
  private endpoint?: string;
  private accessToken?: string;
  private accessExpiresAt = 0;
  private refreshExpiresAt = 0;

  public constructor(
    private readonly store: DesktopCloudSessionStore,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  public async bootstrap(endpoint: string, bootstrapToken: string): Promise<void> {
    const normalized = normalizeEndpoint(endpoint);
    if (!bootstrapToken || Buffer.byteLength(bootstrapToken, "utf8") < 32) throw new Error("invalid bootstrap token");
    // An explicit re-bootstrap is a security boundary, not a fallback attempt. Drop any
    // prior refresh credential first so a failed bootstrap cannot silently resurrect an
    // older Desktop session on the next restart.
    this.clearMemory();
    this.store.clear();
    const response = await this.fetchImpl(`${normalized}/v1/desktop/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bootstrapToken })
    });
    if (!response.ok) throw new Error("desktop bootstrap rejected");
    const tokens = parseTokens(await response.json());
    this.accept(normalized, tokens);
  }

  public async restore(): Promise<boolean> {
    this.clearMemory();
    const stored = this.store.load();
    if (stored == null) return false;
    try {
      const tokens = await this.refreshWith(stored.endpoint, stored.refreshToken);
      this.accept(stored.endpoint, tokens);
      return true;
    } catch {
      this.store.clear();
      return false;
    }
  }

  public async ensureAccess(now = Date.now()): Promise<string> {
    if (this.endpoint == null) throw new Error("desktop cloud session unavailable");
    if (this.accessToken != null && this.accessExpiresAt - now > 30_000) return this.accessToken;
    const stored = this.store.load();
    if (stored == null || stored.endpoint !== this.endpoint || this.refreshExpiresAt <= now) {
      this.clearMemory();
      throw new Error("desktop cloud session unavailable");
    }
    const tokens = await this.refreshWith(stored.endpoint, stored.refreshToken);
    this.accept(stored.endpoint, tokens);
    return tokens.accessToken;
  }

  /** Main-process-only lease used by the canonical Cloud PAPER client. */
  public async lease(now = Date.now()): Promise<DesktopCloudSessionLease> {
    const accessToken = await this.ensureAccess(now);
    const endpoint = this.endpoint;
    if (endpoint == null || this.accessToken !== accessToken || this.accessExpiresAt <= now) throw new Error("desktop cloud session unavailable");
    return Object.freeze({ endpoint, accessToken, accessExpiresAt: this.accessExpiresAt });
  }

  public isCurrent(lease: DesktopCloudSessionLease): boolean {
    return this.endpoint === lease.endpoint && this.accessToken === lease.accessToken && this.accessExpiresAt === lease.accessExpiresAt;
  }

  public async me(): Promise<DesktopCloudIdentity> {
    const accessToken = await this.ensureAccess();
    const endpoint = this.endpoint!;
    const response = await this.fetchImpl(`${endpoint}/v1/desktop/me`, { method: "GET", headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error("desktop identity unavailable");
    const value = await response.json() as Record<string, unknown>;
    if (typeof value.userId !== "string" || typeof value.email !== "string" || !Array.isArray(value.scopes)) throw new Error("invalid desktop identity response");
    return Object.freeze({ userId: value.userId, email: value.email, ...(typeof value.displayName === "string" ? { displayName: value.displayName } : {}), scopes: Object.freeze(value.scopes.filter((scope): scope is string => typeof scope === "string")) });
  }

  public async revoke(): Promise<void> {
    const endpoint = this.endpoint;
    const accessToken = this.accessToken;
    try {
      if (endpoint && accessToken) await this.fetchImpl(`${endpoint}/v1/desktop/session/revoke`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
    } finally {
      this.clearMemory();
      this.store.clear();
    }
  }

  public snapshot(): Readonly<{ connected: boolean; endpoint?: string; accessExpiresAt?: number; refreshExpiresAt?: number }> {
    return Object.freeze({ connected: this.endpoint != null && this.accessToken != null, ...(this.endpoint ? { endpoint: this.endpoint } : {}), ...(this.accessExpiresAt > 0 ? { accessExpiresAt: this.accessExpiresAt } : {}), ...(this.refreshExpiresAt > 0 ? { refreshExpiresAt: this.refreshExpiresAt } : {}) });
  }

  private async refreshWith(endpoint: string, refreshToken: string): Promise<SessionTokensResponse> {
    const response = await this.fetchImpl(`${endpoint}/v1/desktop/session/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken })
    });
    if (!response.ok) throw new Error("desktop session refresh rejected");
    return parseTokens(await response.json());
  }

  private accept(endpoint: string, tokens: SessionTokensResponse): void {
    this.store.save(endpoint, tokens.refreshToken);
    this.endpoint = endpoint;
    this.accessToken = tokens.accessToken;
    this.accessExpiresAt = tokens.accessExpiresAt;
    this.refreshExpiresAt = tokens.refreshExpiresAt;
  }

  private clearMemory(): void {
    this.endpoint = undefined;
    this.accessToken = undefined;
    this.accessExpiresAt = 0;
    this.refreshExpiresAt = 0;
  }
}
