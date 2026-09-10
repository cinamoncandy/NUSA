import {
  SqliteAiOutcomeAttributionMemory
} from "./aiOutcomeAttributionMemory";
import {
  SqliteEvolutionLearningLedger
} from "./evolutionLearningLedger";
import {
  SqliteImprovementCandidateMemory,
  type ImprovementCandidateMemoryRecord
} from "./improvementCandidateMemory";
import {
  SqliteResearchMemoryRepository,
  type ResearchExperimentRecord,
  type ResearchHypothesis
} from "./researchMemory";

export interface MemoryEngineV10Dependencies {
  readonly research: SqliteResearchMemoryRepository;
  readonly improvement: SqliteImprovementCandidateMemory;
  readonly evolution: SqliteEvolutionLearningLedger;
  readonly aiOutcome: SqliteAiOutcomeAttributionMemory;
}

export interface MemoryEngineV10Snapshot {
  readonly researchHypotheses: number;
  readonly researchExperiments: number;
  readonly improvementCandidates: number;
  readonly evolutionEvents: number;
  readonly evolutionHeadHash: string;
  readonly aiOutcomeEvents: number;
  readonly aiOutcomeHeadHash: string;
  readonly authority: "ADVISORY_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

type EvolutionRecord = Parameters<SqliteEvolutionLearningLedger["append"]>[0];
type AiOutcomeEpisode = Parameters<SqliteAiOutcomeAttributionMemory["appendEpisode"]>[0];

export class MemoryEngineV10 {
  public constructor(private readonly dependencies: MemoryEngineV10Dependencies) {
    this.snapshot();
  }

  public appendHypothesis(value: ResearchHypothesis): ResearchHypothesis {
    return this.dependencies.research.appendHypothesis(value);
  }

  public appendExperiment(value: ResearchExperimentRecord): ResearchExperimentRecord {
    return this.dependencies.research.appendExperiment(value);
  }

  public saveImprovementCandidate(value: ImprovementCandidateMemoryRecord): void {
    this.dependencies.improvement.save(value);
  }

  public appendEvolutionLearning(value: EvolutionRecord): EvolutionRecord {
    return this.dependencies.evolution.append(value);
  }

  public appendAiOutcome(value: AiOutcomeEpisode): void {
    this.dependencies.aiOutcome.appendEpisode(value);
  }

  public snapshot(): MemoryEngineV10Snapshot {
    const evolution = this.dependencies.evolution.replay();
    const aiOutcome = this.dependencies.aiOutcome.replay();
    return Object.freeze({
      researchHypotheses: this.dependencies.research.listHypotheses().length,
      researchExperiments: this.dependencies.research.listExperiments().length,
      improvementCandidates: this.dependencies.improvement.size(),
      evolutionEvents: evolution.eventCount,
      evolutionHeadHash: evolution.headHash,
      aiOutcomeEvents: aiOutcome.eventCount,
      aiOutcomeHeadHash: aiOutcome.headHash,
      authority: "ADVISORY_ONLY",
      liveAuthority: "NONE",
      productionMutationAllowed: false
    });
  }
}
