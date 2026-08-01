import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { safeStorage } from "electron";

export interface NativeSecretProtector {
  readonly keyId: string;
  isAvailable(): boolean;
  encrypt(plainText: string): string;
  decrypt(cipherText: string): string;
}

export interface SecureStorageRecord {
  readonly version: 1;
  readonly keyId: string;
  readonly ciphertext: string;
}

/** Uses DPAPI on Windows, Keychain on macOS, and Secret Service on supported Linux desktops. */
export class ElectronNativeSecretProtector implements NativeSecretProtector {
  public readonly keyId = "electron-safe-storage-v1";
  public isAvailable(): boolean { return safeStorage.isEncryptionAvailable(); }
  public encrypt(plainText: string): string { if (!this.isAvailable()) throw new Error("native secure storage is unavailable"); return safeStorage.encryptString(plainText).toString("base64"); }
  public decrypt(cipherText: string): string { if (!this.isAvailable()) throw new Error("native secure storage is unavailable"); return safeStorage.decryptString(Buffer.from(cipherText, "base64")); }
}

export class FileSecureStorage {
  private readonly directory: string;
  private protector: NativeSecretProtector;

  public constructor(rootDirectory: string, protector: NativeSecretProtector) {
    if (!rootDirectory.trim()) throw new Error("secure storage directory is required");
    this.directory = join(rootDirectory, "secure-storage");
    this.protector = protector;
  }

  public async set(key: string, value: Uint8Array): Promise<void> {
    this.assertKey(key);
    this.assertAvailable();
    if (!(value instanceof Uint8Array) || value.byteLength === 0) throw new Error("secure value must not be empty");
    const record: SecureStorageRecord = Object.freeze({ version: 1, keyId: this.protector.keyId, ciphertext: this.protector.encrypt(Buffer.from(value).toString("base64")) });
    await mkdir(this.directory, { recursive: true });
    const target = this.pathFor(key);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
  }

  public async get(key: string): Promise<Uint8Array | null> {
    this.assertKey(key);
    this.assertAvailable();
    try {
      const record = JSON.parse(await readFile(this.pathFor(key), "utf8")) as SecureStorageRecord;
      if (record.version !== 1 || record.keyId !== this.protector.keyId || typeof record.ciphertext !== "string") throw new Error("secure storage key mismatch");
      return Uint8Array.from(Buffer.from(this.protector.decrypt(record.ciphertext), "base64"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(`secure storage read failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  public async delete(key: string): Promise<void> {
    this.assertKey(key);
    await rm(this.pathFor(key), { force: true });
  }

  public async rotate(nextProtector: NativeSecretProtector): Promise<void> {
    if (!nextProtector.isAvailable()) throw new Error("next secure storage protector is unavailable");
    if (nextProtector.keyId === this.protector.keyId) throw new Error("next secure storage key must differ");
    const previous = this.protector;
    const entries = await this.listKeys();
    const values = await Promise.all(entries.map(async key => {
      const record = JSON.parse(await readFile(this.pathFor(key), "utf8")) as SecureStorageRecord;
      if (record.keyId !== previous.keyId) throw new Error("secure storage key mismatch");
      return { key, value: Uint8Array.from(Buffer.from(previous.decrypt(record.ciphertext), "base64")) };
    }));
    this.protector = nextProtector;
    try {
      for (const entry of values) await this.set(entry.key, entry.value);
    } catch (error) {
      this.protector = previous;
      throw error;
    }
  }

  private async listKeys(): Promise<string[]> {
    const { readdir } = await import("node:fs/promises");
    try { return (await readdir(this.directory)).filter(name => name.endsWith(".json")).map(name => name.slice(0, -5)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }

  private pathFor(key: string): string { return join(this.directory, `${encodeURIComponent(key)}.json`); }
  private assertKey(key: string): void { if (!key.trim() || key.includes("/") || key.includes("\\")) throw new Error("invalid secure storage key"); }
  private assertAvailable(): void { if (!this.protector.isAvailable()) throw new Error("native secure storage is unavailable"); }
}
