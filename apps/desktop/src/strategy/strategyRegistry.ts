import type { ResearchInterval } from "../cloud/researchDataset";
import type { TradingStrategy } from "./strategyEngine";

export type StrategyRiskProfile = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
export type StrategyLifecycle = "RESEARCH" | "PAPER" | "SHADOW" | "CHALLENGER" | "CHAMPION" | "RETIRED";
export type StrategyGovernanceRole = "RESEARCH" | "CHALLENGER" | "CHAMPION";

export interface StrategyIdentityReference {
  readonly id: string;
  readonly version: string;
  readonly canonicalHash: string;
}

/**
 * Runtime strategy metadata only. Registration does not grant order, risk-policy,
 * credential, LIVE, or production-mutation authority.
 */
export interface StrategyDescriptor {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly markets: readonly string[];
  readonly timeframes: readonly ResearchInterval[];
  readonly riskProfile: StrategyRiskProfile;
  readonly requiredHistory: number;
  readonly lifecycle: StrategyLifecycle;
  /** Optional pointer to config/identity/data-strategy-registry.json. */
  readonly identity?: StrategyIdentityReference;
  readonly tags?: readonly string[];
}

export interface NormalizedStrategyDescriptor extends Omit<StrategyDescriptor, "markets" | "timeframes" | "identity" | "tags"> {
  readonly markets: readonly string[];
  readonly timeframes: readonly ResearchInterval[];
  readonly identity?: Readonly<StrategyIdentityReference>;
  readonly tags: readonly string[];
  /** Stable local identity for deterministic lookups and evidence labels. */
  readonly identityKey: string;
  /** Mirrors the current Champion/Challenger governance vocabulary without promotion authority. */
  readonly governanceRole: StrategyGovernanceRole;
  /** Explicitly records that this registry is not an execution-authority surface. */
  readonly executionAuthority: "NONE";
}

export interface RegisteredStrategy {
  readonly descriptor: Readonly<NormalizedStrategyDescriptor>;
  create(): TradingStrategy;
}

const RISK_PROFILES = new Set<StrategyRiskProfile>(["CONSERVATIVE", "BALANCED", "AGGRESSIVE"]);
const LIFECYCLES = new Set<StrategyLifecycle>(["RESEARCH", "PAPER", "SHADOW", "CHALLENGER", "CHAMPION", "RETIRED"]);
const RESEARCH_INTERVALS = new Set<ResearchInterval>(["1m", "3m", "5m", "10m", "15m", "30m", "60m", "240m", "1d"]);
const SHA256 = /^sha256:[a-f0-9]{64}$/;

const normalizeText = (name: string, value: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
};

const normalizeList = (name: string, values: readonly string[]): readonly string[] => {
  const normalized = [...new Set(values.map((value) => normalizeText(name, value)))].sort((left, right) => left.localeCompare(right));
  if (normalized.length === 0) throw new Error(`${name} requires at least one value`);
  return Object.freeze(normalized);
};

const strategyKey = (id: string, version: string): string => `${id.trim()}@${version.trim()}`;

const governanceRoleFor = (lifecycle: StrategyLifecycle): StrategyGovernanceRole => {
  if (lifecycle === "CHAMPION") return "CHAMPION";
  if (lifecycle === "CHALLENGER") return "CHALLENGER";
  return "RESEARCH";
};

function normalizeIdentity(identity: StrategyIdentityReference | undefined, id: string, version: string): Readonly<StrategyIdentityReference> | undefined {
  if (identity === undefined) return undefined;
  const normalized = Object.freeze({
    id: normalizeText("identity id", identity.id),
    version: normalizeText("identity version", identity.version),
    canonicalHash: normalizeText("identity canonicalHash", identity.canonicalHash)
  });
  if (normalized.id !== id || normalized.version !== version) {
    throw new Error(`strategy identity reference mismatch: expected ${strategyKey(id, version)}, received ${strategyKey(normalized.id, normalized.version)}`);
  }
  if (!SHA256.test(normalized.canonicalHash)) throw new Error("strategy identity canonicalHash must be sha256:<64 lowercase hex>");
  return normalized;
}

