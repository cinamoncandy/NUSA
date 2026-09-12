import type { SecureStoragePort } from "./mobileSecurity";
import type { OwnerDeviceCredentialNative } from "./ownerDeviceCredential";

// Legacy keys are retained only so upgraded clients can destroy credentials that
// older builds may have persisted. New builds never write either key.
const SESSION_STORAGE_KEY = "nusa.mobile.approved-session.v1";
const PAIRING_STORAGE_KEY = "nusa.mobile.pending-pairing.v1";
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
  readonly deviceId?: string;
}

interface MobileBootstrapIssue {
  readonly token: string;
}

interface OwnerDeviceChallenge {
  readonly challengeId: string;
  readonly challenge: string;
  readonly purpose: "REGISTRATION" | "AUTHENTICATION";
  readonly expiresAt: number;
}

export interface MobilePairingRequest {
  readonly requestId: string;
  readonly verificationCode: string;
  readonly expiresAt: number;
  readonly state: "PENDING";
}

export interface MobilePairingStatus {
  readonly state: "PENDING" | "APPROVED" | "CONSUMED" | "EXPIRED";
  readonly expiresAt: number;
}

interface PendingPairingMemory {
  readonly endpoint: string;
  readonly deviceId: string;
  readonly request: MobilePairingRequest;
}

export type MobileApprovedCredentialProvider = () => Promise<string | null>;

export class MobileSessionRequestError extends Error {
  public readonly refusal: string | undefined;
  public constructor(readonly status: number, refusal?: string) {
    super(`mobile session request rejected (${status}).`);
    this.name = "MobileSessionRequestError";
    this.refusal = refusal;
  }
}

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
  if (scopes.some((scope) => !["dashboard:read", "paper:trade", "users:manage"].includes(scope))) throw new Error("mobile session scopes are invalid.");
  return Object.freeze(scopes);
}

function readDeviceId(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string" || value.trim().length < 8 || value.trim().length > 256 || /[\r\n]/.test(value)) throw new Error("device enrollment identifier is invalid.");
  return value.trim();
}

function parseTokens(value: unknown): MobileSessionTokens {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("mobile session response is invalid.");
  const record = value as Record<string, unknown>;
  return Object.freeze({
    accessToken: readToken(record.accessToken, "access token"),
    accessExpiresAt: readTime(record.accessExpiresAt, "access expiry"),
    refreshToken: readToken(record.refreshToken, "refresh token"),
    refreshExpiresAt: readTime(record.refreshExpiresAt, "refresh expiry"),
    scopes: readScopes(record.scopes),
    ...(record.deviceId == null ? {} : { deviceId: readDeviceId(record.deviceId) })
  });
}

function parseBootstrapIssue(value: unknown): MobileBootstrapIssue {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("mobile enrollment response is invalid.");
  return Object.freeze({ token: readToken((value as Record<string, unknown>).token, "bootstrap token") });
}

function parseOwnerDeviceChallenge(value: unknown, purpose: OwnerDeviceChallenge["purpose"]): OwnerDeviceChallenge {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("owner device challenge is invalid.");
  const row = value as Record<string, unknown>;
  const challengeId = readToken(row.challengeId, "owner device challenge id");
  const challenge = readToken(row.challenge, "owner device challenge");
  if (row.purpose !== purpose) throw new Error("owner device challenge purpose is invalid.");
  return Object.freeze({ challengeId, challenge, purpose, expiresAt: readTime(row.expiresAt, "owner device challenge expiry") });
}

function readProof(value: string): string {
  const proof = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(proof) || proof.length < 8 || proof.length > 1024) throw new Error("owner device signature is invalid.");
  return proof;
}

function parseIdentity(value: unknown): MobileApprovedSessionIdentity {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("mobile identity response is invalid.");
  const record = value as Record<string, unknown>;
  if (typeof record.userId !== "string" || !record.userId.trim() || typeof record.email !== "string" || !record.email.trim()) throw new Error("mobile identity response is invalid.");
  const displayName = typeof record.displayName === "string" && record.displayName.trim() ? record.displayName.trim() : undefined;
  return Object.freeze({ userId: record.userId.trim(), email: record.email.trim(), ...(displayName ? { displayName } : {}), scopes: readScopes(record.scopes) });
}

