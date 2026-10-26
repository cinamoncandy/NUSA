import type { ResearchPrecommit } from "../../contracts/src/researchPrecommit";
import { verifyResearchPrecommit } from "../../contracts/src/researchPrecommit";
import { canonicalResearchJson } from "../../contracts/src/researchRuntime";
import { verifyStrategyReplicationPrecommit, type StrategyReplicationSpec } from "../../contracts/src/researchExternalIntake";
import type { DatabaseSync } from "node:sqlite";

export interface ResearchPrecommitDatabase { readonly connection: DatabaseSync; transaction<T>(fn: () => T): T; }

type StrategyPlan = { readonly strategySpec?: unknown; readonly parentStrategySpec?: unknown; readonly parentStrategyPrecommit?: unknown };
type StrategyPrecommit = ResearchPrecommit & { readonly parameterPlan: StrategyPlan };
type StoredPrecommitRow = { readonly fingerprint: string; readonly payload_json: string; readonly experiment_identity?: string };

function isStrategySpec(value: unknown): value is StrategyReplicationSpec {
  return value != null && typeof value === "object" && "strategyIdentity" in value && "sourceFingerprint" in value && "kind" in value;
}

function isStrategyPrecommit(value: ResearchPrecommit): value is StrategyPrecommit {
  const plan = value.parameterPlan as StrategyPlan | undefined;
  return plan != null && typeof plan === "object" && isStrategySpec(plan.strategySpec);
}

function strategyAuthorityProjection(precommit: ResearchPrecommit): string {
  const plan = precommit.parameterPlan as StrategyPlan;
  const spec = plan.strategySpec as StrategyReplicationSpec;
  const parentPrecommit = plan.parentStrategyPrecommit as ResearchPrecommit | undefined;
  return canonicalResearchJson({
    experimentIdentity: precommit.experimentIdentity,
    candidateIdentity: precommit.candidateIdentity,
    strategyIdentity: precommit.strategyIdentity,
    sourceSha: precommit.sourceSha.toLowerCase(),
    datasetBinding: precommit.datasetBinding,
    costPlan: precommit.costPlan,
    regimePlan: precommit.regimePlan,
    evaluationPlan: precommit.evaluationPlan,
    validationPolicyIdentity: precommit.validationPolicyIdentity,
    // Capture chronology and caller invocation time are provenance, not a new
    // evaluation authority. The stable strategy identity already binds the
    // source bytes and executable rules.
    strategyKind: spec.kind,
    parentExperimentIdentity: parentPrecommit?.experimentIdentity ?? null,
  });
}

export class SqliteResearchPrecommitRepository {
  public constructor(private readonly db: ResearchPrecommitDatabase) {
    db.connection.exec("CREATE TABLE IF NOT EXISTS research_precommits (fingerprint TEXT PRIMARY KEY, experiment_identity TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL)");
  }

  public create(precommit: ResearchPrecommit): ResearchPrecommit {
    verifyResearchPrecommit(precommit);
    return this.db.transaction(() => {
      this.validateStrategyLineage(precommit);
      if (isStrategyPrecommit(precommit)) {
        const existingExperiment = this.findExistingStrategyExperiment(precommit);
        if (existingExperiment != null) return existingExperiment;
      }
      const existing = this.get(precommit.fingerprint);
      if (existing != null && canonicalResearchJson(existing) !== canonicalResearchJson(precommit)) throw new Error("PRECOMMIT_IDENTITY_CONFLICT");
      this.db.connection.prepare("INSERT OR IGNORE INTO research_precommits(fingerprint,experiment_identity,payload_json,created_at) VALUES(?,?,?,?)").run(precommit.fingerprint, precommit.experimentIdentity, JSON.stringify(precommit), precommit.createdAt);
      const stored = this.get(precommit.fingerprint);
      if (stored == null) throw new Error("PRECOMMIT_WRITE_ACK_MISSING");
      return stored;
    });
  }

