import type { RuntimeEvent } from "./runtimeEventBus";

export interface RuntimeReplayFrame {
  readonly sequence: number;
  readonly offsetMs: number;
  readonly event: RuntimeEvent;
}

export interface RuntimeReplay {
  readonly runId: string;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly frames: readonly RuntimeReplayFrame[];
}

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

export const buildRuntimeReplay = (events: readonly RuntimeEvent[]): RuntimeReplay => {
  if (events.length === 0) throw new Error("runtime replay requires events");
  const runId = events[0].runId;
  if (events.some((event) => event.runId !== runId)) throw new Error("runtime replay cannot mix runIds");
  const sorted = [...events].sort((a, b) => a.occurredAt - b.occurredAt || a.id.localeCompare(b.id));
  if (new Set(sorted.map((event) => event.id)).size !== sorted.length) throw new Error("runtime replay contains duplicate event ids");
  const startedAt = sorted[0].occurredAt;
  const completedAt = sorted[sorted.length - 1].occurredAt;
  return cloneFreeze({
    runId,
    startedAt,
    completedAt,
    frames: sorted.map((event, sequence) => ({ sequence, offsetMs: event.occurredAt - startedAt, event }))
  });
};
