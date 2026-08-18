import type { SecureStoragePort } from "./mobileSecurity";

export type MobileAuthState = "SIGNED_OUT" | "AUTHENTICATING" | "ACTIVE" | "EXPIRED" | "BLOCKED" | "OFFLINE";
export interface MobileIdentity { readonly userId: string; readonly email: string; readonly displayName?: string; readonly scopes: readonly string[]; }
export interface MobileSessionClientOptions { readonly baseUrl?: string; readonly secureStorage: SecureStoragePort; readonly fetcher?: typeof fetch; readonly production?: boolean; }
const REFRESH_KEY = "nusa.mobile.refresh.v1";
const DEFAULT_ORIGIN = "https://nusa-api.duckdns.org";
const assertOrigin = (candidate: string, production: boolean): string => { const url = new URL(candidate); if (production && (url.protocol !== "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1")) throw new Error("INVALID_PRODUCTION_ORIGIN"); return url.toString().replace(/\/$/, ""); };
const json = async (response: Response): Promise<Record<string, unknown>> => { const value = await response.json() as unknown; if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_SESSION_RESPONSE"); return value as Record<string, unknown>; };
const tokens = (value: Record<string, unknown>): { accessToken: string; refreshToken: string } => { if (typeof value.accessToken !== "string" || typeof value.refreshToken !== "string") throw new Error("INVALID_SESSION_RESPONSE"); return { accessToken: value.accessToken, refreshToken: value.refreshToken }; };

export class MobileSessionClient {
  private accessToken: string | null = null;
  public state: MobileAuthState = "SIGNED_OUT";
  public identity: MobileIdentity | null = null;
  private readonly origin: string;
  private readonly secureStorage: SecureStoragePort;
  private readonly fetcher: typeof fetch;
  public constructor(options: MobileSessionClientOptions) { this.origin = assertOrigin(options.baseUrl ?? DEFAULT_ORIGIN, options.production ?? true); this.secureStorage = options.secureStorage; this.fetcher = options.fetcher ?? fetch; }
  public async bootstrap(oneTimeToken: string): Promise<MobileIdentity> { if (!oneTimeToken.trim()) throw new Error("BOOTSTRAP_TOKEN_REQUIRED"); this.state = "AUTHENTICATING"; const response = await this.fetcher(`${this.origin}/v1/mobile/bootstrap`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bootstrapToken: oneTimeToken }) }); if (!response.ok) { this.state = response.status >= 500 ? "OFFLINE" : "BLOCKED"; throw new Error("MOBILE_BOOTSTRAP_REJECTED"); } const value = tokens(await json(response)); await this.secureStorage.setSecret(REFRESH_KEY, new TextEncoder().encode(value.refreshToken)); this.accessToken = value.accessToken; return this.requireIdentity(await this.me()); }
  public async restore(): Promise<MobileIdentity | null> { const stored = await this.secureStorage.getSecret(REFRESH_KEY); if (stored == null) return null; const response = await this.fetcher(`${this.origin}/v1/mobile/session/refresh`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: new TextDecoder().decode(stored) }) }); if (!response.ok) { await this.logout(); this.state = response.status >= 500 ? "OFFLINE" : "EXPIRED"; return null; } const value = tokens(await json(response)); await this.secureStorage.setSecret(REFRESH_KEY, new TextEncoder().encode(value.refreshToken)); this.accessToken = value.accessToken; return this.requireIdentity(await this.me()); }
  public async me(): Promise<Record<string, unknown>> { if (this.accessToken == null) throw new Error("SESSION_REQUIRED"); const response = await this.fetcher(`${this.origin}/v1/mobile/me`, { headers: { authorization: `Bearer ${this.accessToken}` } }); if (!response.ok) { this.state = response.status === 401 ? "EXPIRED" : "OFFLINE"; throw new Error("MOBILE_SESSION_REJECTED"); } return await json(response); }
  public async logout(): Promise<void> { const token = this.accessToken; this.accessToken = null; this.identity = null; this.state = "SIGNED_OUT"; await this.secureStorage.deleteSecret(REFRESH_KEY); if (token != null) { try { await this.fetcher(`${this.origin}/v1/mobile/session/revoke`, { method: "POST", headers: { authorization: `Bearer ${token}` } }); } catch { /* local logout remains fail-closed */ } } }
  public getAccessTokenForMainProcessOnly(): never { throw new Error("ACCESS_TOKEN_NOT_EXPOSED_TO_UI"); }
  private requireIdentity(value: Record<string, unknown>): MobileIdentity { if (typeof value.userId !== "string" || typeof value.email !== "string" || !Array.isArray(value.scopes) || value.scopes.some((scope) => typeof scope !== "string")) throw new Error("INVALID_IDENTITY_RESPONSE"); this.identity = Object.freeze({ userId: value.userId, email: value.email, ...(typeof value.displayName === "string" ? { displayName: value.displayName } : {}), scopes: Object.freeze(value.scopes as string[]) }); this.state = "ACTIVE"; return this.identity; }
}
