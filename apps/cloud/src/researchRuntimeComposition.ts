import type { ResearchRecoveryResult } from "../../../packages/contracts/src/researchRecovery";
import type { ResearchHealth, ResearchStatusProjection } from "../../../packages/contracts/src/researchAutomation";
import { SqliteResearchSessionRepository } from "../../../packages/storage/src/researchAutomation";
import { SqliteResearchEvaluationLedger } from "../../../packages/storage/src/researchEvaluationLedger";
import { SqliteCandidatePromotionRepository } from "../../../packages/storage/src/candidatePromotionRepository";
import type { SqliteDatabase } from "../../../packages/storage/src/index";
import { ResearchRecoveryCoordinator } from "./researchRecoveryCoordinator";
import type { ResearchRuntimeMarketDataTick } from "./researchRuntimeCoordinator";

const MAX_EVIDENCE_AGE_MS = 86_400_000;
const freeze = <T>(value: T): T => Object.freeze(value);

/**
 * Default private runtime composition for persisted Research state.
 * It verifies/replays state and exposes status only. Market ticks are intentionally a no-op
 * until a real evaluator/input builder is explicitly configured; this prevents synthetic
 * evidence, implicit candidate creation, or automatic promotion during normal app startup.
 */
export class DefaultResearchRuntimeComposition {
  private readonly sessions: SqliteResearchSessionRepository;
  private readonly ledger: SqliteResearchEvaluationLedger;
  private readonly candidates: SqliteCandidatePromotionRepository;
  private readonly recovery: ResearchRecoveryCoordinator;
  private recoveryStatus: "READY" | "FAIL_CLOSED" = "READY";

  public constructor(private readonly db: SqliteDatabase, private readonly now: () => number = () => Date.now()) {
    this.sessions = new SqliteResearchSessionRepository(db);
    this.ledger = new SqliteResearchEvaluationLedger(db);
    this.candidates = new SqliteCandidatePromotionRepository(db);
    this.recovery = new ResearchRecoveryCoordinator({ evaluationLedger: this.ledger, repository: this.candidates, now });
  }

  public recover(): ResearchRecoveryResult {
    const result = this.recovery.recover();
    this.recoveryStatus = result.status === "READY" ? "READY" : "FAIL_CLOSED";
    const recoveredAt = this.now();
    for (const session of this.sessions.list()) {
      if (session.state !== "RUNNING") continue;
      this.sessions.save(freeze({ ...session, state: this.recoveryStatus === "READY" ? "PAUSED" as const : "HALTED" as const, updatedAt: recoveredAt }));
    }
    return result;
  }

  public onMarketData(_tick: ResearchRuntimeMarketDataTick): void {
    // Intentionally disabled in the default composition. A real evaluator + canonical input
    // builder must be injected explicitly before continuous Research may create evidence.
  }

  public statusProjection(): ResearchStatusProjection | null {
    const session = [...this.sessions.list()].sort((left, right) => right.updatedAt - left.updatedAt || left.sessionId.localeCompare(right.sessionId))[0];
    if (session == null) return null;
    const now = this.now();
    const evidenceAgeMs = session.lastEvidenceAt == null ? undefined : Math.max(0, now - session.lastEvidenceAt);
    const health = this.health(session.state, session.experimentCount, session.metrics.inconclusiveCount, evidenceAgeMs);
    let lastResult: "CHAMPION_BETTER" | "CHALLENGER_BETTER" | "EQUIVALENT" | "INCONCLUSIVE" | undefined;
    if (session.lastEvaluationId != null && this.recoveryStatus === "READY") lastResult = this.ledger.list().find((item) => item.evaluationId === session.lastEvaluationId)?.result;
    return freeze({
      sessionId: session.sessionId,
      state: session.state,
      health,
      datasetId: session.datasetId,
      champion: freeze({ strategyId: session.championStrategyId, strategyVersion: session.championStrategyVersion, authority: "PAPER_ONLY" as const }),
      challenger: freeze({ strategyId: session.challengerStrategyId, strategyVersion: session.challengerStrategyVersion, authority: "ZERO_AUTHORITY" as const }),
      candidateCount: this.candidates.listCandidates().length,
      experimentCount: session.experimentCount,
      ...(lastResult == null ? {} : { lastResult }),
      metrics: session.metrics,
      ...(evidenceAgeMs == null ? {} : { evidenceAgeMs }),
      recoveryStatus: this.recoveryStatus === "FAIL_CLOSED" ? "FAIL_CLOSED" as const : session.state === "PAUSED" ? "PAUSED" as const : "READY" as const,
      liveAuthority: "NONE" as const,
      productionMutationAllowed: false as const
    });
  }

  private health(state: string, experimentCount: number, inconclusiveCount: number, evidenceAgeMs: number | undefined): ResearchHealth {
    if (this.recoveryStatus !== "READY" || state === "HALTED" || state === "FAILED") return "FAIL_CLOSED";
    if (experimentCount === 0 || evidenceAgeMs == null) return "DEGRADED";
    if (evidenceAgeMs > MAX_EVIDENCE_AGE_MS) return "STALE";
    if (inconclusiveCount / experimentCount > 0.5) return "DEGRADED";
    return "HEALTHY";
  }
}

export function createDefaultResearchRuntimeComposition(db: SqliteDatabase, now?: () => number): DefaultResearchRuntimeComposition {
  return new DefaultResearchRuntimeComposition(db, now);
}
