import { createHash } from "node:crypto";

export type StrategyFamilyLifecycle = "DISCOVERY" | "RESEARCHING" | "VALIDATED" | "ACTIVE" | "DEGRADED" | "SUSPENDED" | "RETIRED";
export type StrategyFamilyMemberRole = "CHAMPION" | "CHALLENGER" | "RESEARCH_CANDIDATE";

export interface StrategyFamilyDefinition {
  readonly familyId: string;
  readonly name: string;
  readonly category: string;
  readonly thesis: string;
  readonly lifecycle: StrategyFamilyLifecycle;
}

export interface StrategyFamilyMember {
  readonly strategyId: string;
  readonly version: string;
  readonly familyId: string;
  readonly role: StrategyFamilyMemberRole;
}

export interface RegisteredStrategyFamily extends StrategyFamilyDefinition {
  readonly fingerprint: string;
  readonly members: readonly StrategyFamilyMember[];
}

export class StrategyFamilyRegistryError extends Error {
  constructor(readonly code: "INVALID_FAMILY" | "DUPLICATE_FAMILY" | "UNKNOWN_FAMILY" | "MEMBER_CONFLICT" | "CHAMPION_CONFLICT") {
    super(code); this.name = "StrategyFamilyRegistryError";
  }
}

const FAMILY_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const STRATEGY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
};
const fingerprint = (definition: StrategyFamilyDefinition): string =>
  createHash("sha256").update(canonical(definition)).digest("hex");

const validateDefinition = (value: StrategyFamilyDefinition): void => {
  if (!FAMILY_ID.test(value.familyId) || !value.name.trim() || !value.category.trim() || !value.thesis.trim()) throw new StrategyFamilyRegistryError("INVALID_FAMILY");
  if (!new Set<StrategyFamilyLifecycle>(["DISCOVERY","RESEARCHING","VALIDATED","ACTIVE","DEGRADED","SUSPENDED","RETIRED"]).has(value.lifecycle)) throw new StrategyFamilyRegistryError("INVALID_FAMILY");
};
const validateMember = (value: StrategyFamilyMember): void => {
  if (!STRATEGY_ID.test(value.strategyId) || !VERSION.test(value.version) || !FAMILY_ID.test(value.familyId)) throw new StrategyFamilyRegistryError("MEMBER_CONFLICT");
  if (!new Set<StrategyFamilyMemberRole>(["CHAMPION","CHALLENGER","RESEARCH_CANDIDATE"]).has(value.role)) throw new StrategyFamilyRegistryError("MEMBER_CONFLICT");
};
const freezeMember = (m: StrategyFamilyMember): StrategyFamilyMember => Object.freeze({ ...m });
const freezeFamily = (d: StrategyFamilyDefinition, members: readonly StrategyFamilyMember[]): RegisteredStrategyFamily =>
  Object.freeze({ ...d, fingerprint: fingerprint(d), members: Object.freeze(members.map(freezeMember)) });

export class StrategyFamilyRegistry {
  private readonly families = new Map<string, StrategyFamilyDefinition>();
  private readonly members = new Map<string, StrategyFamilyMember>();

  registerFamily(definition: StrategyFamilyDefinition): RegisteredStrategyFamily {
    validateDefinition(definition);
    if (this.families.has(definition.familyId)) throw new StrategyFamilyRegistryError("DUPLICATE_FAMILY");
    this.families.set(definition.familyId, Object.freeze({ ...definition }));
    return this.getFamily(definition.familyId)!;
  }

  getFamily(familyId: string): RegisteredStrategyFamily | undefined {
    const d = this.families.get(familyId); if (!d) return undefined;
    const members = [...this.members.values()].filter(m => m.familyId === familyId)
      .sort((a,b) => a.strategyId.localeCompare(b.strategyId) || a.version.localeCompare(b.version));
    return freezeFamily(d, members);
  }

  listFamilies(): readonly RegisteredStrategyFamily[] {
    return Object.freeze([...this.families.keys()].sort().map(id => this.getFamily(id)!));
  }

  registerMember(member: StrategyFamilyMember): StrategyFamilyMember {
    validateMember(member);
    if (!this.families.has(member.familyId)) throw new StrategyFamilyRegistryError("UNKNOWN_FAMILY");
    const key = `${member.strategyId}|${member.version}`;
    const existing = this.members.get(key);
    if (existing) {
      if (canonical(existing) !== canonical(member)) throw new StrategyFamilyRegistryError("MEMBER_CONFLICT");
      return freezeMember(existing);
    }
    if (member.role === "CHAMPION" && [...this.members.values()].some(m => m.familyId === member.familyId && m.role === "CHAMPION")) {
      throw new StrategyFamilyRegistryError("CHAMPION_CONFLICT");
    }
    const stored = freezeMember(member); this.members.set(key, stored); return freezeMember(stored);
  }

  getMember(strategyId: string, version: string): StrategyFamilyMember | undefined {
    const found = this.members.get(`${strategyId}|${version}`); return found && freezeMember(found);
  }

  requireMembership(strategyId: string, version: string, familyId: string): StrategyFamilyMember {
    if (!this.families.has(familyId)) throw new StrategyFamilyRegistryError("UNKNOWN_FAMILY");
    const member = this.getMember(strategyId, version);
    if (!member || member.familyId !== familyId) throw new StrategyFamilyRegistryError("MEMBER_CONFLICT");
    return member;
  }

  restore(families: readonly StrategyFamilyDefinition[], members: readonly StrategyFamilyMember[]): void {
    for (const family of [...families].sort((a,b) => a.familyId.localeCompare(b.familyId))) this.registerFamily(family);
    for (const member of [...members].sort((a,b) => a.familyId.localeCompare(b.familyId) || a.strategyId.localeCompare(b.strategyId) || a.version.localeCompare(b.version))) this.registerMember(member);
  }
}

export const CANONICAL_INDEPENDENT_ALPHA_FAMILIES = Object.freeze([
  Object.freeze({ familyId: "derivatives.funding-persistence", name: "Funding Persistence Mean Reversion", category: "DERIVATIVES", thesis: "Persistent extreme funding, confirmed by open interest and bounded basis, may mean-revert after costs.", lifecycle: "RESEARCHING" as const }),
  Object.freeze({ familyId: "microstructure.orderbook-imbalance", name: "Orderbook Imbalance", category: "MICROSTRUCTURE", thesis: "Persistent executable order-book pressure and microprice displacement may contain short-horizon directional information after costs.", lifecycle: "RESEARCHING" as const })
]);
