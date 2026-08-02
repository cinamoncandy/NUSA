export type MobileNotificationSeverity = "INFO" | "WARNING" | "ERROR";

export interface MobileNotification {
  readonly notificationId: string;
  readonly category: string;
  readonly severity: MobileNotificationSeverity;
  readonly title: string;
  readonly message: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number | null;
  readonly readAtMs: number | null;
}

const text = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be empty`);
  return normalized;
};

const time = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};

export class MobileNotificationQueue {
  private readonly items = new Map<string, MobileNotification>();

  public constructor(private readonly maximumItems = 100) {
    if (!Number.isSafeInteger(maximumItems) || maximumItems <= 0) throw new Error("maximumItems must be positive");
  }

  public enqueue(input: Readonly<Omit<MobileNotification, "readAtMs">>): boolean {
    const notificationId = text(input.notificationId, "notificationId");
    const category = text(input.category, "category");
    const title = text(input.title, "title");
    const message = text(input.message, "message");
    time(input.createdAtMs, "createdAtMs");
    if (!(input.severity === "INFO" || input.severity === "WARNING" || input.severity === "ERROR")) throw new Error("severity is invalid");
    if (input.expiresAtMs !== null) {
      time(input.expiresAtMs, "expiresAtMs");
      if (input.expiresAtMs <= input.createdAtMs) throw new Error("notification expiry must be after creation");
    }
    if (this.items.has(notificationId)) return false;
    if (this.items.size >= this.maximumItems) throw new Error("notification queue is full");
    this.items.set(notificationId, Object.freeze({ notificationId, category, severity: input.severity, title, message, createdAtMs: input.createdAtMs, expiresAtMs: input.expiresAtMs, readAtMs: null }));
    return true;
  }

  public list(nowMs: number, unreadOnly = false): readonly MobileNotification[] {
    time(nowMs, "nowMs");
    return Object.freeze([...this.items.values()]
      .filter((item) => item.expiresAtMs === null || item.expiresAtMs > nowMs)
      .filter((item) => !unreadOnly || item.readAtMs === null)
      .sort((a, b) => b.createdAtMs - a.createdAtMs || a.notificationId.localeCompare(b.notificationId)));
  }

  public acknowledge(notificationId: string, atMs: number): MobileNotification {
    time(atMs, "atMs");
    const id = text(notificationId, "notificationId");
    const item = this.items.get(id);
    if (item === undefined) throw new Error("notification is not queued");
    if (item.readAtMs !== null) return item;
    const updated = Object.freeze({ ...item, readAtMs: atMs });
    this.items.set(id, updated);
    return updated;
  }

  public removeExpired(nowMs: number): number {
    time(nowMs, "nowMs");
    let removed = 0;
    for (const [id, item] of this.items) {
      if (item.expiresAtMs !== null && item.expiresAtMs <= nowMs) {
        this.items.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  public get size(): number { return this.items.size; }
}
