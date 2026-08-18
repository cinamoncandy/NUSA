import type { SecureStoragePort } from "./mobileSecurity";
type NativeSecureStorage = { setSecret(key: string, value: string): Promise<void>; getSecret(key: string): Promise<string | null>; deleteSecret(key: string): Promise<void>; };
type ReactNativeRuntime = { NativeModules: { NusaSecureStorage?: NativeSecureStorage }; Platform: { OS: string } };
const reactNative = require("react-native") as ReactNativeRuntime;
const native = reactNative.NativeModules.NusaSecureStorage;
const encode = (value: Uint8Array): string => { let binary = ""; value.forEach((byte) => { binary += String.fromCharCode(byte); }); return btoa(binary); };
const decode = (value: string): Uint8Array => { const binary = atob(value); return Uint8Array.from(binary, (char) => char.charCodeAt(0)); };
export class NativeKeystoreStorage implements SecureStoragePort {
  public isAvailable(): boolean { return reactNative.Platform.OS === "android" && native != null; }
  public async setSecret(key: string, value: Uint8Array): Promise<void> { if (!this.isAvailable()) throw new Error("SECURE_STORAGE_UNAVAILABLE"); await native!.setSecret(key, encode(value)); }
  public async getSecret(key: string): Promise<Uint8Array | null> { if (!this.isAvailable()) throw new Error("SECURE_STORAGE_UNAVAILABLE"); const value = await native!.getSecret(key); return value == null ? null : decode(value); }
  public async deleteSecret(key: string): Promise<void> { if (!this.isAvailable()) throw new Error("SECURE_STORAGE_UNAVAILABLE"); await native!.deleteSecret(key); }
}
export const nativeKeystoreStorage = new NativeKeystoreStorage();
