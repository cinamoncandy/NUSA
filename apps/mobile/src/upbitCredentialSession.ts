import { createMobileSecureStorage } from "./androidSecureStorage";
import type { SecureStoragePort } from "./mobileSecurity";

const MAX_TOKEN_LENGTH = 4096;
const STORAGE_KEY = "nusa.mobile.upbit-bridge-credential.v1";
let sharedToken: string | null = null;
let restoreInFlight: Promise<string | null> | null = null;
let restoreAttempted = false;

export type UpbitCredentialProvider = () => Promise<string | null>;

function storage(): SecureStoragePort | null {
  return createMobileSecureStorage();
}

function encodeAscii(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 0x7f) throw new Error("Upbit bridge credential is not ASCII-safe.");
    bytes[index] = code;
  }
  return bytes;
}

function decodeAscii(value: Uint8Array): string {
  let result = "";
  for (const byte of value) {
    if (byte > 0x7f) throw new Error("stored Upbit bridge credential is invalid");
    result += String.fromCharCode(byte);
  }
  return result;
}

function validateToken(value: string): string {
  const token = value.trim();
  if (token.length < 16 || token.length > MAX_TOKEN_LENGTH) throw new Error("Upbit bridge credential is invalid.");
  return token;
}

/**
 * Forgets the credential in this process and on the device. An explicit disconnect must not
 * leave a credential behind that the next launch would silently reconnect with.
 */
export function clearUpbitCredentialSession(): void {
  sharedToken = null;
  restoreInFlight = null;
  restoreAttempted = true;
  const port = storage();
  if (port != null) void port.deleteSecret(STORAGE_KEY).catch(() => { /* memory is already cleared */ });
}

/**
 * Personal Upbit bridge credential, held in memory and mirrored to the platform secure
 * storage the approved PAPER session already uses. Android reclaims a backgrounded process
 * freely, so a memory-only credential silently dropped the READ_ONLY connection on every
 * relaunch; persisting it keeps the connection across restarts. The credential grants
 * READ_ONLY Upbit observation only -- it carries no order, transfer, or withdrawal authority.
 */
export class InMemoryUpbitCredentialSession {
  public connect(value: string): void {
    const token = validateToken(value);
    sharedToken = token;
    restoreAttempted = true;
    restoreInFlight = null;
    const port = storage();
    // Persistence is best effort: a runtime without secure storage still connects for this
    // session rather than refusing the credential outright.
    if (port != null) void port.setSecret(STORAGE_KEY, encodeAscii(token)).catch(() => { /* session stays memory-only */ });
  }

  public clear(): void { clearUpbitCredentialSession(); }

  public isConfigured(): boolean { return sharedToken !== null; }

  /** True once a restore has been attempted, so a caller can wait before reporting "not configured". */
  public isRestored(): boolean { return restoreAttempted; }

  public async restore(): Promise<string | null> {
    if (sharedToken != null) return sharedToken;
    if (restoreInFlight != null) return restoreInFlight;
    const port = storage();
    if (port == null) { restoreAttempted = true; return null; }
    const operation = (async (): Promise<string | null> => {
      try {
        const stored = await port.getSecret(STORAGE_KEY);
        if (stored == null) return null;
        const token = validateToken(decodeAscii(stored));
        if (sharedToken == null) sharedToken = token;
        return sharedToken;
      } catch {
        // A corrupt or unreadable record is discarded rather than retried on every read.
        try { await port.deleteSecret(STORAGE_KEY); } catch { /* nothing recoverable to do */ }
        return null;
      } finally {
        restoreAttempted = true;
      }
    })();
    restoreInFlight = operation;
    void operation.finally(() => { if (restoreInFlight === operation) restoreInFlight = null; });
    return operation;
  }

  public readonly credentialProvider: UpbitCredentialProvider = async () => sharedToken ?? await this.restore();
}
