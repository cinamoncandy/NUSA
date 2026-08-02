import { createSecureSession, isSecureSessionUsable, revokeSecureSession, type SecureSession, type SessionPolicy } from "./secureSession";
import { MobileBiometricAuthentication, type SecureStoragePort } from "./mobileSecurity";
import { TrustedDeviceManager } from "./trustedDeviceManagement";

const keyFor = (sessionId: string): string => `secure-session:${sessionId}`;
const text = (value: string, field: string): string => { const normalized = value.trim(); if (!normalized) throw new Error(`${field} must not be empty`); return normalized; };
const time = (value: number, field: string): void => { if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`); };

export class MobileSessionManager {
  public constructor(
    private readonly storage: SecureStoragePort,
    private readonly devices: TrustedDeviceManager,
    private readonly authentication: MobileBiometricAuthentication,
    private readonly policy: SessionPolicy
  ) {}

  public async create(sessionId: string, deviceId: string, pin: string, nowMs: number): Promise<SecureSession> {
    text(sessionId, "sessionId"); text(deviceId, "deviceId"); time(nowMs, "nowMs");
    await this.devices.verify(deviceId, pin, nowMs);
    const session = createSecureSession({ sessionId, deviceId, nowMs }, this.policy);
    await this.save(session); return session;
  }

  public async load(sessionId: string): Promise<SecureSession | null> {
    const raw = await this.storage.getSecret(keyFor(text(sessionId, "sessionId")));
    return raw === null ? null : JSON.parse(Buffer.from(raw).toString("utf8")) as SecureSession;
  }

  public async refresh(sessionId: string, pin: string, nowMs: number): Promise<SecureSession> {
    const current = await this.requireUsable(sessionId, nowMs);
    await this.authentication.reauthenticateSession(pin, nowMs);
    const refreshed = Object.freeze({ ...current, lastActivityAtMs: nowMs });
    await this.save(refreshed); return refreshed;
  }

  public async revoke(sessionId: string, nowMs: number): Promise<void> {
    const current = await this.load(sessionId); if (current === null) throw new Error("session not found");
    await this.save(revokeSecureSession(current, nowMs));
  }

  public async requireUsable(sessionId: string, nowMs: number): Promise<SecureSession> {
    const session = await this.load(sessionId); time(nowMs, "nowMs");
    if (session === null || !await this.devices.isTrusted(session.deviceId) || !isSecureSessionUsable(session, nowMs, this.policy)) throw new Error("session is expired, revoked, or untrusted");
    return session;
  }

  private async save(session: SecureSession): Promise<void> { await this.storage.setSecret(keyFor(session.sessionId), Uint8Array.from(Buffer.from(JSON.stringify(session), "utf8"))); }
}
