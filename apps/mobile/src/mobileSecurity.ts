export interface SecureStoragePort {
  setSecret(key: string, value: Uint8Array): Promise<void>;
  getSecret(key: string): Promise<Uint8Array | null>;
  deleteSecret(key: string): Promise<void>;
}

export interface BiometricAuthenticator {
  isAvailable(): Promise<boolean>;
  authenticate(reason: string): Promise<boolean>;
}

export interface PinAuthenticator {
  verify(pin: string): Promise<boolean>;
}

export interface BiometricPolicy {
  readonly maximumFailures: number;
  readonly lockoutMs: number;
}

export interface BiometricAuthState {
  readonly failures: number;
  readonly lockedUntilMs: number | null;
  readonly lastAuthenticatedAtMs: number | null;
}

export interface TrustedDevice {
  readonly deviceId: string;
  readonly label: string;
  readonly addedAtMs: number;
  readonly revokedAtMs: number | null;
}

export interface TrustedDeviceStore {
  get(deviceId: string): Promise<TrustedDevice | null>;
  save(device: TrustedDevice): Promise<void>;
  revoke(deviceId: string, revokedAtMs: number): Promise<void>;
}

export class MobileBiometricAuthentication {
  private state: BiometricAuthState = Object.freeze({ failures: 0, lockedUntilMs: null, lastAuthenticatedAtMs: null });
  public constructor(private readonly biometric: BiometricAuthenticator, private readonly pin: PinAuthenticator, private readonly policy: BiometricPolicy) {
    if (!Number.isSafeInteger(policy.maximumFailures) || policy.maximumFailures <= 0 || !Number.isSafeInteger(policy.lockoutMs) || policy.lockoutMs <= 0) throw new Error("invalid biometric policy");
  }

  public snapshot(): BiometricAuthState { return this.state; }

  public async authenticate(reason: string, pin: string, nowMs: number): Promise<"BIOMETRIC" | "PIN"> {
    text(reason, "reason"); time(nowMs, "nowMs");
    if (this.state.lockedUntilMs !== null && nowMs < this.state.lockedUntilMs) throw new Error("authentication is locked");
    if (this.state.lockedUntilMs !== null && nowMs >= this.state.lockedUntilMs) this.state = Object.freeze({ ...this.state, failures: 0, lockedUntilMs: null });
    if (await this.biometric.isAvailable() && await this.biometric.authenticate(reason)) { this.state = Object.freeze({ failures: 0, lockedUntilMs: null, lastAuthenticatedAtMs: nowMs }); return "BIOMETRIC"; }
    if (await this.pin.verify(pin)) { this.state = Object.freeze({ failures: 0, lockedUntilMs: null, lastAuthenticatedAtMs: nowMs }); return "PIN"; }
    const failures = this.state.failures + 1;
    this.state = Object.freeze({ failures, lockedUntilMs: failures >= this.policy.maximumFailures ? nowMs + this.policy.lockoutMs : null, lastAuthenticatedAtMs: this.state.lastAuthenticatedAtMs });
    throw new Error("authentication failed");
  }

  public async requireCriticalAction(action: string, pin: string, nowMs: number): Promise<"BIOMETRIC" | "PIN"> { return this.authenticate(`Critical action: ${text(action, "action")}`, pin, nowMs); }
  public async reauthenticateSession(pin: string, nowMs: number): Promise<"BIOMETRIC" | "PIN"> { return this.authenticate("Session re-authentication", pin, nowMs); }
}

const text = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be empty`);
  return normalized;
};

const time = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};

export class MobileSecurityService {
  public constructor(
    private readonly secureStorage: SecureStoragePort,
    private readonly biometric: BiometricAuthenticator,
    private readonly pin: PinAuthenticator,
    private readonly devices: TrustedDeviceStore
  ) {}

  public async storeSecret(key: string, value: Uint8Array): Promise<void> {
    text(key, "key");
    if (!(value instanceof Uint8Array) || value.byteLength === 0) throw new Error("secret value must not be empty");
    await this.secureStorage.setSecret(key, new Uint8Array(value));
  }

  public async readSecret(key: string): Promise<Uint8Array | null> {
    text(key, "key");
    const value = await this.secureStorage.getSecret(key);
    return value === null ? null : new Uint8Array(value);
  }

  public async authenticate(reason: string, pin: string): Promise<"BIOMETRIC" | "PIN"> {
    text(reason, "reason");
    const biometricAvailable = await this.biometric.isAvailable();
    if (biometricAvailable && await this.biometric.authenticate(reason)) return "BIOMETRIC";
    if (await this.pin.verify(pin)) return "PIN";
    throw new Error("authentication failed");
  }

  public async registerDevice(deviceId: string, label: string, addedAtMs: number): Promise<TrustedDevice> {
    time(addedAtMs, "addedAtMs");
    const device: TrustedDevice = Object.freeze({ deviceId: text(deviceId, "deviceId"), label: text(label, "label"), addedAtMs, revokedAtMs: null });
    const existing = await this.devices.get(device.deviceId);
    if (existing !== null && existing.revokedAtMs === null) throw new Error("device is already trusted");
    await this.devices.save(device);
    return device;
  }

  public async isTrusted(deviceId: string): Promise<boolean> {
    const device = await this.devices.get(text(deviceId, "deviceId"));
    return device !== null && device.revokedAtMs === null;
  }

  public async revokeDevice(deviceId: string, revokedAtMs: number): Promise<void> {
    time(revokedAtMs, "revokedAtMs");
    const normalizedId = text(deviceId, "deviceId");
    const device = await this.devices.get(normalizedId);
    if (device === null || device.revokedAtMs !== null) throw new Error("device is not trusted");
    if (revokedAtMs < device.addedAtMs) throw new Error("revocation time is invalid");
    await this.devices.revoke(normalizedId, revokedAtMs);
  }
}
