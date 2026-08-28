import type { RegisteredStrategy, StrategyIdentity, StrategyLifecycle } from "../../../packages/contracts/src/strategyGovernance";

export class StrategyRegistryError extends Error { constructor(readonly code: "INVALID_IDENTITY" | "VERSION_CONFLICT" | "TIME_REGRESSION") { super(code); this.name = "StrategyRegistryError"; } }
const sha40 = /^[a-f0-9]{40}$/; const sha64 = /^[a-f0-9]{64}$/; const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const valid = (value: StrategyIdentity): void => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.strategyId) || !value.name.trim() || !semver.test(value.version) || !sha40.test(value.gitCommitSha) || !sha64.test(value.featureFingerprint) || !value.engineVersion.trim() || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) throw new StrategyRegistryError("INVALID_IDENTITY");
};
const same = (a: StrategyIdentity, b: StrategyIdentity): boolean => JSON.stringify(a) === JSON.stringify(b);
const freeze = (value: RegisteredStrategy): RegisteredStrategy => Object.freeze({ identity: Object.freeze({ ...value.identity }), lifecycle: value.lifecycle });
const compareVersion = (a: string, b: string): number => {
  const [am, an, ap] = a.split("-")[0].split(".").map(Number); const [bm, bn, bp] = b.split("-")[0].split(".").map(Number);
  return am - bm || an - bn || ap - bp || a.localeCompare(b);
};
export class StrategyRegistry {
  private readonly values = new Map<string, RegisteredStrategy>(); private readonly latestCreatedAt = new Map<string, number>();
  registerStrategy(identity: StrategyIdentity, lifecycle: StrategyLifecycle = "DRAFT"): RegisteredStrategy {
    valid(identity); const key = `${identity.strategyId}|${identity.version}`; const existing = this.values.get(key);
    if (existing) { if (!same(existing.identity, identity)) throw new StrategyRegistryError("VERSION_CONFLICT"); return freeze(existing); }
    if ((this.latestCreatedAt.get(identity.strategyId) ?? -1) > identity.createdAt) throw new StrategyRegistryError("TIME_REGRESSION");
    const stored = freeze({ identity: Object.freeze({ ...identity }), lifecycle }); this.values.set(key, stored); this.latestCreatedAt.set(identity.strategyId, identity.createdAt); return freeze(stored);
  }
  getStrategy(strategyId: string, version: string): RegisteredStrategy | undefined { const found = this.values.get(`${strategyId}|${version}`); return found && freeze(found); }
  updateLifecycle(strategyId: string, version: string, lifecycle: StrategyLifecycle): RegisteredStrategy { const current = this.values.get(`${strategyId}|${version}`); if (!current) throw new StrategyRegistryError("INVALID_IDENTITY"); const updated = freeze({ identity: current.identity, lifecycle }); this.values.set(`${strategyId}|${version}`, updated); return freeze(updated); }
  listStrategyVersions(strategyId: string): readonly RegisteredStrategy[] { return Object.freeze([...this.values.values()].filter((v) => v.identity.strategyId === strategyId).sort((a,b) => compareVersion(a.identity.version,b.identity.version)).map(freeze)); }
  getLatestStrategyVersion(strategyId: string): RegisteredStrategy | undefined { const all=this.listStrategyVersions(strategyId); return all[all.length-1]; }
  restore(entries: readonly RegisteredStrategy[]): void { for (const entry of [...entries].sort((a,b) => a.identity.createdAt-b.identity.createdAt || a.identity.strategyId.localeCompare(b.identity.strategyId) || compareVersion(a.identity.version,b.identity.version))) this.registerStrategy(entry.identity, entry.lifecycle); }
}
