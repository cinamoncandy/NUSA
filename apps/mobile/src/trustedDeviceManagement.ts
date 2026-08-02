import { MobileBiometricAuthentication, type SecureStoragePort, type TrustedDevice } from "./mobileSecurity";

const INDEX_KEY = "trusted-devices:index";
const text = (value: string, field: string): string => { const normalized = value.trim(); if (!normalized) throw new Error(`${field} must not be empty`); return normalized; };
const time = (value: number, field: string): void => { if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`); };

export class TrustedDeviceManager {
  public constructor(private readonly storage: SecureStoragePort, private readonly authentication: MobileBiometricAuthentication) {}

  public async register(deviceId: string, label: string, pin: string, nowMs: number): Promise<TrustedDevice> {
    const id = text(deviceId, "deviceId"); const name = text(label, "label"); time(nowMs, "nowMs");
    await this.authentication.requireCriticalAction("register trusted device", pin, nowMs);
    const existing = await this.read(id);
    if (existing !== null && existing.revokedAtMs === null) throw new Error("device is already trusted");
    const device = Object.freeze({ deviceId: id, label: name, addedAtMs: nowMs, revokedAtMs: null });
    await this.write(device); return device;
  }

  public async rename(deviceId: string, label: string, pin: string, nowMs: number): Promise<TrustedDevice> {
    const current = await this.requireTrusted(deviceId); time(nowMs, "nowMs");
    await this.authentication.requireCriticalAction("rename trusted device", pin, nowMs);
    const renamed = Object.freeze({ ...current, label: text(label, "label") }); await this.write(renamed); return renamed;
  }

  public async revoke(deviceId: string, pin: string, nowMs: number): Promise<void> {
    const current = await this.requireTrusted(deviceId); time(nowMs, "nowMs");
    if (nowMs < current.addedAtMs) throw new Error("revocation time is invalid");
    await this.authentication.requireCriticalAction("revoke trusted device", pin, nowMs);
    await this.write(Object.freeze({ ...current, revokedAtMs: nowMs }));
  }

  public async isTrusted(deviceId: string): Promise<boolean> { const device = await this.read(text(deviceId, "deviceId")); return device !== null && device.revokedAtMs === null; }
  public async verify(deviceId: string, pin: string, nowMs: number): Promise<TrustedDevice> {
    const device = await this.requireTrusted(deviceId);
    await this.authentication.requireCriticalAction("verify trusted device", pin, nowMs);
    return device;
  }
  public async requireTrusted(deviceId: string): Promise<TrustedDevice> { const device = await this.read(text(deviceId, "deviceId")); if (device === null || device.revokedAtMs !== null) throw new Error("unknown or revoked device requires verification"); return device; }
  public async list(): Promise<readonly TrustedDevice[]> { const ids = await this.readIndex(); return Object.freeze((await Promise.all(ids.map(id => this.read(id)))).filter((device): device is TrustedDevice => device !== null)); }

  private async read(deviceId: string): Promise<TrustedDevice | null> { const raw = await this.storage.getSecret(`trusted-device:${deviceId}`); return raw === null ? null : JSON.parse(Buffer.from(raw).toString("utf8")) as TrustedDevice; }
  private async write(device: TrustedDevice): Promise<void> { const ids = await this.readIndex(); if (!ids.includes(device.deviceId)) ids.push(device.deviceId); await this.storage.setSecret(`trusted-device:${device.deviceId}`, Uint8Array.from(Buffer.from(JSON.stringify(device), "utf8"))); await this.storage.setSecret(INDEX_KEY, Uint8Array.from(Buffer.from(JSON.stringify(ids), "utf8"))); }
  private async readIndex(): Promise<string[]> { const raw = await this.storage.getSecret(INDEX_KEY); return raw === null ? [] : JSON.parse(Buffer.from(raw).toString("utf8")) as string[]; }
}
