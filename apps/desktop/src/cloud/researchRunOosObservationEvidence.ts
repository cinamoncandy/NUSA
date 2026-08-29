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

function validateDecision(decision: BacktestDecision, datasetMarket: string, candidateId: string): void {
  if (decision.market !== datasetMarket) {
    throw new ResearchRunOosObservationError("MARKET_IDENTITY_MISMATCH", `candidate ${candidateId} OOS decision market does not match its dataset`);
  }
  if (!["HOLD", "FILLED", "REJECTED"].includes(decision.outcome)) {
    throw new ResearchRunOosObservationError("INVALID_DECISION_OUTCOME", `candidate ${candidateId} OOS decision outcome is unsupported`);
  }
  if (!["BUY", "SELL", "HOLD"].includes(decision.signal.type)) {
    throw new ResearchRunOosObservationError("INVALID_SIGNAL", `candidate ${candidateId} OOS signal type is unsupported`);
  }
  if (typeof decision.signal.reason !== "string" || !decision.signal.reason.trim()) {
    throw new ResearchRunOosObservationError("INVALID_SIGNAL", `candidate ${candidateId} OOS signal reason is required`);
  }
  if (!Number.isFinite(decision.signal.confidence) || decision.signal.confidence < 0 || decision.signal.confidence > 1) {
    throw new ResearchRunOosObservationError("INVALID_SIGNAL_CONFIDENCE", `candidate ${candidateId} OOS signal confidence must be between 0 and 1`);
  }
  if (!Number.isSafeInteger(decision.timestamp) || decision.signal.timestamp !== decision.timestamp) {
    throw new ResearchRunOosObservationError("SIGNAL_TIMESTAMP_MISMATCH", `candidate ${candidateId} OOS signal timestamp must match its decision`);
  }
  for (const [name, value] of [["equityBefore", decision.equityBefore], ["equityAfter", decision.equityAfter]] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new ResearchRunOosObservationError("INVALID_EQUITY", `candidate ${candidateId} OOS ${name} must be finite and non-negative`);
    }
  }
  if (decision.outcome === "FILLED") {
    if (decision.executionPrice == null || !Number.isFinite(decision.executionPrice) || decision.executionPrice <= 0) {
      throw new ResearchRunOosObservationError("INVALID_FILLED_DECISION", `candidate ${candidateId} filled OOS decisions require a positive execution price`);
    }
  } else if (decision.executionPrice != null) {
    throw new ResearchRunOosObservationError("INVALID_EXECUTION_PRICE", `candidate ${candidateId} non-filled OOS decisions cannot carry an execution price`);
  }
  if (decision.outcome === "REJECTED" && (typeof decision.rejectionReason !== "string" || !decision.rejectionReason.trim())) {
    throw new ResearchRunOosObservationError("MISSING_REJECTION_REASON", `candidate ${candidateId} rejected OOS decisions require a reason`);
  }
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
  if (configured.length === 0) {
    throw new ResearchRunOosObservationError("MISSING_OOS_OBSERVATION_SOURCE", `candidate ${candidateId} has no candidate-specific OOS observation source`);
  }
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
      validateDecision(decision, dataset.market, candidateId);
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