async function readRefusal(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.clone().json();
    const code = body != null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).error
      : undefined;
    return typeof code === "string" && /^[A-Z_]{1,64}$/.test(code) ? code : undefined;
  } catch { return undefined; }
}

async function requestJson(request: typeof fetch, endpoint: string, init: RequestInit): Promise<unknown> {
  const response = await request(endpoint, { ...init, redirect: "error", headers: { accept: "application/json", "content-type": "application/json", ...(init.headers ?? {}) } });
  if (response.redirected === true || (response.url && new URL(response.url).href !== new URL(endpoint).href)) throw new Error("mobile session redirect is prohibited.");
  if (!response.ok) throw new MobileSessionRequestError(response.status, await readRefusal(response));
  return response.json();
}

function isDefinitiveSessionRejection(error: unknown): boolean {
  return error instanceof MobileSessionRequestError && (error.status === 401 || error.status === 403);
}

export class MobileApprovedSession {
  private accessToken: string | null = null;
  private accessExpiresAt = 0;
  private refreshToken: string | null = null;
  private refreshExpiresAt = 0;
  private endpoint: string | null = null;
  private deviceId: string | null = null;
  private identity: MobileApprovedSessionIdentity | null = null;
  private pendingPairing: PendingPairingMemory | null = null;
  private refreshInFlight: Promise<string | null> | null = null;
  private restoreRetryable = false;

  public constructor(private readonly storage: SecureStoragePort | null, private readonly request: typeof fetch = fetch) {}

  public readonly credentialProvider: MobileApprovedCredentialProvider = async () => this.getAccessToken();
  public currentIdentity(): MobileApprovedSessionIdentity | null { return this.identity; }
  public hasMemoryAccess(): boolean { return this.accessToken !== null; }
  /** Retry is process-local only; credentials are never persisted for restart recovery. */
  public shouldRetryRestore(): boolean { return this.restoreRetryable; }

  public async connectBootstrap(baseUrl: string, bootstrapToken: string): Promise<MobileApprovedSessionIdentity> {
    return this.connectBootstrapForDevice(baseUrl, bootstrapToken);
  }

  private async connectBootstrapForDevice(baseUrl: string, bootstrapToken: string, deviceId?: string): Promise<MobileApprovedSessionIdentity> {
    const endpoint = secureEndpoint(baseUrl);
    const token = readToken(bootstrapToken, "bootstrap token");
    const normalizedDevice = deviceId == null ? undefined : readDeviceId(deviceId);
    const tokens = parseTokens(await requestJson(this.request, `${endpoint}/v1/mobile/bootstrap`, { method: "POST", body: JSON.stringify({ bootstrapToken: token, ...(normalizedDevice ? { deviceId: normalizedDevice } : {}) }) }));
    this.deviceId = normalizedDevice ?? null;
    this.acceptTokens(endpoint, tokens);
    try {
      const identity = await this.loadIdentity(endpoint, tokens.accessToken);
      this.identity = identity;
      return identity;
    } catch (error) {
      if (isDefinitiveSessionRejection(error)) this.clearMemory();
      else this.restoreRetryable = true;
      throw error;
    }
  }

  public async enroll(baseUrl: string, userCredential: string, deviceId: string): Promise<MobileApprovedSessionIdentity> {
    const endpoint = secureEndpoint(baseUrl);
    const credential = readToken(userCredential, "user credential");
    const device = readDeviceId(deviceId);
    if (device == null) throw new Error("device enrollment identifier is invalid.");
    await this.destroyLegacyPersistedCredentials();
    const issue = parseBootstrapIssue(await requestJson(this.request, `${endpoint}/v1/mobile/enroll`, {
      method: "POST",
      headers: { authorization: `Bearer ${credential}` },
      body: JSON.stringify({ deviceId: device })
    }));
    return this.connectBootstrapForDevice(endpoint, issue.token, device);
  }

