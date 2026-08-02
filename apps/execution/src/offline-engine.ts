import { createHash } from "node:crypto";

export interface OfflineRecord<T> {
  readonly key: string;
  readonly version: number;
  readonly updatedAtMs: number;
  readonly value: T;
  readonly checksum: string;
}

export interface SyncItem<T> {
  readonly entity: string;
  readonly key: string;
  readonly version: number;
  readonly updatedAtMs: number;
  readonly value: T;
  readonly checksum: string;
}

export type ConflictResolution = "IDENTICAL" | "LOCAL_WINS" | "REMOTE_WINS" | "CONFLICT";

export interface QueuedAction<T> {
  readonly actionId: string;
  readonly idempotencyKey: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly retryCount: number;
  readonly priority: number;
  readonly value: T;
  readonly checksum: string;
}

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? `${item}n` : item);
const checksum = (value: unknown): string => createHash("sha256").update(canonical(value), "utf8").digest("hex");
export const offlineChecksum = checksum;
const text = (value: string, field: string): string => { const normalized = value.trim(); if (!normalized) throw new Error(`${field} must not be empty`); return normalized; };
const time = (value: number, field: string): void => { if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`); };

export class OfflineCache<T> {
  private readonly records = new Map<string, OfflineRecord<T>>();
  public constructor(private readonly maximumEntries = 100) { if (!Number.isSafeInteger(maximumEntries) || maximumEntries <= 0) throw new Error("maximumEntries must be positive"); }
  public set(key: string, value: T, version: number, updatedAtMs: number): OfflineRecord<T> {
    text(key, "key"); time(updatedAtMs, "updatedAtMs"); if (!Number.isSafeInteger(version) || version < 0) throw new Error("version must be non-negative");
    const record = Object.freeze({ key, version, updatedAtMs, value, checksum: checksum(value) });
    this.records.delete(key); this.records.set(key, record); while (this.records.size > this.maximumEntries) this.records.delete(this.records.keys().next().value!); return record;
  }
  public get(key: string): OfflineRecord<T> | undefined { return this.records.get(text(key, "key")); }
  public list(): readonly OfflineRecord<T>[] { return Object.freeze([...this.records.values()]); }
}

export class SyncQueue<T> {
  private readonly items: SyncItem<T>[] = [];
  private readonly keys = new Set<string>();
  public constructor(private readonly maximumItems = 100) { if (!Number.isSafeInteger(maximumItems) || maximumItems <= 0) throw new Error("maximumItems must be positive"); }
  public enqueue(item: SyncItem<T>): boolean {
    text(item.entity, "entity"); text(item.key, "key"); time(item.updatedAtMs, "updatedAtMs");
    if (this.keys.has(`${item.entity}:${item.key}`)) return false;
    if (this.items.length >= this.maximumItems) throw new Error("sync queue is full");
    const normalized = Object.freeze({ ...item, checksum: item.checksum || checksum(item.value) }); this.items.push(normalized); this.keys.add(`${item.entity}:${item.key}`); return true;
  }
  public dequeue(): SyncItem<T> | undefined { const item = this.items.shift(); if (item) this.keys.delete(`${item.entity}:${item.key}`); return item; }
  public get size(): number { return this.items.length; }
}

export function detectConflict<T>(local: OfflineRecord<T>, remote: SyncItem<T>): ConflictResolution {
  if (local.key !== remote.key || local.checksum !== checksum(local.value) || remote.checksum !== checksum(remote.value)) throw new Error("offline record integrity failure");
  if (local.checksum === remote.checksum && local.version === remote.version) return "IDENTICAL";
  if (local.version > remote.version || (local.version === remote.version && local.updatedAtMs > remote.updatedAtMs)) return "LOCAL_WINS";
  if (remote.version > local.version || (remote.version === local.version && remote.updatedAtMs > local.updatedAtMs)) return "REMOTE_WINS";
  return "CONFLICT";
}

export function resolveConflict<T>(local: OfflineRecord<T>, remote: SyncItem<T>, resolution: ConflictResolution): OfflineRecord<T> {
  const detected = detectConflict(local, remote);
  if (resolution === "IDENTICAL" && detected !== "IDENTICAL") throw new Error("identical resolution is invalid");
  if (resolution === "LOCAL_WINS" && detected === "REMOTE_WINS") throw new Error("local resolution violates ordering");
  if (resolution === "REMOTE_WINS" && detected === "LOCAL_WINS") throw new Error("remote resolution violates ordering");
  if (resolution === "CONFLICT") throw new Error("unresolved offline conflict");
  return resolution === "REMOTE_WINS" ? Object.freeze({ key: remote.key, version: remote.version, updatedAtMs: remote.updatedAtMs, value: remote.value, checksum: remote.checksum }) : local;
}

export class ActionQueue<T> {
  private readonly items: QueuedAction<T>[] = [];
  private readonly keys = new Set<string>();
  public constructor(private readonly maximumItems = 100) { if (!Number.isSafeInteger(maximumItems) || maximumItems <= 0) throw new Error("maximumItems must be positive"); }
  public enqueue(input: Readonly<{ actionId: string; idempotencyKey: string; createdAtMs: number; expiresAtMs: number; priority: number; value: T }>): boolean {
    text(input.actionId, "actionId"); text(input.idempotencyKey, "idempotencyKey"); time(input.createdAtMs, "createdAtMs"); time(input.expiresAtMs, "expiresAtMs");
    if (input.expiresAtMs <= input.createdAtMs || !Number.isSafeInteger(input.priority)) throw new Error("invalid action lifetime or priority");
    if (this.keys.has(input.idempotencyKey)) return false; if (this.items.length >= this.maximumItems) throw new Error("action queue is full");
    const item = Object.freeze({ ...input, retryCount: 0, checksum: checksum(input.value) }); this.items.push(item); this.keys.add(input.idempotencyKey); return true;
  }
  public next(nowMs: number): QueuedAction<T> | undefined { time(nowMs, "nowMs"); this.items.sort((a, b) => b.priority - a.priority || a.createdAtMs - b.createdAtMs || a.actionId.localeCompare(b.actionId)); while (this.items[0] && this.items[0].expiresAtMs <= nowMs) { this.keys.delete(this.items.shift()!.idempotencyKey); } return this.items[0]; }
  public acknowledge(idempotencyKey: string): void { const index = this.items.findIndex(item => item.idempotencyKey === text(idempotencyKey, "idempotencyKey")); if (index < 0) throw new Error("action is not queued"); this.items.splice(index, 1); this.keys.delete(idempotencyKey); }
  public retry(idempotencyKey: string): QueuedAction<T> { const index = this.items.findIndex(item => item.idempotencyKey === text(idempotencyKey, "idempotencyKey")); if (index < 0) throw new Error("action is not queued"); const next = Object.freeze({ ...this.items[index], retryCount: this.items[index].retryCount + 1 }); this.items[index] = next; return next; }
  public get size(): number { return this.items.length; }
}
