import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface UpbitCredentialProvider {
  hasCredentials(): Promise<boolean>;
  saveCredentials(credentials: { accessKey: string; secretKey: string }): Promise<void>;
  loadCredentials(): Promise<{ accessKey: string; secretKey: string } | null>;
  deleteCredentials(): Promise<void>;
}

export interface SafeStoragePort {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

const MAX_KEY_LENGTH = 256;
const SCHEMA_VERSION = 1;

function validateCredentials(value: unknown): { accessKey: string; secretKey: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid credentials");
  const candidate = value as { accessKey?: unknown; secretKey?: unknown };
  if (typeof candidate.accessKey !== "string" || typeof candidate.secretKey !== "string") throw new Error("invalid credentials");
  const accessKey = candidate.accessKey.trim();
  const secretKey = candidate.secretKey.trim();
  if (!accessKey || !secretKey || accessKey.length > MAX_KEY_LENGTH || secretKey.length > MAX_KEY_LENGTH) throw new Error("invalid credentials");
  if (/[^\x20-\x7e]/.test(accessKey) || /[^\x20-\x7e]/.test(secretKey)) throw new Error("invalid credentials");
  return Object.freeze({ accessKey, secretKey });
}

export class ElectronSafeStorageCredentialProvider implements UpbitCredentialProvider {
  public constructor(private readonly filePath: string, private readonly safeStorage: SafeStoragePort) {}

  async hasCredentials(): Promise<boolean> {
    return (await this.loadCredentials()) !== null;
  }

  async saveCredentials(credentials: { accessKey: string; secretKey: string }): Promise<void> {
    const validated = validateCredentials(credentials);
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error("OS credential encryption unavailable");
    const encryptedPayload = this.safeStorage.encryptString(JSON.stringify(validated)).toString("base64");
    const record = JSON.stringify({ schemaVersion: SCHEMA_VERSION, provider: "electron-safe-storage", encryptedPayload });
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, record, { encoding: "utf8", mode: 0o600, flag: "w" });
      renameSync(temporary, this.filePath);
    } catch (error) {
      try { unlinkSync(temporary); } catch { /* preserve the original failure */ }
      throw new Error(`credential persistence failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async loadCredentials(): Promise<{ accessKey: string; secretKey: string } | null> {
    let record: unknown;
    try { record = JSON.parse(readFileSync(this.filePath, "utf8")); } catch { return null; }
    if (!record || typeof record !== "object") return null;
    const value = record as { schemaVersion?: unknown; provider?: unknown; encryptedPayload?: unknown };
    if (value.schemaVersion !== SCHEMA_VERSION || value.provider !== "electron-safe-storage" || typeof value.encryptedPayload !== "string") return null;
    try {
      const decrypted = this.safeStorage.decryptString(Buffer.from(value.encryptedPayload, "base64"));
      return validateCredentials(JSON.parse(decrypted));
    } catch {
      return null;
    }
  }

  async deleteCredentials(): Promise<void> {
    try { unlinkSync(this.filePath); } catch (error) {
      const code = error as NodeJS.ErrnoException;
      if (code.code !== "ENOENT") throw new Error("credential deletion failed");
    }
  }
}
