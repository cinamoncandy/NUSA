import type { SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import type { HoldoutKey } from "../../../packages/storage/src/researchHoldoutLedger";
import { buildLearningInputSet, type LearningInputSet, type LearningInputSetInput } from "./learningInputSet";
import { LearningInputSetLedger, type LearningInputSetReceipt } from "./learningInputSetLedger";
import { buildLearningDecision, learningDecisionFingerprint, type LearningDecisionInput } from "./learningDecision";
import { LearningDecisionLedger, type LearningDecisionReceipt } from "./learningDecisionLedger";
import { applyBoundedChange, ApplicationRegistry, type ApplicationPorts, type ApplicationContext, type MetaOosEligibility } from "./learningApplication";
import { LearningApplicationLedger, type LearningApplicationDurableReceipt } from "./learningApplicationLedger";
import { MetaOosLedger, type MetaOosDurableReceipt } from "./metaOosLedger";
import type { HoldoutClaimPort, MetaPartition } from "./metaOos";
import { buildLearningLoopStatus, type LearningLoopStatus } from "./learningLoopStatus";

/**
 * Step 12 - the integrated learning chain.
 *
 * Everything from A2 through M2 has so far existed as a correct piece on its own, which is not the
 * same as being connected. This is the single orchestration that makes the two evidence lanes
 * actually meet: research evidence and PAPER evidence are carried separately everywhere else, and
 * joined here, once, inside the learning input set. Everything downstream - the decision, the
 * meta-out-of-sample partition, the bounded application - is derived from that joined set and nothing
 * else.
 *
 * The construction enforces reuse rather than merely documenting it. One `EvolutionLedgerPort` is
 * passed in and every ledger is built from it, so there is no second scheduler, evidence store, or
 * holdout truth source to reach for: the four ledgers are views over one append-only, hash-chained
 * history, discriminated by identity prefix. The holdout claim is delegated to the caller's existing
 * holdout ledger for the same reason.
 *
 * Exactly-once is re-established on construction rather than assumed. The application registry is
 * hydrated from durable application history before anything can be applied, so a process that
 * restarts mid-cycle does not re-run a change it already made; replaying an already-recorded decision
 * returns the identical receipt without reaching the setter again.
 *
 * The chain is fail-closed by ordering. Meta-out-of-sample eligibility is derived from *recorded
 * assignments only*, so a cycle with no completed partitions behind it produces a refusal rather than
 * a change, and a refusal is still a durable, reported outcome (v2 sections 12, 50).
 */

type EvolutionLedgerPort = Pick<SqliteEvolutionLearningLedger, "append" | "list">;

type LearningPolicyIdentity = LearningInputSetInput["policies"];
type LearningEvidenceReference = LearningInputSetInput["researchEvidence"][number];
type LearningChangeRequest = LearningDecisionInput["proposedChanges"][number];
type DecisionMetaPartition = LearningDecisionInput["metaOosPartition"];

export class LearningChainError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "LearningChainError";
  }
}

export interface LearningChainCycle {
  /** Point-in-time boundary for both lanes. */
  readonly cutoffTimestamp: number;
  readonly researchEvidence: readonly LearningEvidenceReference[];
  readonly paperEvidence: readonly LearningEvidenceReference[];
  readonly policies: LearningPolicyIdentity;
  readonly metaPartitionIdentity: string;
  readonly previousResearchSpecFingerprint: string;
  readonly objectiveVersion: string;
  readonly proposedChanges: readonly LearningChangeRequest[];
  readonly reasonEvidence: readonly string[];
  readonly metaPartition: MetaPartition;
  readonly createdAt: string;
  readonly sourceCommit: string;
  readonly runtimeIdentity: string;
  /** Required when the chosen partition is `meta-holdout`; consumed through the shared holdout ledger. */
  readonly holdoutKey?: HoldoutKey;
  readonly holdoutEvaluationId?: string;
}

