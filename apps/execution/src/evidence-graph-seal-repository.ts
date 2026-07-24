import { GENESIS_SEAL_HASH, type EvidenceGraphHashSeal } from "./evidence-graph-seal";

export interface EvidenceGraphSealRepository {
  /** Appends a seal. Must be append-only: rejects re-use of a sealId and rejects any seal whose
   * previousSealHash does not equal the chainHash of the current latest seal (or GENESIS for the
   * very first seal ever appended). This is what makes the persisted history a real chain rather
   * than a bag of independently-verifiable but reorderable records. */
  appendSeal(seal: EvidenceGraphHashSeal): void;
  getSeal(sealId: string): EvidenceGraphHashSeal | undefined;
  /** Full seal history in append order, across all candidates. */
  listChain(): readonly EvidenceGraphHashSeal[];
  /** Most recently appended seal, if any. */
  getLatestSeal(): EvidenceGraphHashSeal | undefined;
}

export class InMemoryEvidenceGraphSealRepository implements EvidenceGraphSealRepository {
  private readonly seals = new Map<string, EvidenceGraphHashSeal>();
  private readonly order: string[] = [];

  appendSeal(seal: EvidenceGraphHashSeal): void {
    if (this.seals.has(seal.sealId)) throw new Error("evidence graph seal already exists");
    const expectedPrevious = this.getLatestSeal()?.chainHash ?? GENESIS_SEAL_HASH;
    if (seal.previousSealHash !== expectedPrevious) throw new Error("evidence graph seal does not chain to latest seal");
    if (seal.deploymentAllowed !== false || seal.productionMutationAllowed !== false) throw new Error("evidence graph seal must never assert deployment or production authority");
    this.seals.set(seal.sealId, Object.freeze({ ...seal }));
    this.order.push(seal.sealId);
  }

  getSeal(sealId: string): EvidenceGraphHashSeal | undefined { return this.seals.get(sealId); }
  listChain(): readonly EvidenceGraphHashSeal[] { return Object.freeze(this.order.map(id => this.seals.get(id)!)); }
  getLatestSeal(): EvidenceGraphHashSeal | undefined {
    const lastId = this.order[this.order.length - 1];
    return lastId === undefined ? undefined : this.seals.get(lastId);
  }
}
