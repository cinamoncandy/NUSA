import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { OfflineCache, detectConflict, resolveConflict, type ConflictResolution, type OfflineRecord, type SyncItem } from "./offline-engine";

export type NetworkState = "ONLINE" | "DEGRADED" | "OFFLINE";
export interface NetworkProbe { probe(): Promise<NetworkState>; }
export interface SyncResult<T> { readonly applied: readonly OfflineRecord<T>[]; readonly conflicts: readonly string[]; readonly state: NetworkState; }

const json = (value: unknown): string => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? `${item}n` : item);

export class FileOfflineCache<T> {
  private readonly cache: OfflineCache<T>;
  public constructor(private readonly filePath: string, maximumEntries = 100) { this.cache = new OfflineCache(maximumEntries); }
  public async load(): Promise<void> {
    try {
      const records = JSON.parse(await readFile(this.filePath, "utf8")) as readonly OfflineRecord<T>[];
      for (const record of records) {
        const restored = this.cache.set(record.key, record.value, record.version, record.updatedAtMs);
        if (restored.checksum !== record.checksum) throw new Error("offline cache checksum mismatch");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new Error(`offline cache load failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }
  public set(key: string, value: T, version: number, updatedAtMs: number): OfflineRecord<T> { return this.cache.set(key, value, version, updatedAtMs); }
  public get(key: string): OfflineRecord<T> | undefined { return this.cache.get(key); }
  public list(): readonly OfflineRecord<T>[] { return this.cache.list(); }
  public async flush(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, json(this.cache.list()), { encoding: "utf8" });
    await rename(temporary, this.filePath);
  }
}

export class NetworkStateMonitor {
  private state: NetworkState = "OFFLINE";
  public constructor(private readonly probe: NetworkProbe) {}
  public snapshot(): NetworkState { return this.state; }
  public async refresh(): Promise<NetworkState> { this.state = await this.probe.probe(); return this.state; }
}

export class OfflineSynchronizationService<T> {
  public constructor(private readonly cache: FileOfflineCache<T>, private readonly network: NetworkStateMonitor) {}
  public async synchronize(remote: readonly SyncItem<T>[]): Promise<SyncResult<T>> {
    const state = await this.network.refresh();
    if (state === "OFFLINE") throw new Error("offline synchronization requires a network connection");
    const applied: OfflineRecord<T>[] = [];
    const conflicts: string[] = [];
    for (const item of remote) {
      const local = this.cache.get(item.key);
      if (!local) { applied.push(this.cache.set(item.key, item.value, item.version, item.updatedAtMs)); continue; }
      const resolution: ConflictResolution = detectConflict(local, item);
      if (resolution === "CONFLICT") { conflicts.push(item.key); continue; }
      applied.push(resolveConflict(local, item, resolution));
      if (resolution === "REMOTE_WINS") this.cache.set(item.key, item.value, item.version, item.updatedAtMs);
    }
    if (conflicts.length > 0) throw new Error(`offline synchronization conflicts: ${conflicts.join(",")}`);
    await this.cache.flush();
    return Object.freeze({ applied: Object.freeze(applied), conflicts: Object.freeze(conflicts), state });
  }
}
