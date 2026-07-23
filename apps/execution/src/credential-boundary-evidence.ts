import { DatabaseSync } from "node:sqlite";
import { evaluateCredentialBoundary, type CredentialBoundaryInput, type CredentialBoundaryResult } from "./credential-boundary";

export interface CredentialBoundaryEvidence extends CredentialBoundaryResult {
  readonly evaluationId: string;
  readonly input: CredentialBoundaryInput;
  readonly evaluatedAtMs: number;
}

/**
 * Append-only record of credential boundary evaluations.
 *
 * This repository deliberately stores the *inputs* and derives the verdict itself by calling
 * evaluateCredentialBoundary, rather than accepting a caller-supplied CredentialBoundaryResult.
 * A caller therefore cannot record a BLOCK verdict for an environment that would not actually
 * have been blocked: the only way to get a persisted BLOCK is for the real evaluator to have
 * produced one from real inputs.
 */
export class SqliteCredentialBoundaryEvidenceRepository {
  public constructor(private readonly db: DatabaseSync) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS credential_boundary_evidence (
        evaluation_id TEXT PRIMARY KEY,
        environment TEXT NOT NULL,
        endpoint TEXT,
        api_key_present INTEGER NOT NULL,
        api_secret_present INTEGER NOT NULL,
        account_identifier TEXT,
        decision TEXT NOT NULL,
        blockers_json TEXT NOT NULL,
        evaluated_at_ms INTEGER NOT NULL,
        production_mutation_allowed INTEGER NOT NULL CHECK (production_mutation_allowed = 0)
      );
    `);
  }

  public append(args: { readonly evaluationId: string; readonly input: CredentialBoundaryInput; readonly nowMs: number }): CredentialBoundaryEvidence {
    if (!args.evaluationId.trim() || !Number.isSafeInteger(args.nowMs) || args.nowMs < 0) throw new Error("valid credential boundary evaluation identity and time are required");
    if (this.get(args.evaluationId)) throw new Error("duplicate credential boundary evidence id");
    const result = evaluateCredentialBoundary(args.input);
    this.db
      .prepare("INSERT INTO credential_boundary_evidence (evaluation_id, environment, endpoint, api_key_present, api_secret_present, account_identifier, decision, blockers_json, evaluated_at_ms, production_mutation_allowed) VALUES (?,?,?,?,?,?,?,?,?,0)")
      .run(args.evaluationId, args.input.environment, args.input.endpoint ?? null, args.input.apiKeyPresent ? 1 : 0, args.input.apiSecretPresent ? 1 : 0, args.input.accountIdentifier ?? null, result.decision, JSON.stringify(result.blockers), args.nowMs);
    return this.get(args.evaluationId)!;
  }

  public get(evaluationId: string): CredentialBoundaryEvidence | undefined {
    const row = this.db.prepare("SELECT * FROM credential_boundary_evidence WHERE evaluation_id = ?").get(evaluationId) as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    if (Number(row.production_mutation_allowed) !== 0) throw new Error("persisted Production mutation authorization rejected");
    const input: CredentialBoundaryInput = Object.freeze({
      environment: String(row.environment) as CredentialBoundaryInput["environment"],
      ...(row.endpoint == null ? {} : { endpoint: String(row.endpoint) }),
      apiKeyPresent: Number(row.api_key_present) === 1,
      apiSecretPresent: Number(row.api_secret_present) === 1,
      ...(row.account_identifier == null ? {} : { accountIdentifier: String(row.account_identifier) })
    });
    // Re-derive on read as well: a row edited directly in the database cannot silently change the verdict.
    const rederived = evaluateCredentialBoundary(input);
    if (rederived.decision !== String(row.decision)) throw new Error("persisted credential boundary verdict does not match its recorded inputs");
    return Object.freeze({ evaluationId: String(row.evaluation_id), input, decision: rederived.decision, productionMutationAllowed: false, blockers: rederived.blockers, evaluatedAtMs: Number(row.evaluated_at_ms) });
  }
}
