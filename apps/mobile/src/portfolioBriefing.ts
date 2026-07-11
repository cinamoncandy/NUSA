import type { PortfolioPlan } from "../../cloud/src/portfolioOrchestrator";

export interface PortfolioBriefing {
  readonly headline: string;
  readonly status: "ACTIVE" | "CASH_HEAVY" | "PROTECTED";
  readonly deployedCapital: number;
  readonly cashCapital: number;
  readonly reservedCapital: number;
  readonly spotCapital: number;
  readonly futuresCapital: number;
  readonly positions: readonly {
    readonly symbol: string;
    readonly instrument: "SPOT" | "FUTURES";
    readonly capital: number;
    readonly share: number;
    readonly leverage: number;
  }[];
  readonly decidedAt: number;
}

export function buildPortfolioBriefing(plan: PortfolioPlan): PortfolioBriefing {
  const spotCapital = plan.allocations.filter((x) => x.instrument === "SPOT").reduce((sum, x) => sum + x.capital, 0);
  const futuresCapital = plan.allocations.filter((x) => x.instrument === "FUTURES").reduce((sum, x) => sum + x.capital, 0);
  const totalVisible = plan.deployedCapital + plan.cashCapital + plan.reservedCapital;
  if (!Number.isFinite(totalVisible) || totalVisible < 0) throw new Error("portfolio totals are invalid");

  const status: PortfolioBriefing["status"] = plan.reservedCapital > plan.deployedCapital
    ? "PROTECTED"
    : plan.cashCapital > plan.deployedCapital
      ? "CASH_HEAVY"
      : "ACTIVE";
  const headline = status === "PROTECTED"
    ? "예약 자금을 보호하며 운용 중입니다."
    : status === "CASH_HEAVY"
      ? "현금 비중을 높게 유지하고 있습니다."
      : "선별된 포지션을 운용하고 있습니다.";

  return Object.freeze({
    headline,
    status,
    deployedCapital: plan.deployedCapital,
    cashCapital: plan.cashCapital,
    reservedCapital: plan.reservedCapital,
    spotCapital,
    futuresCapital,
    positions: Object.freeze(plan.allocations.map((x) => Object.freeze({
      symbol: x.symbol,
      instrument: x.instrument,
      capital: x.capital,
      share: x.share,
      leverage: x.leverage
    }))),
    decidedAt: plan.decidedAt
  });
}
