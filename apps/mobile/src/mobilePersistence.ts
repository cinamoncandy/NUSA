export interface VersionedStorage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; }
export interface VersionedRecord<T> { readonly version: number; readonly value: T; readonly checksum: string; }

const checksum = (value: unknown): string => { let hash = 2166136261; for (const char of JSON.stringify(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, "0"); };

export class VersionedJsonStore<T> {
  public constructor(private readonly storage: VersionedStorage, private readonly key: string, private readonly version: number, private readonly validate: (value: unknown) => T) {}

  public async load(): Promise<T | null> {
    const raw = await this.storage.getItem(this.key);
    if (raw === null) return null;
    try {
      const record = JSON.parse(raw) as Partial<VersionedRecord<unknown>>;
      if (record.version !== this.version || typeof record.checksum !== "string") throw new Error("version or checksum mismatch");
      const value = this.validate(record.value);
      if (record.checksum !== checksum(value)) throw new Error("checksum mismatch");
      return value;
    } catch {
      const backup = await this.storage.getItem(`${this.key}:backup`);
      if (backup === null) throw new Error("stored data is unrecoverable");
      const record = JSON.parse(backup) as Partial<VersionedRecord<unknown>>;
      if (record.version !== this.version || record.checksum !== checksum(record.value)) throw new Error("backup data is invalid");
      return this.validate(record.value);
    }
  }

  public async save(value: T): Promise<void> {
    const normalized = this.validate(value);
    const current = await this.storage.getItem(this.key);
    if (current !== null) await this.storage.setItem(`${this.key}:backup`, current);
    await this.storage.setItem(this.key, JSON.stringify({ version: this.version, value: normalized, checksum: checksum(normalized) }));
  }
}

export const persistenceChecksum = checksum;
