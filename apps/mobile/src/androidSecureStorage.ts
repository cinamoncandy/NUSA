import { NativeModules, Platform } from "react-native";
import type { SecureStoragePort } from "./mobileSecurity";

interface NusaSecureStorageNativeModule {
  setSecret(key: string, valueBase64: string): Promise<void>;
  getSecret(key: string): Promise<string | null>;
  deleteSecret(key: string): Promise<void>;
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64(value: Uint8Array): string {
  let output = "";
  for (let index = 0; index < value.length; index += 3) {
    const a = value[index] ?? 0;
    const b = value[index + 1] ?? 0;
    const c = value[index + 2] ?? 0;
    const combined = (a << 16) | (b << 8) | c;
    output += alphabet[(combined >>> 18) & 63];
    output += alphabet[(combined >>> 12) & 63];
    output += index + 1 < value.length ? alphabet[(combined >>> 6) & 63] : "=";
    output += index + 2 < value.length ? alphabet[combined & 63] : "=";
  }
  return output;
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.trim();
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw new Error("secure storage payload is invalid");
  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 4) {
    const c0 = alphabet.indexOf(normalized[index]);
    const c1 = alphabet.indexOf(normalized[index + 1]);
    const c2 = normalized[index + 2] === "=" ? 0 : alphabet.indexOf(normalized[index + 2]);
    const c3 = normalized[index + 3] === "=" ? 0 : alphabet.indexOf(normalized[index + 3]);
    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) throw new Error("secure storage payload is invalid");
    const combined = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    bytes.push((combined >>> 16) & 255);
    if (normalized[index + 2] !== "=") bytes.push((combined >>> 8) & 255);
    if (normalized[index + 3] !== "=") bytes.push(combined & 255);
  }
  return new Uint8Array(bytes);
}

function nativeModule(): NusaSecureStorageNativeModule | null {
  if (Platform.OS !== "android") return null;
  const module = NativeModules.NusaSecureStorage as Partial<NusaSecureStorageNativeModule> | undefined;
  if (module == null || typeof module.setSecret !== "function" || typeof module.getSecret !== "function" || typeof module.deleteSecret !== "function") return null;
  return module as NusaSecureStorageNativeModule;
}

export class AndroidKeystoreSecureStorage implements SecureStoragePort {
  public constructor(private readonly native: NusaSecureStorageNativeModule) {}

  public async setSecret(key: string, value: Uint8Array): Promise<void> {
    if (!(value instanceof Uint8Array) || value.byteLength === 0) throw new Error("secure storage value must not be empty");
    await this.native.setSecret(key, encodeBase64(value));
  }

  public async getSecret(key: string): Promise<Uint8Array | null> {
    const value = await this.native.getSecret(key);
    return value == null ? null : decodeBase64(value);
  }

  public async deleteSecret(key: string): Promise<void> {
    await this.native.deleteSecret(key);
  }
}

export function createMobileSecureStorage(): SecureStoragePort | null {
  const module = nativeModule();
  return module == null ? null : new AndroidKeystoreSecureStorage(module);
}