export interface LearningChainResult {
  readonly cycleId: string;
  readonly inputSetReceipt: LearningInputSetReceipt;
  readonly decisionReceipt: LearningDecisionReceipt;
  readonly metaOosReceipt: MetaOosDurableReceipt;
  readonly eligibility: MetaOosEligibility;
  readonly applicationReceipt: LearningApplicationDurableReceipt;
  readonly status: LearningLoopStatus;
}

/**
 * The integrated chain over one canonical history.
 *
 * There is deliberately no second instance available: constructing two of these would give two
 * independent application registries over the same durable history, and the second would not know
 * what the first already applied. One chain, one store, one registry, rehydrated on construction.
 */
export class ClosedLearningChain {
  private readonly inputSets: LearningInputSetLedger;
  private readonly decisions: LearningDecisionLedger;
  private readonly applications: LearningApplicationLedger;
  private readonly metaOos: MetaOosLedger;
  private readonly registry = new ApplicationRegistry();

  public constructor(evolution: EvolutionLedgerPort, private readonly holdouts: HoldoutClaimPort, now: () => number = Date.now) {
    if (evolution == null || typeof evolution.append !== "function" || typeof evolution.list !== "function") throw new LearningChainError("STORE_REQUIRED", "the integrated chain requires the canonical evolution ledger");
    if (holdouts == null || typeof holdouts.claim !== "function" || typeof holdouts.isUsed !== "function") throw new LearningChainError("STORE_REQUIRED", "the integrated chain requires the canonical holdout ledger");
    this.inputSets = new LearningInputSetLedger(evolution, now);
    this.decisions = new LearningDecisionLedger(evolution, now);
    this.applications = new LearningApplicationLedger(evolution, now);
    this.metaOos = new MetaOosLedger(evolution, now);
    // Restore exactly-once from durable history before any application can be attempted, so a restart
    // mid-cycle cannot re-run a change that already happened.
    this.applications.hydrate(this.registry);
  }

  private buildInputSet(cycle: LearningChainCycle): LearningInputSet {
    return buildLearningInputSet({
      cutoffTimestamp: cycle.cutoffTimestamp,
      researchEvidence: cycle.researchEvidence,
      paperEvidence: cycle.paperEvidence,
      policies: cycle.policies,
      metaPartitionIdentity: cycle.metaPartitionIdentity,
    });
  }

