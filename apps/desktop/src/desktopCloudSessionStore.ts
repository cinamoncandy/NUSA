import fs from "node:fs";
import path from "node:path";

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}

interface PersistedDesktopSession {
  readonly version: 1;
  readonly endpoint: string;
  readonly encryptedRefreshToken: string;
}

export interface StoredDesktopRefreshSession {
  readonly endpoint: string;
  readonly refreshToken: string;
}

const normalizeEndpoint = (value: string): string => {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("desktop cloud endpoint must name the server origin only");
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("desktop cloud endpoint must use HTTPS or loopback HTTP");
  return url.origin;
};

export class DesktopCloudSessionStore {
  public constructor(
    private readonly safeStorage: SafeStorageLike,
    private readonly filePath: string
  ) {}

  public save(endpoint: string, refreshToken: string): void {
    if (!this.encryptionUsable()) throw new Error("desktop secure storage unavailable");
    const normalizedEndpoint = normalizeEndpoint(endpoint);
    if (!refreshToken || Buffer.byteLength(refreshToken, "utf8") < 32) throw new Error("desktop refresh token is invalid");
    const encrypted = this.safeStorage.encryptString(refreshToken);
    if (encrypted.length === 0) throw new Error("desktop refresh token encryption failed");
    const payload: PersistedDesktopSession = Object.freeze({ version: 1, endpoint: normalizedEndpoint, encryptedRefreshToken: encrypted.toString("base64") });
    const directory = path.dirname(this.filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.tmp-${process.pid}`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 });
      try { fs.chmodSync(temporary, 0o600); } catch { /* Windows ACLs are owned by the OS profile. */ }
      fs.renameSync(temporary, this.filePath);
      try { fs.chmodSync(this.filePath, 0o600); } catch { /* Windows ACLs are owned by the OS profile. */ }
    } finally {
      try { if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true }); } catch { /* best effort cleanup */ }
    }
  }

  public load(): StoredDesktopRefreshSession | undefined {
    if (!fs.existsSync(this.filePath)) return undefined;
    if (!this.encryptionUsable()) throw new Error("desktop secure storage unavailable");
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")); } catch { throw new Error("desktop secure session file is invalid"); }
    if (parsed == null || typeof parsed !== "object") throw new Error("desktop secure session file is invalid");
    const value = parsed as Record<string, unknown>;
    if (value.version !== 1 || typeof value.endpoint !== "string" || typeof value.encryptedRefreshToken !== "string" || !value.encryptedRefreshToken) {
      throw new Error("desktop secure session file is invalid");
    }
    const endpoint = normalizeEndpoint(value.endpoint);
    let refreshToken: string;
    try { refreshToken = this.safeStorage.decryptString(Buffer.from(value.encryptedRefreshToken, "base64")); }
    catch { throw new Error("desktop refresh token decryption failed"); }
    if (!refreshToken || Buffer.byteLength(refreshToken, "utf8") < 32) throw new Error("desktop refresh token is invalid");
    return Object.freeze({ endpoint, refreshToken });
  }

  public clear(): void {
    try { fs.rmSync(this.filePath, { force: true }); } catch { throw new Error("desktop secure session cleanup failed"); }
  }

  private encryptionUsable(): boolean {
    if (!this.safeStorage.isEncryptionAvailable()) return false;
    const backend = this.safeStorage.getSelectedStorageBackend?.();
    return backend !== "basic_text";
  }
}
