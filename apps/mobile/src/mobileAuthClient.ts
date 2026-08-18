import type { SecureStoragePort } from "./mobileSecurity";

export type MobileClientAuthErrorCode = "AUTH_REQUIRED" | "SESSION_EXPIRED" | "SESSION_REVOKED" | "BOOTSTRAP_DENIED" | "INVALID_ARGUMENT" | "AUTH_UNAVAILABLE";

export class MobileClientAuthError extends Error {
  public constructor(public readonly code: MobileClientAuthErrorCode) {
    super(code);
    this.name = "MobileClientAuthError";
  }
}

export interface MobileAuthResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface MobileAuthTransport {
  request(path: "/api/mobile/session/bootstrap" | "/api/mobile/session/refresh" | "/api/mobile/session/revoke", input?: Readonly<{ body?: unknown; accessToken?: string }>): Promise<MobileAuthResponse>;
}

export interface MobileSessionSnapshot {
  readonly tokenType: "Bearer";
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly sessionId: string;
  readonly expiresAtMs: number;
  readonly refreshExpiresAtMs: number;
  readonly audience: "nusa-mobile";
  readonly scopes: readonly string[];
}

const STORAGE_KEY = "nusa:mobile-session:v1";
const text = (value: string, field: string): string => {
  const normalized = value.trim();
  void field;
  if (!normalized) throw new MobileClientAuthError("INVALID_ARGUMENT");
  return normalized;
};
const time = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new MobileClientAuthError("INVALID_ARGUMENT");
  return value;
};
const bodyRecord = (body: unknown): Record<string, unknown> | undefined => body != null && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : undefined;

function responseError(response: MobileAuthResponse): MobileClientAuthError {
  const body = bodyRecord(response.body);
  const value = typeof body?.error === "string" ? body.error : "AUTH_UNAVAILABLE";
  const allowed: readonly MobileClientAuthErrorCode[] = ["AUTH_REQUIRED", "SESSION_EXPIRED", "SESSION_REVOKED", "BOOTSTRAP_DENIED", "INVALID_ARGUMENT", "AUTH_UNAVAILABLE"];
  return new MobileClientAuthError(allowed.includes(value as MobileClientAuthErrorCode) ? value as MobileClientAuthErrorCode : "AUTH_UNAVAILABLE");
}

function decodeSnapshot(value: unknown): MobileSessionSnapshot | null {
  const body = bodyRecord(value);
  if (body == null || body.tokenType !== "Bearer" || body.audience !== "nusa-mobile" || typeof body.accessToken !== "string" || typeof body.refreshToken !== "string" || typeof body.sessionId !== "string" || typeof body.expiresAtMs !== "number" || typeof body.refreshExpiresAtMs !== "number" || !Array.isArray(body.scopes) || body.scopes.some((scope) => typeof scope !== "string")) return null;
  if (!body.accessToken || !body.refreshToken || !body.sessionId || !Number.isSafeInteger(body.expiresAtMs) || !Number.isSafeInteger(body.refreshExpiresAtMs) || body.refreshExpiresAtMs <= body.expiresAtMs) return null;
  return Object.freeze({ tokenType: "Bearer", accessToken: body.accessToken, refreshToken: body.refreshToken, sessionId: body.sessionId, expiresAtMs: body.expiresAtMs, refreshExpiresAtMs: body.refreshExpiresAtMs, audience: "nusa-mobile", scopes: Object.freeze(body.scopes as string[]) });
}

export class MobileSessionProvider {
  private snapshot: MobileSessionSnapshot | null | undefined;

  public constructor(
    private readonly storage: SecureStoragePort,
    private readonly transport: MobileAuthTransport,
    private readonly deviceId: string,
    private readonly now: () => number = Date.now
  ) {
    text(deviceId, "deviceId");
  }