  /**
   * Runs the full chain for one cycle and returns every receipt it produced.
   *
   * Order is fixed and load-bearing: the input set joins the lanes, the decision is derived from that
   * joined set, the partition is assigned and claimed, eligibility is read back from recorded
   * assignments only, and only then may a bounded change be attempted. A failure at any step leaves
   * the earlier receipts durable and the later steps unattempted.
   */
  public run(cycle: LearningChainCycle, applicationPorts: ApplicationPorts): LearningChainResult {
    if (cycle == null || typeof cycle !== "object") throw new LearningChainError("MALFORMED_CYCLE", "a learning cycle is required");

    // A2: the one place the two evidence lanes are joined.
    const inputSet = this.buildInputSet(cycle);
    const inputSetReceipt = this.inputSets.append(inputSet);

    // A1: the decision is derived from the joined set. Its meta-cycle count is taken from *other*
    // cycles in this partition, so a decision can never cite its own partition as the evidence
    // backing it - that would be the decision vouching for itself. Excluding this cycle by identity
    // rather than by time is also what makes replay stable: this cycle's own assignment, once
    // durable, must not change the count the decision was recorded with.
    const priorCycles = this.metaOos.assignments().filter((assignment) => assignment.partition === cycle.metaPartition && assignment.learningCycleId !== inputSetReceipt.learningCycleId).length;
    const decision = buildLearningDecision({
      inputSet,
      previousResearchSpecFingerprint: cycle.previousResearchSpecFingerprint,
      objectiveVersion: cycle.objectiveVersion,
      proposedChanges: cycle.proposedChanges,
      reasonEvidence: cycle.reasonEvidence,
      metaOosPartition: cycle.metaPartition as DecisionMetaPartition,
      metaCyclesEvaluated: priorCycles,
      createdAt: cycle.createdAt,
      sourceCommit: cycle.sourceCommit,
      runtimeIdentity: cycle.runtimeIdentity,
    });
    // Derived from the decision before it is durable, so the assignment can cite the identity the
    // decision will have without the decision existing on either side of a failed holdout claim.
    const decisionFingerprint = learningDecisionFingerprint(decision);

    // A3: record this cycle's partition against the decision it produced, claiming the holdout first
    // when the partition needs it. A refused claim throws here, so no decision and no application are
    // ever written for a cycle whose held-out result was already observed.
    const metaOosReceipt = this.metaOos.assign(
      {
        learningCycleId: inputSetReceipt.learningCycleId,
        learningDecisionFingerprint: decisionFingerprint,
        partition: cycle.metaPartition,
        policyVersion: cycle.policies.learningPolicyVersion,
        cutoff: cycle.cutoffTimestamp,
        assignedAt: cycle.createdAt,
        ...(cycle.holdoutKey == null ? {} : { holdoutKey: cycle.holdoutKey }),
        ...(cycle.holdoutEvaluationId == null ? {} : { holdoutEvaluationId: cycle.holdoutEvaluationId }),
      },
      this.holdouts,
    );

    const eligibility = this.metaOos.eligibility(cycle.metaPartition);
    const decisionReceipt = this.decisions.append(decision);

    // A4: application only, and only against eligibility derived from recorded assignments.
    const context: ApplicationContext = {
      applicationTimestamp: cycle.createdAt,
      runtimeIdentity: cycle.runtimeIdentity,
      sourceCommit: cycle.sourceCommit,
    };
    const application = applyBoundedChange(decision, eligibility, applicationPorts, context, this.registry);
    const applicationReceipt = this.applications.append(application);

    const status = buildLearningLoopStatus({
      inputSet: { fingerprint: inputSetReceipt.fingerprint, learningCycleId: inputSetReceipt.learningCycleId },
      decision: { fingerprint: decisionReceipt.fingerprint },
      application: { fingerprint: applicationReceipt.fingerprint, applicationOutcome: applicationReceipt.receipt.applicationOutcome },
      meta: { ...eligibility, partition: cycle.metaPartition },
    });

    return Object.freeze({
      cycleId: inputSetReceipt.learningCycleId,
      inputSetReceipt,
      decisionReceipt,
      metaOosReceipt,
      eligibility,
      applicationReceipt,
      status,
    });
  }

  /** Durable totals for the current chain, read-only. Used by status projection and verification. */
  public summary(): Readonly<{ inputSets: number; decisions: number; applications: number; assignments: number }> {
    return Object.freeze({
      inputSets: this.inputSets.summary().setsRecorded,
      decisions: this.decisions.summary().decisionsRecorded,
      applications: this.applications.summary().applicationsRecorded,
      assignments: this.metaOos.summary().assignmentsRecorded,
    });
  }

  /** Recorded cycles in one partition. A read of history, never an input to it. */
  public metaPartitionCount(partition: MetaPartition): number {
    return this.metaOos.assignments().filter((assignment) => assignment.partition === partition).length;
  }

  /**
   * The current projection, derived from durable records only.
   *
   * It reports; it does not compute a decision or an application, and nothing it returns is fed back
   * into the chain.
   */
  public status(): LearningLoopStatus {
    const inputSet = this.inputSets.summary().latest;
    const decision = this.decisions.summary().latest;
    const partition = this.metaOos.assignments().at(-1)?.partition;
    const application = decision == null ? undefined : this.applications.forDecision(decision.fingerprint).at(-1);
    return buildLearningLoopStatus({
      ...(inputSet == null ? {} : { inputSet: { fingerprint: inputSet.fingerprint, learningCycleId: inputSet.learningCycleId } }),
      ...(decision == null ? {} : { decision: { fingerprint: decision.fingerprint } }),
      ...(partition == null ? {} : { meta: { ...this.metaOos.eligibility(partition), partition } }),
      ...(application == null ? {} : { application: { fingerprint: application.fingerprint, applicationOutcome: application.receipt.applicationOutcome } }),
    });
  }
}
