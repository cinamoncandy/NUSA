export type EngineLifecycle = "REGISTERED" | "ACTIVE" | "DISABLED";

export interface EngineDefinition {
  readonly engineId: string;
  readonly version: string;
  readonly lifecycle: EngineLifecycle;
  readonly capabilities: readonly string[];
}

export interface PluginDefinition {
  readonly pluginId: string;
  readonly version: string;
  readonly engineIds: readonly string[];
}

const freeze = <T extends object>(value: T): Readonly<T> => {
  Object.freeze(value);
  return value;
};

const required = (value: string, field: string): void => {
  if (!value.trim()) throw new Error(`${field} is required`);
}

const unique = (values: readonly string[], field: string): void => {
  if (new Set(values).size !== values.length) throw new Error(`${field} must be unique`);
}

export class DependencyContainer {
  private readonly values = new Map<string, unknown>();

  set<T>(key: string, value: T): void {
    required(key, "dependency key");
    if (this.values.has(key)) throw new Error(`dependency already registered: ${key}`);
    this.values.set(key, value);
  }

  get<T>(key: string): T {
    if (!this.values.has(key)) throw new Error(`dependency not found: ${key}`);
    return this.values.get(key) as T;
  }

  has(key: string): boolean { return this.values.has(key); }
}

export class EngineRegistry {
  private readonly engines = new Map<string, Readonly<EngineDefinition>>();

  register(definition: EngineDefinition): Readonly<EngineDefinition> {
    required(definition.engineId, "engineId");
    required(definition.version, "engine version");
    unique(definition.capabilities, "engine capabilities");
    const key = `${definition.engineId}@${definition.version}`;
    if (this.engines.has(key)) throw new Error(`engine already registered: ${key}`);
    const frozen = freeze({ ...definition, capabilities: Object.freeze([...definition.capabilities]) });
    this.engines.set(key, frozen);
    return frozen;
  }

  get(engineId: string, version: string): Readonly<EngineDefinition> {
    const engine = this.engines.get(`${engineId}@${version}`);
    if (!engine) throw new Error(`engine not found: ${engineId}@${version}`);
    return engine;
  }

  list(): readonly Readonly<EngineDefinition>[] { return Object.freeze([...this.engines.values()]); }
}

export class PluginRegistry {
  private readonly plugins = new Map<string, Readonly<PluginDefinition>>();

  register(definition: PluginDefinition, engines: EngineRegistry): Readonly<PluginDefinition> {
    required(definition.pluginId, "pluginId");
    required(definition.version, "plugin version");
    unique(definition.engineIds, "plugin engines");
    for (const engineId of definition.engineIds) {
      if (!engines.list().some((engine) => engine.engineId === engineId)) throw new Error(`plugin engine not found: ${engineId}`);
    }
    const key = `${definition.pluginId}@${definition.version}`;
    if (this.plugins.has(key)) throw new Error(`plugin already registered: ${key}`);
    const frozen = freeze({ ...definition, engineIds: Object.freeze([...definition.engineIds]) });
    this.plugins.set(key, frozen);
    return frozen;
  }

  list(): readonly Readonly<PluginDefinition>[] { return Object.freeze([...this.plugins.values()]); }
}