function normalizeTimeframes(values: readonly ResearchInterval[]): readonly ResearchInterval[] {
  const normalized = normalizeList("timeframes", values) as readonly ResearchInterval[];
  for (const interval of normalized) {
    if (!RESEARCH_INTERVALS.has(interval)) throw new Error(`unsupported research timeframe: ${interval}`);
  }
  return normalized;
}

function normalizeDescriptor(descriptor: StrategyDescriptor): Readonly<NormalizedStrategyDescriptor> {
  const id = normalizeText("strategy id", descriptor.id);
  const version = normalizeText("strategy version", descriptor.version);
  if (!RISK_PROFILES.has(descriptor.riskProfile)) throw new Error(`unsupported riskProfile: ${String(descriptor.riskProfile)}`);
  if (!LIFECYCLES.has(descriptor.lifecycle)) throw new Error(`unsupported lifecycle: ${String(descriptor.lifecycle)}`);
  if (!Number.isInteger(descriptor.requiredHistory) || descriptor.requiredHistory < 0) {
    throw new Error("requiredHistory must be a non-negative integer");
  }

  return Object.freeze({
    id,
    name: normalizeText("strategy name", descriptor.name),
    version,
    markets: normalizeList("markets", descriptor.markets),
    timeframes: normalizeTimeframes(descriptor.timeframes),
    riskProfile: descriptor.riskProfile,
    requiredHistory: descriptor.requiredHistory,
    lifecycle: descriptor.lifecycle,
    identity: normalizeIdentity(descriptor.identity, id, version),
    tags: Object.freeze([...(descriptor.tags ?? [])].map((tag) => normalizeText("tag", tag)).filter((tag, index, all) => all.indexOf(tag) === index).sort((left, right) => left.localeCompare(right))),
    identityKey: strategyKey(id, version),
    governanceRole: governanceRoleFor(descriptor.lifecycle),
    executionAuthority: "NONE" as const
  });
}

/**
 * Deterministic metadata/factory registry. It deliberately has no promotion, risk,
 * credential, broker, or execution methods; Champion/Challenger labels are descriptive
 * governance metadata only.
 */
export class StrategyRegistry {
  private readonly strategies = new Map<string, RegisteredStrategy>();

  register(registration: { readonly descriptor: StrategyDescriptor; create(): TradingStrategy }): void {
    const descriptor = normalizeDescriptor(registration.descriptor);
    const key = descriptor.identityKey;
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
    if (strategy === undefined) throw new Error(`strategy is not registered: ${strategyKey(id, version)}`);
    return strategy;
  }

  create(id: string, version: string): TradingStrategy {
    return this.require(id, version).create();
  }

  list(): readonly RegisteredStrategy[] {
    return Object.freeze([...this.strategies.values()].sort((left, right) => {
      const idOrder = left.descriptor.id.localeCompare(right.descriptor.id);
      return idOrder !== 0 ? idOrder : left.descriptor.version.localeCompare(right.descriptor.version);
    }));
  }

  findForMarket(market: string, timeframe?: ResearchInterval): readonly RegisteredStrategy[] {
    const normalizedMarket = normalizeText("market", market);
    if (timeframe !== undefined && !RESEARCH_INTERVALS.has(timeframe)) throw new Error(`unsupported research timeframe: ${timeframe}`);
    return Object.freeze(this.list().filter(({ descriptor }) =>
      descriptor.lifecycle !== "RETIRED"
      && descriptor.markets.includes(normalizedMarket)
      && (timeframe === undefined || descriptor.timeframes.includes(timeframe))
    ));
  }

  findByGovernanceRole(role: StrategyGovernanceRole): readonly RegisteredStrategy[] {
    return Object.freeze(this.list().filter(({ descriptor }) => descriptor.lifecycle !== "RETIRED" && descriptor.governanceRole === role));
  }

  size(): number {
    return this.strategies.size;
  }
}
