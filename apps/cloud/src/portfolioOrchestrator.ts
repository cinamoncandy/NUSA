import type { CioAction, CioDecision, RiskLevel } from "./cioDecisionEngine";

export interface PortfolioCandidate {
  readonly decision: CioDecision;
  readonly instrument: "SPOT" | "FUTURES";
}

export interface PortfolioPlanInput {
  readonly now: number;
  readonly deployableCapital: number;
  readonly reservedCapital: number;
  readonly candidates: readonly PortfolioCandidate[];
  readonly maxFuturesShare: number;
  readonly maxGrossShare: number;
}

export interface PortfolioAllocation {
  readonly symbol: string;
  readonly instrument: "SPOT" | "FUTURES";
  readonly action: CioAction;
  readonly capital: number;
  readonly share: number;
  readonly leverage: number;
  readonly confidence: number;
  readonly risk: RiskLevel;
}

export interface PortfolioPlan {
  readonly allocations: readonly PortfolioAllocation[];
  readonly deployedCapital: number;
  readonly cashCapital: number;
  readonly reservedCapital: number;
  readonly grossShare: number;
  readonly futuresShare: number;
  readonly decidedAt: number;
}

const unit = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
};
const money = (value: number, field: string): void => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be non-negative`);
};
const round = (value: number): number => Math.round(value * 100) / 100;
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

export function buildPortfolioPlan(input: PortfolioPlanInput): PortfolioPlan {
  if (!Number.isSafeInteger(input.now) || input.now < 0) throw new Error("now is invalid");
  money(input.deployableCapital, "deployableCapital");
  money(input.reservedCapital, "reservedCapital");
  unit(input.maxFuturesShare, "maxFuturesShare");
  unit(input.maxGrossShare, "maxGrossShare");

  const seen = new Set<string>();
  const ordered = [...input.candidates].sort((a, b) =>
    b.decision.confidence - a.decision.confidence || a.decision.symbol.localeCompare(b.decision.symbol) || a.instrument.localeCompare(b.instrument)
  );
  const allocations: PortfolioAllocation[] = [];
  let grossShare = 0;
  let futuresShare = 0;

  for (const candidate of ordered) {
    const d = candidate.decision;
    const key = `${d.symbol}|${candidate.instrument}`;
    if (seen.has(key)) throw new Error(`duplicate portfolio candidate: ${key}`);
    seen.add(key);
    if (d.decidedAt > input.now) throw new Error("decision is from the future");
    if (d.action === "WAIT" || d.action === "EXIT" || d.action === "SELL" || d.allocation === 0) continue;

    let share = Math.min(d.allocation, Math.max(0, input.maxGrossShare - grossShare));
    if (candidate.instrument === "FUTURES") share = Math.min(share, Math.max(0, input.maxFuturesShare - futuresShare));
    share = round4(share);
    if (share <= 0) continue;

    grossShare = round4(grossShare + share);
    if (candidate.instrument === "FUTURES") futuresShare = round4(futuresShare + share);
    allocations.push(Object.freeze({
      symbol: d.symbol,
      instrument: candidate.instrument,
      action: d.action,
      capital: round(input.deployableCapital * share),
      share,
      leverage: candidate.instrument === "SPOT" ? 1 : d.leverage,
      confidence: d.confidence,
      risk: d.risk
    }));
  }

  const deployedCapital = round(allocations.reduce((sum, item) => sum + item.capital, 0));
  if (deployedCapital > input.deployableCapital + 0.01) throw new Error("portfolio exceeds deployable capital");
  return Object.freeze({
    allocations: Object.freeze(allocations),
    deployedCapital,
    cashCapital: round(input.deployableCapital - deployedCapital),
    reservedCapital: round(input.reservedCapital),
    grossShare,
    futuresShare,
    decidedAt: input.now
  });
}
