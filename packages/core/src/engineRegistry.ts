export type EngineState = "registered" | "starting" | "running" | "stopping" | "stopped" | "failed";

export interface EngineContext {
  readonly services: ServiceContainer;
  readonly signal: AbortSignal;
}

export interface Engine {
  readonly id: string;
  readonly dependencies?: readonly string[];
  start(context: EngineContext): void | Promise<void>;
  stop?(context: EngineContext): void | Promise<void>;
}

export class ServiceContainer {
  private readonly services = new Map<string, unknown>();

  register<T>(key: string, service: T): void {
    if (this.services.has(key)) throw new Error(`Service already registered: ${key}`);
    this.services.set(key, service);
  }

  replace<T>(key: string, service: T): void {
    this.services.set(key, service);
  }

  resolve<T>(key: string): T {
    if (!this.services.has(key)) throw new Error(`Service not registered: ${key}`);
    return this.services.get(key) as T;
  }

  has(key: string): boolean {
    return this.services.has(key);
  }
}

export class EngineRegistry {
  private readonly engines = new Map<string, Engine>();
  private readonly states = new Map<string, EngineState>();
  private readonly controllers = new Map<string, AbortController>();

  constructor(readonly services = new ServiceContainer()) {}

  register(engine: Engine): void {
    if (!engine.id.trim()) throw new Error("Engine id must not be empty");
    if (this.engines.has(engine.id)) throw new Error(`Engine already registered: ${engine.id}`);
    this.engines.set(engine.id, engine);
    this.states.set(engine.id, "registered");
  }

  get(id: string): Engine {
    const engine = this.engines.get(id);
    if (!engine) throw new Error(`Engine not registered: ${id}`);
    return engine;
  }

  state(id: string): EngineState {
    const state = this.states.get(id);
    if (!state) throw new Error(`Engine not registered: ${id}`);
    return state;
  }

  list(): readonly { id: string; state: EngineState }[] {
    return [...this.engines.keys()].map((id) => ({ id, state: this.state(id) }));
  }

  async startAll(): Promise<void> {
    const order = this.resolveStartOrder();
    const started: string[] = [];
    try {
      for (const id of order) {
        await this.start(id);
        started.push(id);
      }
    } catch (error) {
      for (const id of started.reverse()) {
        try { await this.stop(id); } catch { /* preserve the original startup failure */ }
      }
      throw error;
    }
  }

  async stopAll(): Promise<void> {
    const order = this.resolveStartOrder().reverse();
    const errors: unknown[] = [];
    for (const id of order) {
      try { await this.stop(id); } catch (error) { errors.push(error); }
    }
    if (errors.length > 0) throw new AggregateError(errors, "One or more engines failed to stop");
  }

  async start(id: string): Promise<void> {
    const engine = this.get(id);
    const current = this.state(id);
    if (current === "running") return;
    if (current === "starting" || current === "stopping") {
      throw new Error(`Engine ${id} is transitioning: ${current}`);
    }

    for (const dependency of engine.dependencies ?? []) {
      if (this.state(dependency) !== "running") {
        throw new Error(`Engine ${id} requires running dependency ${dependency}`);
      }
    }

    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.states.set(id, "starting");
    try {
      await engine.start({ services: this.services, signal: controller.signal });
      this.states.set(id, "running");
    } catch (error) {
      controller.abort(error);
      this.controllers.delete(id);
      this.states.set(id, "failed");
      throw error;
    }
  }

  async stop(id: string): Promise<void> {
    const engine = this.get(id);
    const current = this.state(id);
    if (current === "registered" || current === "stopped") return;
    if (current === "starting" || current === "stopping") {
      throw new Error(`Engine ${id} is transitioning: ${current}`);
    }

    const controller = this.controllers.get(id) ?? new AbortController();
    this.states.set(id, "stopping");
    controller.abort(new Error(`Engine stopped: ${id}`));
    try {
      await engine.stop?.({ services: this.services, signal: controller.signal });
      this.states.set(id, "stopped");
    } catch (error) {
      this.states.set(id, "failed");
      throw error;
    } finally {
      this.controllers.delete(id);
    }
  }

  private resolveStartOrder(): string[] {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error(`Cyclic engine dependency detected at ${id}`);
      const engine = this.get(id);
      visiting.add(id);
      for (const dependency of engine.dependencies ?? []) {
        this.get(dependency);
        visit(dependency);
      }
      visiting.delete(id);
      visited.add(id);
      order.push(id);
    };

    for (const id of this.engines.keys()) visit(id);
    return order;
  }
}
