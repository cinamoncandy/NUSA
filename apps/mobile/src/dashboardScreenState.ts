import type { MobileDashboardResponse } from "../../../packages/contracts/src/mobileDashboard";
import { decodeMobileDashboardResponse } from "./mobileDashboardSync";

export type DashboardScreenPhase = "LOADING" | "READY" | "CAUTION" | "BLOCKED" | "ERROR";

export interface DashboardScreenState {
  readonly phase: DashboardScreenPhase;
  readonly headline: string;
  readonly canTrade: boolean;
  readonly dashboard?: MobileDashboardResponse;
  readonly message?: string;
}

export const initialDashboardScreenState = (): DashboardScreenState => Object.freeze({
  phase: "LOADING",
  headline: "도깨비가 운용 상태를 확인하고 있습니다.",
  canTrade: false
});

export function resolveDashboardScreenState(payload: unknown, now: number, maxAgeMs: number): DashboardScreenState {
  try {
    const dashboard = decodeMobileDashboardResponse(payload, now, maxAgeMs);
    const blocked = dashboard.killSwitchActive || dashboard.mode !== "PAPER" || dashboard.overallHealth === "DOWN";
    if (blocked) {
      return Object.freeze({
        phase: "BLOCKED",
        headline: dashboard.headline,
        canTrade: false,
        dashboard,
        message: dashboard.issues[0] ?? "안전을 위해 거래가 중지되었습니다."
      });
    }
    if (dashboard.overallHealth === "DEGRADED" || dashboard.staleIntelligenceSources.length > 0) {
      return Object.freeze({
        phase: "CAUTION",
        headline: dashboard.headline,
        canTrade: false,
        dashboard,
        message: dashboard.issues[0] ?? "일부 데이터가 늦어 신규 판단을 기다립니다."
      });
    }
    return Object.freeze({
      phase: "READY",
      headline: dashboard.headline,
      canTrade: dashboard.tradingAllowed,
      dashboard
    });
  } catch (error) {
    return Object.freeze({
      phase: "ERROR",
      headline: "운용 상태를 확인할 수 없습니다.",
      canTrade: false,
      message: error instanceof Error ? error.message : "unknown dashboard error"
    });
  }
}
