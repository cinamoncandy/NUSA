import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * expo-secure-store has no web implementation (there is no OS keychain in a browser), so this
 * falls back to window.localStorage there -- fine for this app's own dev/preview use, but a
 * real production web deployment of a native-shell app should not treat localStorage as secure
 * storage. Native (iOS/Android) always goes through the real keychain/keystore via SecureStore.
 */
async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // no-op: private browsing / storage disabled
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

const SERVER_URL_KEY = "dokkaebi-server-url";
const API_KEY_KEY = "dokkaebi-api-key";
const DEVICE_ID_KEY = "dokkaebi-device-id";

export async function getServerUrl(): Promise<string> {
  return (await getItem(SERVER_URL_KEY)) ?? "";
}

export async function setServerUrl(url: string): Promise<void> {
  await setItem(SERVER_URL_KEY, url.trim().replace(/\/+$/, ""));
}

export async function getApiKey(): Promise<string> {
  return (await getItem(API_KEY_KEY)) ?? "";
}

export async function setApiKey(key: string): Promise<void> {
  await setItem(API_KEY_KEY, key.trim());
}

/** Generated once per install and persisted -- lets the server's audit log (apps/server's
 * logger.ts, via the X-Device-Id header) tell this phone apart from another device, without
 * asking the operator to name anything. Same convention as apps/web/app.js's own device id. */
export async function getDeviceId(): Promise<string> {
  const existing = await getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const generated = generateUuid();
  await setItem(DEVICE_ID_KEY, generated);
  return generated;
}

function generateUuid(): string {
  const cryptoObj = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  // Fallback for a runtime without crypto.randomUUID (older Hermes/web builds) -- not
  // cryptographically strong, but this id is only ever used as an audit-log label, never a
  // secret or an auth credential.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
