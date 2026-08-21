import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface UpbitReadOnlyCredentials {
  readonly accessKey: string;
  readonly secretKey: string;
}

export interface ReadOnlyCredentialStatus {
  readonly configured: boolean;
  readonly accessKeyHint: string | null;
  readonly provider: "electron-safe-storage";
}

export interface UpbitReadOnlyCredentialProvider {
  status(): Promise<ReadOnlyCredentialStatus>;
  saveForReadOnlyUse(credentials: UpbitReadOnlyCredentials): Promise<void>;
  loadForReadOnlyUse(): Promise<UpbitReadOnlyCredentials | null>;
  deleteCredentials(): Promise<void>;
}

export interface SafeStoragePort {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

const MAX_KEY_LENGTH = 256;
const SCHEMA_VERSION = 1;
const PROVIDER = "electron-safe-storage" as const;

function validateCredentials(value: unknown): UpbitReadOnlyCredentials {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid credentials");
  const candidate = value as { accessKey?: unknown; secretKey?: unknown };
  if (typeof candidate.accessKey !== "string" || typeof candidate.secretKey !== "string") throw new Error("invalid credentials");
  const accessKey = candidate.accessKey.trim();
  const secretKey = candidate.secretKey.trim();
  if (!accessKey || !secretKey || accessKey.length > MAX_KEY_LENGTH || secretKey.length > MAX_KEY_LENGTH) throw new Error("invalid credentials");
  if (/[^\x20-\x7e]/.test(accessKey) || /[^\x20-\x7e]/.test(secretKey)) throw new Error("invalid credentials");
  return Object.freeze({ accessKey, secretKey });
}

function hint(accessKey: string): string {
  if (accessKey.length <= 8) return "••••";
  return `${accessKey.slice(0, 4)}…${accessKey.slice(-4)}`;
}

export class ElectronSafeStorageReadOnlyCredentialProvider implements UpbitReadOnlyCredentialProvider {
  public constructor(private readonly filePath: string, private readonly safeStorage: SafeStoragePort) {}

  async status(): Promise<ReadOnlyCredentialStatus> {
    const credentials = await this.loadForReadOnlyUse();
    return Object.freeze({ configured: credentials !== null, accessKeyHint: credentials ? hint(credentials.accessKey) : null, provider: PROVIDER });
  }

  async saveForReadOnlyUse(credentials: UpbitReadOnlyCredentials): Promise<void> {
    const validated = validateCredentials(credentials);
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error("OS credential encryption unavailable");
    const encryptedPayload = this.safeStorage.encryptString(JSON.stringify(validated)).toString("base64");
    const record = JSON.stringify({ schemaVersion: SCHEMA_VERSION, provider: PROVIDER, purpose: "READ_ONLY_BROKER_AUTH", encryptedPayload });
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, record, { encoding: "utf8", mode: 0o600, flag: "w" });
      renameSync(temporary, this.filePath);
    } catch (error) {
      try { unlinkSync(temporary); } catch { /* preserve original failure */ }
      throw new Error(`credential persistence failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async loadForReadOnlyUse(): Promise<UpbitReadOnlyCredentials | null> {
    if (!this.safeStorage.isEncryptionAvailable()) return null;
    let record: unknown;
    try { record = JSON.parse(readFileSync(this.filePath, "utf8")); } catch { return null; }
    if (!record || typeof record !== "object" || Array.isArray(record)) return null;
    const value = record as { schemaVersion?: unknown; provider?: unknown; purpose?: unknown; encryptedPayload?: unknown };
    if (value.schemaVersion !== SCHEMA_VERSION || value.provider !== PROVIDER || value.purpose !== "READ_ONLY_BROKER_AUTH" || typeof value.encryptedPayload !== "string") return null;
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