  /**
   * This one-time setup needs a pre-existing ACTIVE OWNER users:manage session.
   * It never treats local biometrics as initial identity proof and never persists
   * that owner bearer; later authentication uses only the hardware key signature.
   */
  public async signInWithOwnerPasswordAndEnrollDeviceCredential(baseUrl: string, password: string, deviceId: string, native: OwnerDeviceCredentialNative): Promise<MobileApprovedSessionIdentity> {
    const endpoint = secureEndpoint(baseUrl);
    const device = readDeviceId(deviceId);
    if (device == null) throw new Error("device enrollment identifier is invalid.");
    if (typeof password !== "string" || password.length === 0 || password.length > 1024) throw new Error("owner password is invalid.");
    const passwordTokens = parseTokens(await requestJson(this.request, `${endpoint}/v1/mobile/session/password`, {
      method: "POST", body: JSON.stringify({ password, deviceId: device })
    }));
    // The newly issued existing mobile session is the only registration bearer.
    // It stays in memory and is cleared immediately if enrollment cannot complete.
    const ownerBearer = passwordTokens.accessToken;
    this.deviceId = passwordTokens.deviceId ?? device;
    this.acceptTokens(endpoint, passwordTokens);
    const created = await native.createCredential();
    const credentialId = readToken(created.credentialId, "owner device credential id");
    const publicKeySpki = readProof(created.publicKeySpki);
    if (created.hardwareBacked !== true) { await native.deleteCredential(credentialId); throw new Error("hardware-backed owner credential is unavailable."); }
    try {
      const challenge = parseOwnerDeviceChallenge(await requestJson(this.request, `${endpoint}/v1/mobile/owner-device/registration/challenge`, {
        method: "POST", headers: { authorization: `Bearer ${ownerBearer}` }, body: JSON.stringify({ credentialId, deviceId: device, publicKeySpki })
      }), "REGISTRATION");
      const proof = readProof(await native.signChallenge(credentialId, challenge.challenge, "이 휴대폰을 NUSA 소유자 기기로 등록"));
      await requestJson(this.request, `${endpoint}/v1/mobile/owner-device/registration/activate`, {
        method: "POST", headers: { authorization: `Bearer ${ownerBearer}` }, body: JSON.stringify({ credentialId, deviceId: device, challengeId: challenge.challengeId, signature: proof })
      });
      return this.authenticateOwnerDeviceCredential(endpoint, device, native, credentialId);
    } catch (error) {
      this.clearMemory();
      try { await native.deleteCredential(credentialId); } catch { /* remove unusable local registration material */ }
      throw error;
    }
  }

  public async authenticateOwnerDeviceCredential(baseUrl: string, deviceId: string, native: OwnerDeviceCredentialNative, credentialId?: string): Promise<MobileApprovedSessionIdentity> {
    const endpoint = secureEndpoint(baseUrl);
    const device = readDeviceId(deviceId);
    if (device == null) throw new Error("device enrollment identifier is invalid.");
    const status = await native.getStatus();
    const id = readToken(credentialId ?? status.credentialId ?? "", "owner device credential id");
    if (status.available !== true || status.hardwareBacked !== true) throw new Error("hardware-backed owner credential is unavailable.");
    const challenge = parseOwnerDeviceChallenge(await requestJson(this.request, `${endpoint}/v1/mobile/owner-device/authentication/challenge`, {
      method: "POST", body: JSON.stringify({ credentialId: id, deviceId: device })
    }), "AUTHENTICATION");
    const proof = readProof(await native.signChallenge(id, challenge.challenge, "NUSA 소유자 인증"));
    const tokens = parseTokens(await requestJson(this.request, `${endpoint}/v1/mobile/owner-device/authentication/complete`, {
      method: "POST", body: JSON.stringify({ credentialId: id, deviceId: device, challengeId: challenge.challengeId, signature: proof })
    }));
    this.deviceId = tokens.deviceId ?? device;
    this.acceptTokens(endpoint, tokens);
    try {
      const identity = await this.loadIdentity(endpoint, tokens.accessToken);
      this.identity = identity;
      return identity;
    } catch (error) {
      if (isDefinitiveSessionRejection(error)) this.clearMemory(); else this.restoreRetryable = true;
      throw error;
    }
  }

