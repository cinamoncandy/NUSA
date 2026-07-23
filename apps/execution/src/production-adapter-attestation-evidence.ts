import { DatabaseSync } from "node:sqlite";
import { attestProductionAdapterAbsence, type ProductionAdapterAttestation, type ProductionAdapterInventory } from "./production-adapter-attestation";

export interface ProductionAdapterAttestationEvidence extends ProductionAdapterAttestation {
  readonly inventory: ProductionAdapterInventory;
}

/**
 * Append-only record of production-adapter-absence attestations.
 *
 * As with credential boundary evidence, the stored artifact is the observed *inventory*, and the
 * ATTESTED/FAILED verdict is derived here rather than accepted from the caller. An ATTESTED record
 * therefore always means the four production adapters were genuinely observed to be absent.
 */
export class SqliteProductionAdapterAttestationRepository {
  public constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS production_adapter_attestation_evidence (
        attestation_id TEXT PRIMARY KEY,
        production_exchange_adapter INTEGER NOT NULL,
        live_trading_executor INTEGER NOT NULL,
        real_order_submitter INTEGER NOT NULL,
        capital_movement_adapter INTEGER NOT NULL,
        decision TEXT NOT NULL,
        blockers_json TEXT NOT NULL,
        evaluated_at_ms INTEGER NOT NULL,
        production_mutation_allowed INTEGER NOT NULL CHECK (production_mutation_allowed = 0)
      );
    `);
  }

  public append(args: { readonly attestationId: string; readonly inventory: ProductionAdapterInventory; readonly nowMs: number }): ProductionAdapterAttestationEvidence {
    if (this.get(args.attestationId)) throw new Error("duplicate production adapter attestation id");
    const attestation = attestProductionAdapterAbsence({ attestationId: args.attestationId, inventory: args.inventory, nowMs: args.nowMs });
    this.db
      .prepare("INSERT INTO production_adapter_attestation_evidence (attestation_id, production_exchange_adapter, live_trading_executor, real_order_submitter, capital_movement_adapter, decision, blockers_json, evaluated_at_ms, production_mutation_allowed) VALUES (?,?,?,?,?,?,?,?,0)")
      .run(args.attestationId, args.inventory.productionExchangeAdapter ? 1 : 0, args.inventory.liveTradingExecutor ? 1 : 0, args.inventory.realOrderSubmitter ? 1 : 0, args.inventory.capitalMovementAdapter ? 1 : 0, attestation.decision, JSON.stringify(attestation.blockers), args.nowMs);
    return this.get(args.attestationId)!;
  }

  public get(attestationId: string): ProductionAdapterAttestationEvidence | undefined {
    const row = this.db.prepare("SELECT * FROM production_adapter_attestation_evidence WHERE attestation_id = ?").get(attestationId) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    if (Number(row.production_mutation_allowed) !== 0) throw new Error("persisted Production mutation authorization rejected");
    const inventory: ProductionAdapterInventory = Object.freeze({
      productionExchangeAdapter: Number(row.production_exchange_adapter) === 1,
      liveTradingExecutor: Number(row.live_trading_executor) === 1,
      realOrderSubmitter: Number(row.real_order_submitter) === 1,
      capitalMovementAdapter: Number(row.capital_movement_adapter) === 1
    });
    const rederived = attestProductionAdapterAbsence({ attestationId: String(row.attestation_id), inventory, nowMs: Number(row.evaluated_at_ms) });
    if (rederived.decision !== String(row.decision)) throw new Error("persisted attestation verdict does not match its recorded inventory");
    return Object.freeze({ ...rederived, inventory });
  }
}
