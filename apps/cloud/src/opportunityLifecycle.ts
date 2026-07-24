export type OpportunityState = "DETECTED" | "VALIDATED" | "BUILDING" | "ACTIVE" | "REDUCING" | "EXITING" | "CLOSED" | "REJECTED" | "EXPIRED";

export interface OpportunitySignal {
  readonly source: string;
  readonly observedAt: number;
  readonly halfLifeMs: number;
  readonly edgeBps: number;
  readonly confidence: number;
}

export interface OpportunityInput {
  readonly id: string;
  readonly symbol: string;
  readonly now: number;
  readonly state: OpportunityState;
  readonly signals: readonly OpportunitySignal[];
  readonly minimumNetEdgeBps: number;
  readonly estimatedExecutionCostBps: number;
  readonly killSwitchActive: boolean;
}

export interface OpportunitySnapshot {
  readonly id: string;
  readonly symbol: string;
  readonly state: OpportunityState;
  readonly grossDecayedEdgeBps: number;
  readonly netDecayedEdgeBps: number;
  readonly confidence: number;
  readonly expiresAt?: number;
  readonly action: "REJECT" | "WAIT" | "BUILD" | "HOLD" | "REDUCE" | "EXIT";
  readonly reasons: readonly string[];
  readonly evaluatedAt: number;
}

const finite = (value: number, field: string, minimum = 0): void => {
  if (!Number.isFinite(value) || value < minimum) throw new Error(`${field} is invalid`);
};

const time = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

export function evaluateOpportunity(input: OpportunityInput): OpportunitySnapshot {
  time(input.now, "now");
  finite(input.minimumNetEdgeBps, "minimumNetEdgeBps");
  finite(input.estimatedExecutionCostBps, "estimatedExecutionCostBps");
  if (!input.id.trim() || !input.symbol.trim()) throw new Error("id and symbol are required");
  if (input.signals.length === 0) throw new Error("at least one signal is required");

  let weightedEdge = 0;
  let confidenceWeight = 0;
  let latestExpiry = 0;
  for (const signal of input.signals) {
    if (!signal.source.trim()) throw new Error("signal source is required");
    time(signal.observedAt, "signal.observedAt");
    time(signal.halfLifeMs, "signal.halfLifeMs");
    finite(signal.edgeBps, "signal.edgeBps");
    finite(signal.confidence, "signal.confidence");
    if (signal.confidence > 1) throw new Error("signal confidence must be between 0 and 1");
    if (signal.observedAt > input.now || signal.halfLifeMs === 0) throw new Error("signal timing is invalid");
    const age = input.now - signal.observedAt;
    const decay = Math.pow(0.5, age / signal.halfLifeMs);
    weightedEdge += signal.edgeBps * signal.confidence * decay;
    confidenceWeight += signal.confidence * decay;
    latestExpiry = Math.max(latestExpiry, signal.observedAt + signal.halfLifeMs * 8);
  }

  const gross = round4(weightedEdge);
  const net = round4(gross - input.estimatedExecutionCostBps);
  const confidence = round4(Math.min(1, confidenceWeight / input.signals.length));
  const reasons: string[] = [];
  let state = input.state;
  let action: OpportunitySnapshot["action"] = "WAIT";

  if (input.killSwitchActive) {
    state = input.state === "CLOSED" ? "CLOSED" : "EXITING";
    action = "EXIT";
    reasons.push("KILL_SWITCH_ACTIVE");
  } else if (input.now >= latestExpiry) {
    state = "EXPIRED";
    action = input.state === "ACTIVE" || input.state === "BUILDING" || input.state === "REDUCING" ? "EXIT" : "REJECT";
    reasons.push("OPPORTUNITY_EXPIRED");
  } else if (net < 0) {
    state = input.state === "ACTIVE" || input.state === "BUILDING" ? "EXITING" : "REJECTED";
    action = input.state === "ACTIVE" || input.state === "BUILDING" ? "EXIT" : "REJECT";
    reasons.push("NEGATIVE_NET_EDGE");
  } else if (net < input.minimumNetEdgeBps) {
    if (input.state === "ACTIVE") {
      state = "REDUCING";
      action = "REDUCE";
      reasons.push("EDGE_BELOW_HOLD_THRESHOLD");
    } else {
      action = "WAIT";
      reasons.push("EDGE_BELOW_ENTRY_THRESHOLD");
    }
  } else {
    if (input.state === "DETECTED" || input.state === "VALIDATED") {
      state = "BUILDING";
      action = "BUILD";
    } else if (input.state === "BUILDING" || input.state === "ACTIVE") {
      state = "ACTIVE";
      action = "HOLD";
    } else if (input.state === "REDUCING") {
      action = "HOLD";
    }
    reasons.push("POSITIVE_NET_EDGE");
  }

  return Object.freeze({
    id: input.id.trim(),
    symbol: input.symbol.trim().toUpperCase(),
    state,
    grossDecayedEdgeBps: gross,
    netDecayedEdgeBps: net,
    confidence,
    ...(latestExpiry > 0 ? { expiresAt: latestExpiry } : {}),
    action,
    reasons: Object.freeze(reasons.sort()),
    evaluatedAt: input.now
  });
}
