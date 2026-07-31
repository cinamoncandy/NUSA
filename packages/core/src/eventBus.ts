export type EventMap = Record<string, unknown>;

export type EventHandler<Payload> = (payload: Payload) => void | Promise<void>;

export interface Subscription {
  unsubscribe(): void;
}

export interface PublishOptions {
  mode?: "serial" | "parallel";
  signal?: AbortSignal;
}

export class EventBus<Events extends EventMap> {
  private readonly handlers = new Map<keyof Events, Set<EventHandler<unknown>>>();

  subscribe<Key extends keyof Events>(
    event: Key,
    handler: EventHandler<Events[Key]>,
  ): Subscription {
    const eventHandlers = this.handlers.get(event) ?? new Set<EventHandler<unknown>>();
    eventHandlers.add(handler as EventHandler<unknown>);
    this.handlers.set(event, eventHandlers);

    let active = true;
    return {
      unsubscribe: () => {
        if (!active) return;
        active = false;
        eventHandlers.delete(handler as EventHandler<unknown>);
        if (eventHandlers.size === 0) this.handlers.delete(event);
      },
    };
  }

  once<Key extends keyof Events>(
    event: Key,
    handler: EventHandler<Events[Key]>,
  ): Subscription {
    let subscription: Subscription | undefined;
    subscription = this.subscribe(event, async (payload) => {
      subscription?.unsubscribe();
      await handler(payload);
    });
    return subscription;
  }

  async publish<Key extends keyof Events>(
    event: Key,
    payload: Events[Key],
    options: PublishOptions = {},
  ): Promise<void> {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new Error("Event publication aborted");
    }

    const handlers = [...(this.handlers.get(event) ?? [])] as EventHandler<Events[Key]>[];
    const invoke = async (handler: EventHandler<Events[Key]>): Promise<void> => {
      if (options.signal?.aborted) {
        throw options.signal.reason ?? new Error("Event publication aborted");
      }
      await handler(payload);
    };

    if (options.mode === "parallel") {
      await Promise.all(handlers.map(invoke));
      return;
    }

    for (const handler of handlers) {
      await invoke(handler);
    }
  }

  clear<Key extends keyof Events>(event?: Key): void {
    if (event === undefined) {
      this.handlers.clear();
      return;
    }
    this.handlers.delete(event);
  }

  listenerCount<Key extends keyof Events>(event: Key): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}
