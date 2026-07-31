import { EngineRegistry, ServiceContainer } from "./engineRegistry";

export interface PluginContext {
  readonly engines: EngineRegistry;
  readonly services: ServiceContainer;
}

export interface Plugin {
  readonly id: string;
  readonly version: string;
  readonly dependencies?: readonly string[];
  register(context: PluginContext): void | Promise<void>;
  dispose?(context: PluginContext): void | Promise<void>;
}

export type PluginState = "registered" | "loading" | "loaded" | "disposing" | "disposed" | "failed";

export class PluginSystem {
  private readonly plugins = new Map<string, Plugin>();
  private readonly states = new Map<string, PluginState>();

  constructor(private readonly context: PluginContext) {}

  add(plugin: Plugin): void {
    if (!plugin.id.trim()) throw new Error("Plugin id must not be empty");
    if (!plugin.version.trim()) throw new Error(`Plugin version must not be empty: ${plugin.id}`);
    if (this.plugins.has(plugin.id)) throw new Error(`Plugin already registered: ${plugin.id}`);
    this.plugins.set(plugin.id, plugin);
    this.states.set(plugin.id, "registered");
  }

  state(id: string): PluginState {
    const state = this.states.get(id);
    if (!state) throw new Error(`Plugin not registered: ${id}`);
    return state;
  }

  list(): readonly { id: string; version: string; state: PluginState }[] {
    return [...this.plugins.values()].map((plugin) => ({
      id: plugin.id,
      version: plugin.version,
      state: this.state(plugin.id),
    }));
  }

  async loadAll(): Promise<void> {
    const order = this.resolveOrder();
    const loaded: string[] = [];
    try {
      for (const id of order) {
        await this.load(id);
        loaded.push(id);
      }
    } catch (error) {
      for (const id of loaded.reverse()) {
        try { await this.dispose(id); } catch { /* preserve original load failure */ }
      }
      throw error;
    }
  }

  async disposeAll(): Promise<void> {
    const errors: unknown[] = [];
    for (const id of this.resolveOrder().reverse()) {
      try { await this.dispose(id); } catch (error) { errors.push(error); }
    }
    if (errors.length > 0) throw new AggregateError(errors, "One or more plugins failed to dispose");
  }

  async load(id: string): Promise<void> {
    const plugin = this.get(id);
    const current = this.state(id);
    if (current === "loaded") return;
    if (current === "loading" || current === "disposing") {
      throw new Error(`Plugin ${id} is transitioning: ${current}`);
    }
    for (const dependency of plugin.dependencies ?? []) {
      if (this.state(dependency) !== "loaded") {
        throw new Error(`Plugin ${id} requires loaded dependency ${dependency}`);
      }
    }

    this.states.set(id, "loading");
    try {
      await plugin.register(this.context);
      this.states.set(id, "loaded");
    } catch (error) {
      this.states.set(id, "failed");
      throw error;
    }
  }

  async dispose(id: string): Promise<void> {
    const plugin = this.get(id);
    const current = this.state(id);
    if (current === "registered" || current === "disposed") return;
    if (current === "loading" || current === "disposing") {
      throw new Error(`Plugin ${id} is transitioning: ${current}`);
    }

    this.states.set(id, "disposing");
    try {
      await plugin.dispose?.(this.context);
      this.states.set(id, "disposed");
    } catch (error) {
      this.states.set(id, "failed");
      throw error;
    }
  }

  private get(id: string): Plugin {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`Plugin not registered: ${id}`);
    return plugin;
  }

  private resolveOrder(): string[] {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error(`Cyclic plugin dependency detected at ${id}`);
      const plugin = this.get(id);
      visiting.add(id);
      for (const dependency of plugin.dependencies ?? []) visit(dependency);
      visiting.delete(id);
      visited.add(id);
      order.push(id);
    };

    for (const id of this.plugins.keys()) visit(id);
    return order;
  }
}
