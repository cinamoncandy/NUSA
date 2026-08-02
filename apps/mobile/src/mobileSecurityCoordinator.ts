import { createSecureSession, isSecureSessionUsable, type SecureSession, type SessionPolicy } from "./secureSession";
import { MobileBiometricAuthentication, type SecureStoragePort, type TrustedDeviceStore } from "./mobileSecurity";

export class MobileSecurityCoordinator {
  public constructor(
    private readonly storage: SecureStoragePort,
    private readonly authentication: MobileBiometricAuthentication,
    private readonly devices: TrustedDeviceStore,
    private readonly sessionPolicy: SessionPolicy
  ) {}

  public async signIn(input: Readonly<{ sessionId: string; deviceId: string; pin: string; nowMs: number }>): Promise<{ readonly session: SecureSession; readonly method: "BIOMETRIC" | "PIN" }> {
    if (!await this.isTrustedDevice(input.deviceId)) throw new Error("device is not trusted");
    const method = await this.authentication.authenticate("Sign in to NUSA", input.pin, input.nowMs);
    return Object.freeze({ session: createSecureSession({ sessionId: input.sessionId, deviceId: input.deviceId, nowMs: input.nowMs }, this.sessionPolicy), method });
  }

  public async reauthenticate(session: SecureSession, pin: string, nowMs: number): Promise<"BIOMETRIC" | "PIN"> {
    if (!await this.isTrustedDevice(session.deviceId) || !isSecureSessionUsable(session, nowMs, this.sessionPolicy)) throw new Error("session is not trusted or usable");
    return this.authentication.reauthenticateSession(pin, nowMs);
  }

  public async resumeAfterRecovery(session: SecureSession, nowMs: number): Promise<SecureSession> {
    if (!await this.isTrustedDevice(session.deviceId) || !isSecureSessionUsable(session, nowMs, this.sessionPolicy)) throw new Error("recovery session is not trusted or usable");
    return session;
  }

  public async storeSensitive(key: string, value: Uint8Array): Promise<void> { await this.storage.setSecret(key, value); }
  public async readSensitive(key: string): Promise<Uint8Array | null> { return this.storage.getSecret(key); }
  public async revokeDevice(deviceId: string, revokedAtMs: number): Promise<void> { await this.devices.revoke(deviceId, revokedAtMs); }
  private async isTrustedDevice(deviceId: string): Promise<boolean> { const device = await this.devices.get(deviceId); return device !== null && device.revokedAtMs === null; }
}
