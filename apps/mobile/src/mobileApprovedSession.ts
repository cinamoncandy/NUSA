import type { SecureStoragePort } from "./mobileSecurity";

const SESSION_STORAGE_KEY = "nusa.mobile.approved-session.v1";
const ACCESS_REFRESH_SKEW_MS = 30_000;
const MAX_TOKEN_LENGTH = 4096;

export interface MobileApprovedSessionIdentity {
  readonly userId: string;
  readonly email: string;
  readonly displayName?: string;
  readonly scopes: readonly string[];
}

interface MobileSessionTokens {
  readonly accessToken: string;
  readonly accessExpiresAt: number;
  readonly refreshToken: string;
  readonly refreshExpiresAt: number;
  readonly scopes: readonly string[];
}

interface PersistedSession {
  readonly endpoint: string;
  readonly refreshToken: string;
  readonly refreshExpiresAt: number;
}

export type MobileApprovedCredentialProvider = () => Promise<string | null>;

function secureEndpoint(value: string): string {
  const raw = value.trim().replace(/\/+$/, "");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("PAPER endpoint is invalid."); }
  if (url.username || url.password || url.search || url.hash) throw new Error("PAPER endpoint must not contain credentials, query, or fragment.");
  const host = url.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("Approved mobile session requires HTTPS except loopback development.");
  return url.href.replace(/\/+$/, "");
}

function readToken(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} is invalid.`);
  const token = value.trim();
  if (token.length < 16 || token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) throw new Error(`${field} is invalid.`);
  return token;
}

function readTime(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${field} is invalid.`);
  return value as number;
}

function readScopes(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((scope) => typeof scope !== "string")) throw new Error("mobile session scopes are invalid.");
  const scopes = value.map((scope) => scope.trim());
  if (scopes.some((scope) => !["dashboard:read", "paper:trade"].includes(scope))) throw new Error("mobile session scopes are invalid.");
  return Object.freeze(scopes);
}

function parseTokens(value: unknown): MobileSessionTokens {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("mobile session response is invalid.");
  const record = value as Record<string, unknown>;
  return Object.freeze({
    accessToken: readToken(record.accessToken, "access token"),
    accessExpiresAt: readTime(record.accessExpiresAt, "access expiry"),
    refreshToken: readToken(record.refreshToken, "refresh token"),
    refreshExpiresAt: readTime(record.refreshExpiresAt, "refresh expiry"),
    scopes: readScopes(record.scopes)
  });
}

function parseIdentity(value: unknown): MobileApprovedSessionIdentity {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("mobile identity response is invalid.");
  const record = value as Record<string, unknown>;
  if (typeof record.userId !== "string" || !record.userId.trim() || typeof record.email !== "string" || !record.email.trim()) throw new Error("mobile identity response is invalid.");
  const displayName = typeof record.displayName === "string" && record.displayName.trim() ? record.displayName.trim() : undefined;
  return Object.freeze({ userId: record.userId.trim(), email: record.email.trim(), ...(displayName ? { displayName } : {}), scopes: readScopes(record.scopes) });
}

function encodeAscii(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 0x7f) throw new Error("secure session state is not ASCII-safe");
    bytes[index] = code;
  }
  return bytes;
}

function decodeAscii(value: Uint8Array): string {
  let result = "";
  for (const byte of value) {
    if (byte > 0x7f) throw new Error("secure session state is invalid");
    result += String.fromCharCode(byte);
  }
  return result;
}

