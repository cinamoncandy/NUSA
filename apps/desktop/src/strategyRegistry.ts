import type { TradingStrategy } from "./strategyEngine";

export type StrategyRiskProfile = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
export type StrategyLifecycle = "RESEARCH" | "PAPER" | "SHADOW" | "CHALLENGER" | "CHAMPION" | "RETIRED";

export interface StrategyDescriptor {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly markets: readonly string[];
  readonly timeframes: readonly string[];
  readonly riskProfile: StrategyRiskProfile;
  readonly requiredHistory: number;
  readonly lifecycle: StrategyLifecycle;
  readonly tags?: readonly string[];
}

export interface RegisteredStrategy {
  readonly descriptor: Readonly<StrategyDescriptor>;
  create(): TradingStrategy;
}

const normalizeText = (name: string, value: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
};

const normalizeList = (name: string, values: readonly string[]): readonly string[] => {
  const normalized = [...new Set(values.map((value) => normalizeText(name, value)))].sort((a, b) => a.localeCompare(b));
  if (normalized.length === 0) throw new Error(`${name} requires at least one value`);
  return Object.freeze(normalized);
};

function normalizeDescriptor(descriptor: StrategyDescriptor): Readonly<StrategyDescriptor> {
  if (!Number.isInteger(descriptor.requiredHistory) || descriptor.requiredHistory < 0) {
    throw new Error("requiredHistory must be a non-negative integer");
  }

  return Object.freeze({
    id: normalizeText("strategy id", descriptor.id),
    name: normalizeText("strategy name", descriptor.name),
    version: normalizeText("strategy version", descriptor.version),
    markets: normalizeList("markets", descriptor.markets),
    timeframes: normalizeList("timeframes", descriptor.timeframes),
    riskProfile: descriptor.riskProfile,
    requiredHistory: descriptor.requiredHistory,
    lifecycle: descriptor.lifecycle,
    tags: Object.freeze([...(descriptor.tags ?? [])].map((tag) => normalizeText("tag", tag)).sort((a, b) => a.localeCompare(b)))
  });
}

function strategyKey(id: string, version: string): string {
  return `${id.trim()}@${version.trim()}`;
}

export class StrategyRegistry {
  private readonly strategies = new Map<string, RegisteredStrategy>();

  register(registration: RegisteredStrategy): void {
    const descriptor = normalizeDescriptor(registration.descriptor);
    const key = strategyKey(descriptor.id, descriptor.version);
    if (this.strategies.has(key)) throw new Error(`strategy already registered: ${key}`);

    const created = registration.create();
    if (created.id !== descriptor.id) {
      throw new Error(`strategy factory id mismatch: expected ${descriptor.id}, received ${created.id}`);
    }

    this.strategies.set(key, Object.freeze({ descriptor, create: registration.create }));
  }

  get(id: string, version: string): RegisteredStrategy | undefined {
    return this.strategies.get(strategyKey(id, version));
  }

  require(id: string, version: string): RegisteredStrategy {
    const strategy = this.get(id, version);
    if (!strategy) throw new Error(`strategy is not registered: ${strategyKey(id, version)}`);
    return strategy;
  }

  create(id: string, version: string): TradingStrategy {
    return this.require(id, version).create();
  }

  list(): readonly RegisteredStrategy[] {
    return Object.freeze(
      [...this.strategies.values()].sort((left, right) => {
        const idOrder = left.descriptor.id.localeCompare(right.descriptor.id);
        return idOrder !== 0 ? idOrder : left.descriptor.version.localeCompare(right.descriptor.version);
      })
    );
  }

  findForMarket(market: string, timeframe?: string): readonly RegisteredStrategy[] {
    const normalizedMarket = normalizeText("market", market);
    const normalizedTimeframe = timeframe == null ? undefined : normalizeText("timeframe", timeframe);
    return Object.freeze(
      this.list().filter(({ descriptor }) =>
        descriptor.markets.includes(normalizedMarket)
        && (normalizedTimeframe == null || descriptor.timeframes.includes(normalizedTimeframe))
        && descriptor.lifecycle !== "RETIRED"
      )
    );
  }

  size(): number {
    return this.strategies.size;
  }
}
