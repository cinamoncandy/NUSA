export interface CausalClaim {
  readonly claimId: string;
  readonly statement: string;
  readonly evidenceIds: readonly string[];
}

export interface CausalLink {
  readonly causeId: string;
  readonly effectId: string;
  readonly strength: number;
}

export interface CausalGraph {
  readonly claims: readonly CausalClaim[];
  readonly links: readonly CausalLink[];
  readonly orderedClaimIds: readonly string[];
}

const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);

export const buildCausalGraph = (claims: readonly CausalClaim[], links: readonly CausalLink[]): CausalGraph => {
  const ids = new Set<string>();
  for (const claim of claims) {
    if (!claim.claimId.trim() || !claim.statement.trim()) throw new Error("causal claim identity is required");
    if (ids.has(claim.claimId)) throw new Error(`duplicate causal claim: ${claim.claimId}`);
    ids.add(claim.claimId);
    if (claim.evidenceIds.length === 0) throw new Error("causal claim requires evidence");
  }
  const adjacency = new Map<string, string[]>();
  for (const link of links) {
    if (!ids.has(link.causeId) || !ids.has(link.effectId)) throw new Error("causal link references unknown claim");
    if (link.causeId === link.effectId || !Number.isFinite(link.strength) || link.strength <= 0 || link.strength > 1) throw new Error("causal link is invalid");
    const effects = adjacency.get(link.causeId) ?? [];
    if (effects.includes(link.effectId)) throw new Error("duplicate causal link");
    effects.push(link.effectId);
    adjacency.set(link.causeId, effects);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: string[] = [];
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error("causal cycle detected");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const effect of adjacency.get(id) ?? []) visit(effect);
    visiting.delete(id);
    visited.add(id);
    ordered.unshift(id);
  };
  for (const claim of claims) visit(claim.claimId);
  return freeze({ claims: Object.freeze(claims.map((claim) => freeze({ ...claim, evidenceIds: Object.freeze([...claim.evidenceIds]) }))), links: Object.freeze(links.map((link) => freeze({ ...link }))), orderedClaimIds: Object.freeze(ordered) });
};
