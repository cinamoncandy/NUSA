import { GENESIS_SEAL_HASH, type EvidenceGraphHashSeal } from "../../../apps/execution/src/evidence-graph-seal";
import type { EvidenceGraphSealRepository } from "../../../apps/execution/src/evidence-graph-seal-repository";
import type { SqliteDatabase } from "./index";

type SqlRow = Record<string, string | number | bigint | null>;

function decode(row: SqlRow): EvidenceGraphHashSeal {
  return Object.freeze({
    sealId: String(row.seal_id),
    candidateId: String(row.candidate_id),
    graphHash: String(row.graph_hash),
    previousSealHash: String(row.previous_seal_hash),
    chainHash: String(row.chain_hash),
    nodeCount: Number(row.node_count),
    edgeCount: Number(row.edge_count),
    sealedAtMs: Number(row.sealed_at_ms),
    deploymentAllowed: false,
    productionMutationAllowed: false
  });
}

/**
 * Append-only, chain-linked persistence for evidence graph seals. Every row is a permanent
 * audit record: there is no update or delete path, previous_seal_hash/chain_hash are unique so
 * the chain cannot fork or be replayed out of order, and seq is a monotonically assigned append
 * position so history can always be walked in the order it was actually written.
 */
export class SqliteEvidenceGraphSealRepository implements EvidenceGraphSealRepository {
  public constructor(private readonly db: SqliteDatabase) {
    db.connection.exec(`
      CREATE TABLE IF NOT EXISTS evidence_graph_seals (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        seal_id TEXT NOT NULL UNIQUE,
        candidate_id TEXT NOT NULL,
        graph_hash TEXT NOT NULL,
        previous_seal_hash TEXT NOT NULL,
        chain_hash TEXT NOT NULL UNIQUE,
        node_count INTEGER NOT NULL,
        edge_count INTEGER NOT NULL,
        sealed_at_ms INTEGER NOT NULL,
        deployment_allowed INTEGER NOT NULL CHECK (deployment_allowed = 0),
        production_mutation_allowed INTEGER NOT NULL CHECK (production_mutation_allowed = 0)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_graph_seals_previous ON evidence_graph_seals (previous_seal_hash);
    `);
  }

  appendSeal(seal: EvidenceGraphHashSeal): void {
    const expectedPrevious = this.getLatestSeal()?.chainHash ?? GENESIS_SEAL_HASH;
    if (seal.previousSealHash !== expectedPrevious) throw new Error("evidence graph seal does not chain to latest seal");
    if (seal.deploymentAllowed !== false || seal.productionMutationAllowed !== false) throw new Error("evidence graph seal must never assert deployment or production authority");
    this.db.connection
      .prepare("INSERT INTO evidence_graph_seals (seal_id, candidate_id, graph_hash, previous_seal_hash, chain_hash, node_count, edge_count, sealed_at_ms, deployment_allowed, production_mutation_allowed) VALUES (?,?,?,?,?,?,?,?,0,0)")
      .run(seal.sealId, seal.candidateId, seal.graphHash, seal.previousSealHash, seal.chainHash, seal.nodeCount, seal.edgeCount, seal.sealedAtMs);
  }

  getSeal(sealId: string): EvidenceGraphHashSeal | undefined {
    const row = this.db.connection.prepare("SELECT * FROM evidence_graph_seals WHERE seal_id = ?").get(sealId) as SqlRow | undefined;
    return row === undefined ? undefined : decode(row);
  }

  listChain(): readonly EvidenceGraphHashSeal[] {
    const rows = this.db.connection.prepare("SELECT * FROM evidence_graph_seals ORDER BY seq ASC").all() as SqlRow[];
    return Object.freeze(rows.map(decode));
  }

  getLatestSeal(): EvidenceGraphHashSeal | undefined {
    const row = this.db.connection.prepare("SELECT * FROM evidence_graph_seals ORDER BY seq DESC LIMIT 1").get() as SqlRow | undefined;
    return row === undefined ? undefined : decode(row);
  }
}