  public async bootstrap(proof: string): Promise<MobileSessionSnapshot> {
    text(proof, "proof");
    let response: MobileAuthResponse;
    try { response = await this.transport.request("/api/mobile/session/bootstrap", { body: { proof, deviceId: this.deviceId } }); }
    catch { throw new MobileClientAuthError("AUTH_UNAVAILABLE"); }
    if (response.status < 200 || response.status >= 300) throw responseError(response);
    const session = decodeSnapshot(response.body);
    if (session == null) throw new MobileClientAuthError("AUTH_UNAVAILABLE");
    await this.save(session);
    return session;
  }

  public async load(): Promise<MobileSessionSnapshot | null> {
    if (this.snapshot !== undefined) return this.snapshot;
    const raw = await this.storage.getSecret(STORAGE_KEY);
    if (raw == null) { this.snapshot = null; return null; }
    try { this.snapshot = decodeSnapshot(JSON.parse(Buffer.from(raw).toString("utf8"))); }
    catch { this.snapshot = null; }
    if (this.snapshot == null) await this.clear();
    return this.snapshot;
  }

  public async accessToken(): Promise<string> {
    const current = await this.load();
    if (current == null) throw new MobileClientAuthError("AUTH_REQUIRED");
    const nowMs = time(this.now());
    if (current.expiresAtMs > nowMs) return current.accessToken;
    if (current.refreshExpiresAtMs <= nowMs) { await this.clear(); throw new MobileClientAuthError("SESSION_EXPIRED"); }
    let response: MobileAuthResponse;
    try { response = await this.transport.request("/api/mobile/session/refresh", { body: { refreshToken: current.refreshToken } }); }
    catch { await this.clear(); throw new MobileClientAuthError("AUTH_UNAVAILABLE"); }
    if (response.status < 200 || response.status >= 300) { await this.clear(); throw responseError(response); }
    const refreshed = decodeSnapshot(response.body);
    if (refreshed == null) { await this.clear(); throw new MobileClientAuthError("AUTH_UNAVAILABLE"); }
    await this.save(refreshed);
    return refreshed.accessToken;
  }

  public async authorizationHeader(): Promise<string> { return `Bearer ${await this.accessToken()}`; }

  public async revoke(): Promise<void> {
    const current = await this.load();
    try {
      if (current != null) { try { await this.transport.request("/api/mobile/session/revoke", { accessToken: current.accessToken }); } catch { /* local logout still clears the credential */ } }
    } finally {
      await this.clear();
    }
  }

  public async clear(): Promise<void> {
    this.snapshot = null;
    await this.storage.deleteSecret(STORAGE_KEY);
  }

  private async save(snapshot: MobileSessionSnapshot): Promise<void> {
    this.snapshot = snapshot;
    await this.storage.setSecret(STORAGE_KEY, Uint8Array.from(Buffer.from(JSON.stringify(snapshot), "utf8")));
  }
}

export function createFetchMobileAuthTransport(
  origin: string,
  fetcher: (url: string, init: Readonly<{ method: string; headers: Readonly<Record<string, string>>; body?: string }>) => Promise<Readonly<{ status: number; json(): Promise<unknown> }>>
): MobileAuthTransport {
  const parsed = new URL(text(origin, "origin"));
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname !== "")) throw new MobileClientAuthError("INVALID_ARGUMENT");
  const base = parsed.toString().replace(/\/$/, "");
  return Object.freeze({
    async request(path: "/api/mobile/session/bootstrap" | "/api/mobile/session/refresh" | "/api/mobile/session/revoke", input: Readonly<{ body?: unknown; accessToken?: string }> = {}) {
      const headers: Record<string, string> = { accept: "application/json" };
      if (input.body !== undefined) headers["content-type"] = "application/json";
      if (input.accessToken !== undefined) headers.authorization = `Bearer ${text(input.accessToken, "accessToken")}`;
      const response = await fetcher(`${base}${path}`, { method: "POST", headers: Object.freeze(headers), ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }) });
      let body: unknown;
      try { body = await response.json(); } catch { body = { error: "AUTH_UNAVAILABLE" }; }
      return Object.freeze({ status: response.status, body });
    }
  });
}
