import type { AiCioDashboardSnapshot, DashboardStatus } from "../../cloud/src/dashboardAggregator";

export interface AiCioMetricCard {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly status: DashboardStatus;
}

export interface AiCioDashboardViewModel {
  readonly status: DashboardStatus;
  readonly title: string;
  readonly subtitle: string;
  readonly tradingEnabled: boolean;
  readonly metrics: readonly AiCioMetricCard[];
  readonly warnings: readonly string[];
  readonly generatedAt: number;
}

const percent = (value: number): string => `${(value * 100).toFixed(2)}%`;
const money = (value: number): string => value.toFixed(2);

export function buildAiCioDashboardViewModel(snapshot: AiCioDashboardSnapshot): AiCioDashboardViewModel {
  const metrics: AiCioMetricCard[] = [
    { id: "equity", label: "Total Equity", value: money(snapshot.portfolio.totalEquity), status: snapshot.portfolio.status },
    { id: "deployable", label: "Deployable", value: money(snapshot.portfolio.deployableCapital), status: snapshot.portfolio.status },
    { id: "exposure", label: "Net Exposure", value: percent(snapshot.portfolio.netExposureRatio), status: snapshot.risk.status },
    { id: "pnl", label: "Net PnL", value: money(snapshot.strategies.totalNetPnl), status: snapshot.strategies.status },
    { id: "capture", label: "Edge Capture", value: percent(snapshot.strategies.portfolioCaptureRatio), status: snapshot.strategies.status },
    { id: "committee", label: "Committee", value: snapshot.committee.decision, status: snapshot.committee.status },
    { id: "confidence", label: "Confidence", value: percent(snapshot.committee.confidence), status: snapshot.committee.status },
    { id: "fill", label: "Fill Quality", value: percent(snapshot.execution.fillQuality), status: snapshot.execution.status },
    { id: "slippage", label: "Slippage", value: `${snapshot.execution.slippageBps.toFixed(2)} bps`, status: snapshot.execution.status },
    { id: "drawdown", label: "Daily Drawdown", value: percent(snapshot.risk.dailyDrawdownRatio), status: snapshot.risk.status },
    { id: "heat", label: "Portfolio Heat", value: percent(snapshot.risk.portfolioHeatRatio), status: snapshot.risk.status },
    { id: "opportunities", label: "Active Opportunities", value: String(snapshot.opportunities.activeCount), status: snapshot.opportunities.status }
  ];

  return Object.freeze({
    status: snapshot.status,
    title: "DOKKAEBI AI CIO",
    subtitle: snapshot.status === "BLOCKED" ? "Trading is blocked by safety controls" : snapshot.status === "CAUTION" ? "Review warnings before action" : "Paper operations normal",
    tradingEnabled: snapshot.tradingPermitted,
    metrics: Object.freeze(metrics.map((item) => Object.freeze(item))),
    warnings: Object.freeze([...snapshot.warnings]),
    generatedAt: snapshot.generatedAt
  });
}
