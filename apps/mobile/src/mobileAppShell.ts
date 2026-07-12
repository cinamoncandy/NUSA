import type { DashboardScreenState } from "./dashboardScreenState";

export type MobileTab = "HOME" | "MARKET" | "PORTFOLIO" | "CONTROL" | "SETTINGS";
export type MobileSessionState = "SIGNED_OUT" | "AUTHENTICATING" | "SIGNED_IN" | "EXPIRED";

export interface MobileAppShellInput {
  readonly session: MobileSessionState;
  readonly activeTab: MobileTab;
  readonly dashboard: DashboardScreenState;
  readonly lastSuccessfulSyncAt?: number;
  readonly now: number;
}

export interface MobileAppShellState {
  readonly route: "AUTH" | "APP";
  readonly activeTab: MobileTab;
  readonly title: string;
  readonly canRefresh: boolean;
  readonly canOpenTradingControl: boolean;
  readonly showEmergencyStop: boolean;
  readonly banner?: {
    readonly tone: "INFO" | "WARNING" | "DANGER";
    readonly message: string;
  };
  readonly lastSuccessfulSyncAt?: number;
}

const TITLES: Readonly<Record<MobileTab, string>> = Object.freeze({
  HOME: "도깨비",
  MARKET: "시장",
  PORTFOLIO: "포트폴리오",
  CONTROL: "거래 제어",
  SETTINGS: "설정"
});

export function buildMobileAppShell(input: MobileAppShellInput): MobileAppShellState {
  if (!Number.isSafeInteger(input.now) || input.now < 0) throw new Error("now must be a non-negative safe integer");
  if (input.lastSuccessfulSyncAt !== undefined && (!Number.isSafeInteger(input.lastSuccessfulSyncAt) || input.lastSuccessfulSyncAt < 0 || input.lastSuccessfulSyncAt > input.now)) {
    throw new Error("lastSuccessfulSyncAt is invalid");
  }

  if (input.session !== "SIGNED_IN") {
    const banner = input.session === "EXPIRED"
      ? Object.freeze({ tone: "WARNING" as const, message: "세션이 만료되었습니다. 다시 로그인해 주세요." })
      : undefined;
    return Object.freeze({
      route: "AUTH",
      activeTab: "HOME",
      title: "도깨비 로그인",
      canRefresh: false,
      canOpenTradingControl: false,
      showEmergencyStop: false,
      ...(banner ? { banner } : {}),
      ...(input.lastSuccessfulSyncAt === undefined ? {} : { lastSuccessfulSyncAt: input.lastSuccessfulSyncAt })
    });
  }

  let banner: MobileAppShellState["banner"];
  if (input.dashboard.kind === "ERROR") {
    banner = Object.freeze({ tone: "DANGER", message: input.dashboard.message });
  } else if (input.dashboard.kind === "BLOCKED") {
    banner = Object.freeze({ tone: "DANGER", message: input.dashboard.headline });
  } else if (input.dashboard.kind === "CAUTION") {
    banner = Object.freeze({ tone: "WARNING", message: input.dashboard.headline });
  } else if (input.dashboard.kind === "LOADING") {
    banner = Object.freeze({ tone: "INFO", message: "최신 운용 상태를 불러오는 중입니다." });
  }

  const canOpenTradingControl = input.dashboard.kind !== "LOADING" && input.dashboard.kind !== "ERROR";
  const showEmergencyStop = input.dashboard.kind === "READY" || input.dashboard.kind === "CAUTION" || input.dashboard.kind === "BLOCKED";

  return Object.freeze({
    route: "APP",
    activeTab: input.activeTab,
    title: TITLES[input.activeTab],
    canRefresh: input.dashboard.kind !== "LOADING",
    canOpenTradingControl,
    showEmergencyStop,
    ...(banner ? { banner } : {}),
    ...(input.lastSuccessfulSyncAt === undefined ? {} : { lastSuccessfulSyncAt: input.lastSuccessfulSyncAt })
  });
}
