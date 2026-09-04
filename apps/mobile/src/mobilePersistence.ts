export interface VersionedStorage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; }
export interface VersionedRecord<T> { readonly version: number; readonly value: T; readonly checksum: string; }

const checksum = (value: unknown): string => { let hash = 2166136261; for (const char of JSON.stringify(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, "0"); };

/**
 * True only if `raw` is a well-formed, self-consistent VersionedRecord: it parses as JSON,
 * carries a numeric version and a string checksum, and that checksum matches its own value.
 * `save()` uses this to decide whether the CURRENT primary is worth keeping as a backup --
 * see the comment there for why that check has to exist at all.
 */
function isRecoverableRecord(raw: string): boolean {
  try {
    const record = JSON.parse(raw) as Partial<VersionedRecord<unknown>>;
    return typeof record.version === "number" && typeof record.checksum === "string" && record.checksum === checksum(record.value);
  } catch {
    return false;
  }
}

export class VersionedJsonStore<T> {
  public constructor(private readonly storage: VersionedStorage, private readonly key: string, private readonly version: number, private readonly validate: (value: unknown) => T, private readonly migrate?: (value: unknown, version: number) => T) {}

  public async load(): Promise<T | null> {
    const raw = await this.storage.getItem(this.key);
    if (raw === null) return null;
    try {
      const record = JSON.parse(raw) as Partial<VersionedRecord<unknown>>;
      if (typeof record.version !== "number" || typeof record.checksum !== "string") throw new Error("version or checksum mismatch");
      if (record.version !== this.version) {
        if (record.version > this.version || this.migrate === undefined || record.checksum !== checksum(record.value)) throw new Error("version mismatch");
        const migrated = this.migrate(record.value, record.version);
        await this.save(migrated);
        return migrated;
      }
      const value = this.validate(record.value);
      if (record.checksum !== checksum(value)) throw new Error("checksum mismatch");
      return value;
    } catch {
      const backup = await this.storage.getItem(`${this.key}:backup`);
      if (backup === null) throw new Error("stored data is unrecoverable");
      let record: Partial<VersionedRecord<unknown>>;
      try {
        record = JSON.parse(backup) as Partial<VersionedRecord<unknown>>;
      } catch {
        throw new Error("backup data is invalid");
      }
      if (record.version !== this.version || record.checksum !== checksum(record.value)) throw new Error("backup data is invalid");
      return this.validate(record.value);
    }
  }

  public async save(value: T): Promise<void> {
    const normalized = this.validate(value);
    const current = await this.storage.getItem(this.key);
    // Only a SELF-CONSISTENT current record is promoted to the backup slot. Without this
    // check, a primary corrupted by a crash mid-write, bit rot, or any other cause would be
    // blindly copied into the one place `load()` falls back to when the primary fails --
    // poisoning the backup with the exact kind of data it exists to recover from. The next
    // failed write after that would leave both copies unreadable. An unrecoverable current
    // value is simply left out of the rotation; whatever backup already exists (the last
    // known-good one) is left untouched rather than being overwritten with garbage.
    if (current !== null && isRecoverableRecord(current)) await this.storage.setItem(`${this.key}:backup`, current);
    await this.storage.setItem(this.key, JSON.stringify({ version: this.version, value: normalized, checksum: checksum(normalized) }));
  }
}

export const persistenceChecksum = checksum;