  public async changeOwnerPassword(baseUrl: string, currentPassword: string, newPassword: string): Promise<void> {
    const endpoint = secureEndpoint(baseUrl);
    const accessToken = await this.getAccessToken();
    if (accessToken == null || !currentPassword || !newPassword) throw new Error("owner authentication is required.");
    await requestJson(this.request, `${endpoint}/v1/mobile/session/password/change`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ currentPassword, newPassword })
    });
  }

  public async startPairing(baseUrl: string, deviceId: string): Promise<MobilePairingRequest> {
    const endpoint = secureEndpoint(baseUrl);
    const device = readDeviceId(deviceId);
    if (device == null) throw new Error("device enrollment identifier is invalid.");
    const value = await requestJson(this.request, `${endpoint}/v1/mobile/pairing/start`, { method: "POST", body: JSON.stringify({ deviceId: device }) });
    if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("pairing response is invalid.");
    const row = value as Record<string, unknown>;
    const requestId = readToken(row.requestId, "pairing request id");
    const verificationCode = typeof row.verificationCode === "string" && /^\d{6}$/.test(row.verificationCode) ? row.verificationCode : "";
    if (!verificationCode || row.state !== "PENDING") throw new Error("pairing response is invalid.");
    const pairing = Object.freeze({ requestId, verificationCode, expiresAt: readTime(row.expiresAt, "pairing expiry"), state: "PENDING" as const });
    this.pendingPairing = Object.freeze({ endpoint, deviceId: device, request: pairing });
    return pairing;
  }

  /** Pairing capabilities are process-memory-only; a process restart requires a fresh pairing. */
  public async restorePendingPairing(baseUrl: string, deviceId: string): Promise<MobilePairingRequest | null> {
    await this.destroyLegacyPersistedCredentials();
    const endpoint = secureEndpoint(baseUrl);
    const device = readDeviceId(deviceId);
    const pending = this.pendingPairing;
    if (device == null || pending == null) return null;
    if (pending.endpoint !== endpoint || pending.deviceId !== device || pending.request.expiresAt <= Date.now()) {
      this.pendingPairing = null;
      return null;
    }
    return pending.request;
  }

  public async clearPendingPairing(): Promise<void> {
    this.pendingPairing = null;
    if (this.storage != null) {
      try { await this.storage.deleteSecret(PAIRING_STORAGE_KEY); } catch { /* legacy storage is never trusted for use */ }
    }
  }

  public async pairingStatus(baseUrl: string, requestId: string, deviceId: string): Promise<MobilePairingStatus> {
    const endpoint = secureEndpoint(baseUrl);
    const value = await requestJson(this.request, `${endpoint}/v1/mobile/pairing/status`, { method: "POST", body: JSON.stringify({ requestId: readToken(requestId, "pairing request id"), deviceId: readDeviceId(deviceId) }) });
    if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("pairing status is invalid.");
    const row = value as Record<string, unknown>;
    if (!["PENDING", "APPROVED", "CONSUMED", "EXPIRED"].includes(String(row.state))) throw new Error("pairing status is invalid.");
    return Object.freeze({ state: row.state as MobilePairingStatus["state"], expiresAt: readTime(row.expiresAt, "pairing expiry") });
  }

  public async exchangePairing(baseUrl: string, requestId: string, deviceId: string): Promise<MobileApprovedSessionIdentity> {
    const endpoint = secureEndpoint(baseUrl);
    const normalizedRequestId = readToken(requestId, "pairing request id");
    const device = readDeviceId(deviceId);
    try {
      const tokens = parseTokens(await requestJson(this.request, `${endpoint}/v1/mobile/pairing/exchange`, { method: "POST", body: JSON.stringify({ requestId: normalizedRequestId, deviceId: device }) }));
      this.deviceId = tokens.deviceId ?? device ?? null;
      this.acceptTokens(endpoint, tokens);
      try {
        const identity = await this.loadIdentity(endpoint, tokens.accessToken);
        this.identity = identity;
        return identity;
      } catch (error) {
        if (isDefinitiveSessionRejection(error)) this.clearMemory();
        else this.restoreRetryable = true;
        throw error;
      }
    } finally {
      await this.clearPendingPairing();
    }
  }

  /**
   * Restart recovery intentionally returns no session. Any legacy persisted
   * credential is destroyed, and the user may initiate a fresh zero-authority pairing.
   */
  public async restore(baseUrl: string): Promise<MobileApprovedSessionIdentity | null> {
    secureEndpoint(baseUrl);
    this.clearMemory();
    await this.destroyLegacyPersistedCredentials();
    return null;
  }

  public async disconnect(baseUrl?: string): Promise<void> {
    const candidateEndpoint = baseUrl == null ? this.endpoint : baseUrl;
    const access = this.accessToken;
    await this.clearLocal();
    try {
      const endpoint = candidateEndpoint == null ? null : secureEndpoint(candidateEndpoint);
      if (endpoint != null && access != null) {
        await requestJson(this.request, `${endpoint}/v1/mobile/session/revoke`, { method: "POST", headers: { authorization: `Bearer ${access}` }, body: "{}" });
      }
    } catch { /* local credential destruction has already completed */ }
  }

  public clearMemory(): void {
    this.accessToken = null;
    this.accessExpiresAt = 0;
    this.refreshToken = null;
    this.refreshExpiresAt = 0;
    this.endpoint = null;
    this.deviceId = null;
    this.identity = null;
    this.pendingPairing = null;
    this.restoreRetryable = false;
  }

  private async getAccessToken(): Promise<string | null> {
    if (this.accessToken != null && Date.now() + ACCESS_REFRESH_SKEW_MS < this.accessExpiresAt) return this.accessToken;
    if (this.refreshInFlight != null) return this.refreshInFlight;
    const operation = this.refreshFromMemory();
    this.refreshInFlight = operation;
    try { return await operation; }
    finally { if (this.refreshInFlight === operation) this.refreshInFlight = null; }
  }

  private async refreshFromMemory(): Promise<string | null> {
    const endpoint = this.endpoint;
    const refreshToken = this.refreshToken;
    if (endpoint == null || refreshToken == null || Date.now() + ACCESS_REFRESH_SKEW_MS >= this.refreshExpiresAt) {
      this.clearMemory();
      return null;
    }
    try { return (await this.refreshWith(endpoint, refreshToken, this.deviceId ?? undefined)).accessToken; }
    catch (error) {
      if (isDefinitiveSessionRejection(error)) this.clearMemory();
      else this.restoreRetryable = true;
      return null;
    }
  }

  private async refreshWith(endpoint: string, refreshToken: string, deviceId?: string): Promise<MobileSessionTokens> {
    const tokens = parseTokens(await requestJson(this.request, `${endpoint}/v1/mobile/session/refresh`, { method: "POST", body: JSON.stringify({ refreshToken, ...(deviceId ? { deviceId } : {}) }) }));
    this.acceptTokens(endpoint, tokens);
    return tokens;
  }

  private async loadIdentity(endpoint: string, accessToken: string): Promise<MobileApprovedSessionIdentity> {
    return parseIdentity(await requestJson(this.request, `${endpoint}/v1/mobile/me`, { method: "GET", headers: { authorization: `Bearer ${accessToken}` } }));
  }

  private acceptTokens(endpoint: string, tokens: MobileSessionTokens): void {
    this.endpoint = endpoint;
    this.accessToken = tokens.accessToken;
    this.accessExpiresAt = tokens.accessExpiresAt;
    this.refreshToken = tokens.refreshToken;
    this.refreshExpiresAt = tokens.refreshExpiresAt;
    this.deviceId = tokens.deviceId ?? this.deviceId;
    this.restoreRetryable = false;
  }

  private async destroyLegacyPersistedCredentials(): Promise<void> {
    if (this.storage == null) return;
    try { await this.storage.deleteSecret(SESSION_STORAGE_KEY); } catch { /* legacy state remains unusable because it is never read */ }
    try { await this.storage.deleteSecret(PAIRING_STORAGE_KEY); } catch { /* legacy state remains unusable because it is never read */ }
  }

  private async clearLocal(): Promise<void> {
    this.clearMemory();
    await this.destroyLegacyPersistedCredentials();
  }
}

export { PAIRING_STORAGE_KEY, SESSION_STORAGE_KEY };