function parsePersisted(value: Uint8Array): PersistedSession {
  const decoded: unknown = JSON.parse(decodeAscii(value));
  if (decoded == null || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("secure session state is invalid");
  const record = decoded as Record<string, unknown>;
  return Object.freeze({ endpoint: secureEndpoint(String(record.endpoint ?? "")), refreshToken: readToken(record.refreshToken, "refresh token"), refreshExpiresAt: readTime(record.refreshExpiresAt, "refresh expiry") });
}

async function requestJson(request: typeof fetch, endpoint: string, init: RequestInit): Promise<unknown> {
  const response = await request(endpoint, { ...init, redirect: "error", headers: { accept: "application/json", "content-type": "application/json", ...(init.headers ?? {}) } });
  if (response.redirected === true || (response.url && new URL(response.url).href !== new URL(endpoint).href)) throw new Error("mobile session redirect is prohibited.");
  if (!response.ok) throw new Error(`mobile session request rejected (${response.status}).`);
  return response.json();
}

export class MobileApprovedSession {
  private accessToken: string | null = null;
  private accessExpiresAt = 0;
  private endpoint: string | null = null;
  private identity: MobileApprovedSessionIdentity | null = null;
  private refreshInFlight: Promise<string | null> | null = null;

  public constructor(private readonly storage: SecureStoragePort | null, private readonly request: typeof fetch = fetch) {}

  public readonly credentialProvider: MobileApprovedCredentialProvider = async () => this.getAccessToken();
  public currentIdentity(): MobileApprovedSessionIdentity | null { return this.identity; }
  public hasMemoryAccess(): boolean { return this.accessToken !== null; }

  public async connectBootstrap(baseUrl: string, bootstrapToken: string): Promise<MobileApprovedSessionIdentity> {
    const endpoint = secureEndpoint(baseUrl);
    if (this.storage == null) throw new Error("OS secure storage is unavailable on this mobile runtime.");
    const token = readToken(bootstrapToken, "bootstrap token");
    const tokens = parseTokens(await requestJson(this.request, `${endpoint}/v1/mobile/bootstrap`, { method: "POST", body: JSON.stringify({ bootstrapToken: token }) }));
    await this.persist(endpoint, tokens);
    this.acceptAccess(endpoint, tokens);
    try {
      const identity = await this.loadIdentity(endpoint, tokens.accessToken);
      this.identity = identity;
      return identity;
    } catch (error) {
      await this.clearLocal();
      throw error;
    }
  }

  public async restore(baseUrl: string): Promise<MobileApprovedSessionIdentity | null> {
    const endpoint = secureEndpoint(baseUrl);
    if (this.storage == null) return null;
    let stored: Uint8Array | null;
    try { stored = await this.storage.getSecret(SESSION_STORAGE_KEY); }
    catch { await this.clearLocal(); return null; }
    if (stored == null) return null;
    let persisted: PersistedSession;
    try { persisted = parsePersisted(stored); }
    catch { await this.clearLocal(); return null; }
    if (persisted.endpoint !== endpoint || persisted.refreshExpiresAt <= Date.now()) { await this.clearLocal(); return null; }
    try {
      const tokens = await this.refreshWith(endpoint, persisted.refreshToken);
      const identity = await this.loadIdentity(endpoint, tokens.accessToken);
      this.identity = identity;
      return identity;
    } catch {
      await this.clearLocal();
      return null;
    }
  }

  public async disconnect(baseUrl?: string): Promise<void> {
    const endpoint = baseUrl == null ? this.endpoint : secureEndpoint(baseUrl);
    const access = this.accessToken;
    await this.clearLocal();
    try {
      if (endpoint != null && access != null) {
        await requestJson(this.request, `${endpoint}/v1/mobile/session/revoke`, { method: "POST", headers: { authorization: `Bearer ${access}` }, body: "{}" });
      }
    } catch { /* local credential destruction has already completed */ }
  }

  public clearMemory(): void {
    this.accessToken = null;
    this.accessExpiresAt = 0;
    this.endpoint = null;
    this.identity = null;
  }

  private async getAccessToken(): Promise<string | null> {
    if (this.accessToken != null && Date.now() + ACCESS_REFRESH_SKEW_MS < this.accessExpiresAt) return this.accessToken;
    if (this.refreshInFlight != null) return this.refreshInFlight;
    const operation = this.refreshFromStorage();
    this.refreshInFlight = operation;
    try { return await operation; }
    finally { if (this.refreshInFlight === operation) this.refreshInFlight = null; }
  }

  private async refreshFromStorage(): Promise<string | null> {
    if (this.storage == null || this.endpoint == null) return null;
    let persisted: PersistedSession;
    try {
      const stored = await this.storage.getSecret(SESSION_STORAGE_KEY);
      if (stored == null) return null;
      persisted = parsePersisted(stored);
    } catch { await this.clearLocal(); return null; }
    if (persisted.endpoint !== this.endpoint || persisted.refreshExpiresAt <= Date.now()) { await this.clearLocal(); return null; }
    try { return (await this.refreshWith(this.endpoint, persisted.refreshToken)).accessToken; }
    catch { await this.clearLocal(); return null; }
  }

  private async refreshWith(endpoint: string, refreshToken: string): Promise<MobileSessionTokens> {
    const tokens = parseTokens(await requestJson(this.request, `${endpoint}/v1/mobile/session/refresh`, { method: "POST", body: JSON.stringify({ refreshToken }) }));
    await this.persist(endpoint, tokens);
    this.acceptAccess(endpoint, tokens);
    return tokens;
  }

  private async loadIdentity(endpoint: string, accessToken: string): Promise<MobileApprovedSessionIdentity> {
    return parseIdentity(await requestJson(this.request, `${endpoint}/v1/mobile/me`, { method: "GET", headers: { authorization: `Bearer ${accessToken}` } }));
  }

  private acceptAccess(endpoint: string, tokens: MobileSessionTokens): void {
    this.endpoint = endpoint;
    this.accessToken = tokens.accessToken;
    this.accessExpiresAt = tokens.accessExpiresAt;
  }

  private async persist(endpoint: string, tokens: MobileSessionTokens): Promise<void> {
    if (this.storage == null) throw new Error("OS secure storage is unavailable on this mobile runtime.");
    const value: PersistedSession = Object.freeze({ endpoint, refreshToken: tokens.refreshToken, refreshExpiresAt: tokens.refreshExpiresAt });
    await this.storage.setSecret(SESSION_STORAGE_KEY, encodeAscii(JSON.stringify(value)));
  }

  private async clearLocal(): Promise<void> {
    this.clearMemory();
    if (this.storage != null) {
      try { await this.storage.deleteSecret(SESSION_STORAGE_KEY); } catch { /* memory is already cleared; storage adapter remains fail-closed */ }
    }
  }
}

export { SESSION_STORAGE_KEY };
