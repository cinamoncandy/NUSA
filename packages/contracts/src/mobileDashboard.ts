export const MOBILE_DASHBOARD_API_VERSION = "1" as const;

export type DashboardHealth = "HEALTHY" | "DEGRADED" | "DOWN";
export type DashboardMode = "PAPER" | "STOPPED" | "FAULTED";
export type DashboardAction = "BUY" | "SELL" | "HOLD" | "REDUCE" | "EXIT" | "WAIT";

export interface MobileDashboardPosition {
  readonly symbol: string;
  readonly instrument: "SPOT" | "FUTURES";
  readonly capital: number;
  readonly share: number;
  readonly leverage: number;
}

export interface MobileDashboardDecision {
  readonly symbol: string;
  readonly action: DashboardAction;
  readonly confidence: number;
  readonly risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly allocation: number;
  readonly leverage: number;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly decidedAt: number;
}

export interface MobileDashboardResponse {
  readonly apiVersion: typeof MOBILE_DASHBOARD_API_VERSION;
  readonly generatedAt: number;
  readonly mode: DashboardMode;
  readonly killSwitchActive: boolean;
  readonly overallHealth: DashboardHealth;
  readonly tradingAllowed: boolean;
  readonly headline: string;
  readonly issues: readonly string[];
  readonly deployableCapital: number;
  readonly deployedCapital: number;
  readonly cashCapital: number;
  readonly reservedCapital: number;
  readonly spotCapital: number;
  readonly futuresCapital: number;
  readonly positions: readonly MobileDashboardPosition[];
  readonly decisions: readonly MobileDashboardDecision[];
  readonly staleIntelligenceSources: readonly string[];
}
