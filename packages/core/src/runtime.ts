import { EngineRegistry, ServiceContainer } from "./engineRegistry";
import { EventBus, EventMap } from "./eventBus";
import { PluginSystem } from "./pluginSystem";

export interface RuntimeOptions<Events extends EventMap> {
  readonly services?: ServiceContainer;
  readonly eventBus?: EventBus<Events>;
}

export class NusaRuntime<Events extends EventMap = EventMap> {
  readonly services: ServiceContainer;
  readonly events: EventBus<Events>;
  readonly engines: EngineRegistry;
  readonly plugins: PluginSystem;

  private started = false;

  constructor(options: RuntimeOptions<Events> = {}) {
    this.services = options.services ?? new ServiceContainer();
    this.events = options.eventBus ?? new EventBus<Events>();
    this.engines = new EngineRegistry(this.services);
    this.plugins = new PluginSystem({ engines: this.engines, services: this.services });

    this.services.register("core.runtime", this);
    this.services.register("core.events", this.events);
    this.services.register("core.engines", this.engines);
    this.services.register("core.plugins", this.plugins);
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.plugins.loadAll();
    try {
      await this.engines.startAll();
      this.started = true;
    } catch (error) {
      await this.plugins.disposeAll().catch(() => undefined);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    const errors: unknown[] = [];
    try { await this.engines.stopAll(); } catch (error) { errors.push(error); }
    try { await this.plugins.disposeAll(); } catch (error) { errors.push(error); }
    this.events.clear();
    this.started = false;
    if (errors.length > 0) throw new AggregateError(errors, "NUSA runtime shutdown failed");
  }

  isStarted(): boolean {
    return this.started;
  }
}
