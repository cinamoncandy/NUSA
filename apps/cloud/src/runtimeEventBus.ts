export type RuntimeEventType =
  | "RUN_STARTED"
  | "STAGE_STARTED"
  | "STAGE_COMPLETED"
  | "RUN_COMPLETED"
  | "SNAPSHOT_PUBLISHED"
  | "INCIDENT_RECORDED";

export interface RuntimeEvent<T = Readonly<Record<string, unknown>>> {
  readonly id: string;
  readonly runId: string;
  readonly type: RuntimeEventType;
  readonly occurredAt: number;
  readonly payload: T;
}

export type RuntimeEventHandler = (event: RuntimeEvent) => void | Promise<void>;

// structuredClone is a native, allocation-cheaper deep clone than a JSON stringify/parse round
// trip -- no intermediate string, and it correctly handles Date/Map/Set/etc. instead of silently
// mangling them the way JSON does.
const cloneFreeze = <T>(value: T): T => {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item && typeof item === "object" && !Object.isFrozen(item)) {
      Object.freeze(item);
      for (const child of Object.values(item as Record<string, unknown>)) freeze(child);
    }
  };
  freeze(copy);
  return copy;
};

export class RuntimeEventBus {
  private readonly handlers = new Map<RuntimeEventType, Set<RuntimeEventHandler>>();
  private readonly seen = new Set<string>();

  subscribe(type: RuntimeEventType, handler: RuntimeEventHandler): () => void {
    const handlers = this.handlers.get(type) ?? new Set<RuntimeEventHandler>();
    handlers.add(handler);
    this.handlers.set(type, handlers);
    return () => handlers.delete(handler);
  }

  async publish(event: RuntimeEvent): Promise<void> {
    if (!event.id.trim() || !event.runId.trim()) throw new Error("runtime event id and runId are required");
    if (!Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0) throw new Error("runtime event occurredAt is invalid");
    if (this.seen.has(event.id)) throw new Error(`duplicate runtime event id: ${event.id}`);
    const immutable = cloneFreeze(event);
    this.seen.add(event.id);
    for (const handler of this.handlers.get(event.type) ?? []) await handler(immutable);
  }
}
