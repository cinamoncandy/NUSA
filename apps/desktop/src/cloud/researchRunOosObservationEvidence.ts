import type { ResearchExperimentResult } from "./researchDataset";
import type { BacktestDecision } from "../strategy/backtestEngine";

export interface OosObservationTrace {
  readonly candidateId: string;
  readonly datasetId: string;
  readonly windowId: number;
  readonly decisionTimestamp: number;
  readonly market: string;
  readonly observedPrice: number;
  readonly signal: BacktestDecision["signal"];
  readonly outcome: BacktestDecision["outcome"];
  readonly executionPrice?: number;
  readonly rejectionReason?: string;
}

export class ResearchRunOosObservationError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "ResearchRunOosObservationError"; }
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function finite(value: number, code: string, message: string): void {
  if (!Number.isFinite(value)) throw new ResearchRunOosObservationError(code, message);
}

/**
 * Preserves the candle-level decisions already produced by the canonical walk-forward engine.
 * This adapter never infers prices or trades from aggregate returns; it only copies validated
 * BacktestDecision observations and binds them to the verified dataset manifest.
 */
export function extractResearchRunOosObservations(
  candidateId: string,
  experiment: ResearchExperimentResult,
): readonly OosObservationTrace[] {
  if (!candidateId.trim()) throw new ResearchRunOosObservationError("INVALID_CANDIDATE_ID", "candidate id is required");
  const configured = experiment.experimentConfig.candidates;
  if (configured.length !== 1 || configured[0]?.id !== candidateId) {
    throw new ResearchRunOosObservationError("CANDIDATE_EXPERIMENT_IDENTITY_MISMATCH", `candidate ${candidateId} must own a single-candidate experiment`);
  }
  const dataset = experiment.manifest;
  const observations: OosObservationTrace[] = [];
  for (const windowResult of experiment.walkForwardResult.windows) {
    const first = windowResult.window.testPoints[0]?.timestamp;
    const last = windowResult.window.testPoints.at(-1)?.timestamp;
    if (first == null || last == null || !Number.isFinite(first) || !Number.isFinite(last) || first > last) {
      throw new ResearchRunOosObservationError("INVALID_OOS_WINDOW", `candidate ${candidateId} contains an invalid OOS window`);
    }
    let previous = Number.NEGATIVE_INFINITY;
    for (const decision of windowResult.testResult.decisions) {
      finite(decision.timestamp, "INVALID_DECISION_TIMESTAMP", "OOS decision timestamp must be finite");
      if (decision.timestamp < first || decision.timestamp > last || decision.timestamp <= previous) {
        throw new ResearchRunOosObservationError("INVALID_DECISION_CHRONOLOGY", `candidate ${candidateId} OOS decisions must be ordered inside their window`);
      }
      finite(decision.price, "INVALID_OBSERVED_PRICE", "observed OOS price must be finite");
      if (decision.price <= 0) throw new ResearchRunOosObservationError("INVALID_OBSERVED_PRICE", "observed OOS price must be positive");
      if (decision.executionPrice != null) {
        finite(decision.executionPrice, "INVALID_EXECUTION_PRICE", "execution price must be finite");
        if (decision.executionPrice <= 0) throw new ResearchRunOosObservationError("INVALID_EXECUTION_PRICE", "execution price must be positive");
      }
      observations.push(freeze({ candidateId, datasetId: dataset.datasetId, windowId: windowResult.window.index, decisionTimestamp: decision.timestamp, market: decision.market, observedPrice: decision.price, signal: freeze({ ...decision.signal }), outcome: decision.outcome, ...(decision.executionPrice == null ? {} : { executionPrice: decision.executionPrice }), ...(decision.rejectionReason == null ? {} : { rejectionReason: decision.rejectionReason }) }));
      previous = decision.timestamp;
    }
  }
  if (observations.length === 0) throw new ResearchRunOosObservationError("INSUFFICIENT_OBSERVATION_EVIDENCE", "walk-forward result contains no OOS decision observations");
  return Object.freeze(observations);
}