  public get(fingerprint: string): ResearchPrecommit | null {
    const row = this.db.connection.prepare("SELECT fingerprint, experiment_identity, payload_json FROM research_precommits WHERE fingerprint = ?").get(fingerprint) as StoredPrecommitRow | undefined;
    if (row == null) return null;
    const precommit = JSON.parse(row.payload_json) as ResearchPrecommit;
    verifyResearchPrecommit(precommit);
    if (row.fingerprint !== fingerprint || precommit.fingerprint !== fingerprint) throw new Error("PRECOMMIT_STORAGE_KEY_MISMATCH");
    if (row.experiment_identity !== precommit.experimentIdentity) throw new Error("PRECOMMIT_EXPERIMENT_STORAGE_KEY_MISMATCH");
    this.validateStrategyLineage(precommit);
    return Object.freeze(precommit);
  }

  private validateStrategyLineage(precommit: ResearchPrecommit): void {
    if (!isStrategyPrecommit(precommit)) return;
    const plan = precommit.parameterPlan;
    const spec = plan.strategySpec;
    if (!isStrategySpec(spec)) throw new Error("STRATEGY_PRECOMMIT_SPEC_INVALID");
    const parent = isStrategySpec(plan.parentStrategySpec) ? plan.parentStrategySpec : undefined;
    verifyStrategyReplicationPrecommit(spec, precommit);
    if (spec.kind === "ORIGINAL_STRATEGY") {
      if (parent !== undefined || plan.parentStrategyPrecommit !== undefined || spec.variantOf !== undefined) throw new Error("STRATEGY_ORIGINAL_HAS_PARENT");
      return;
    }
    if (!parent || !spec.variantOf || parent.strategyIdentity !== spec.variantOf || parent.kind !== "ORIGINAL_STRATEGY") throw new Error("STRATEGY_VARIANT_PARENT_REQUIRED");
    const storedParent = this.findPersistedOriginal(spec.variantOf, parent, plan.parentStrategyPrecommit);
    if (storedParent == null) throw new Error("STRATEGY_VARIANT_PARENT_NOT_PERSISTED");
  }

  private findExistingStrategyExperiment(precommit: ResearchPrecommit): ResearchPrecommit | null {
    const rows = this.db.connection.prepare("SELECT fingerprint, experiment_identity, payload_json FROM research_precommits WHERE experiment_identity = ? ORDER BY created_at, fingerprint").all(precommit.experimentIdentity) as StoredPrecommitRow[];
    if (rows.length === 0) return null;
    const expectedProjection = strategyAuthorityProjection(precommit);
    let canonical: ResearchPrecommit | null = null;
    for (const row of rows) {
      if (row.experiment_identity !== precommit.experimentIdentity) throw new Error("PRECOMMIT_EXPERIMENT_IDENTITY_CONFLICT");
      const existing = this.get(row.fingerprint);
      if (existing == null || !isStrategyPrecommit(existing) || strategyAuthorityProjection(existing) !== expectedProjection) throw new Error("PRECOMMIT_EXPERIMENT_IDENTITY_CONFLICT");
      canonical ??= existing;
    }
    return canonical;
  }

  private findPersistedOriginal(strategyIdentity: string, expectedSpec: StrategyReplicationSpec, expectedPrecommit: unknown): ResearchPrecommit | null {
    // Reuse the canonical precommit table; do not add a parallel lineage index/store.
    const rows = this.db.connection.prepare("SELECT fingerprint, payload_json FROM research_precommits WHERE json_extract(payload_json, '$.strategyIdentity') = ? ORDER BY created_at, fingerprint").all(strategyIdentity) as StoredPrecommitRow[];
    for (const row of rows) {
      try {
        const precommit = JSON.parse(row.payload_json) as ResearchPrecommit;
        verifyResearchPrecommit(precommit);
        if (row.fingerprint !== precommit.fingerprint || precommit.strategyIdentity !== strategyIdentity) continue;
        const plan = precommit.parameterPlan as StrategyPlan;
        const spec = plan?.strategySpec;
        if (!isStrategySpec(spec) || spec.kind !== "ORIGINAL_STRATEGY" || spec.strategyIdentity !== strategyIdentity || plan.parentStrategySpec !== undefined) continue;
        verifyStrategyReplicationPrecommit(spec, precommit);
        if (spec.strategyIdentity === expectedSpec.strategyIdentity
          && precommit.fingerprint === (expectedPrecommit as ResearchPrecommit).fingerprint
          && canonicalResearchJson(precommit) === canonicalResearchJson(expectedPrecommit)) return precommit;
      } catch {
        // A malformed historical row cannot establish parent identity.
      }
    }
    return null;
  }
}
