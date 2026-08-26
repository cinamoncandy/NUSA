import type { DashboardScreenState } from "./dashboardScreenState";
import { normalizeMobileTab, PRIMARY_MOBILE_TABS, type LegacyMobileTab, type PrimaryMobileTab, type SecondaryMobileTab } from "./mobileNavigation";

export type MobileTab = PrimaryMobileTab | SecondaryMobileTab | LegacyMobileTab;
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
  readonly activeTab: PrimaryMobileTab | SecondaryMobileTab;
  readonly primaryTabs: readonly PrimaryMobileTab[];
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

const TITLES: Readonly<Record<string, string>> = Object.freeze({
  HOME: "NUSA",
  OBSERVE: "관찰",
  PAPER: "PAPER",
  SUPERVISE: "감독",
  MORE: "도구"
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
      primaryTabs: PRIMARY_MOBILE_TABS,
      title: "NUSA 로그인",
      canRefresh: false,
      canOpenTradingControl: false,
      showEmergencyStop: false,
      ...(banner ? { banner } : {}),
      ...(input.lastSuccessfulSyncAt === undefined ? {} : { lastSuccessfulSyncAt: input.lastSuccessfulSyncAt })
    });
  }

  let banner: MobileAppShellState["banner"];
  if (input.dashboard.phase === "ERROR") {
    banner = Object.freeze({ tone: "DANGER", message: input.dashboard.message ?? input.dashboard.headline });
  } else if (input.dashboard.phase === "BLOCKED") {
    banner = Object.freeze({ tone: "DANGER", message: input.dashboard.message ?? input.dashboard.headline });
  } else if (input.dashboard.phase === "CAUTION") {
    banner = Object.freeze({ tone: "WARNING", message: input.dashboard.message ?? input.dashboard.headline });
  } else if (input.dashboard.phase === "LOADING") {
    banner = Object.freeze({ tone: "INFO", message: "최신 운용 상태를 불러오는 중입니다." });
  }

  const canOpenTradingControl = input.dashboard.phase !== "LOADING" && input.dashboard.phase !== "ERROR";
  const showEmergencyStop = input.dashboard.phase === "READY" || input.dashboard.phase === "CAUTION" || input.dashboard.phase === "BLOCKED";

  const activeTab = normalizeMobileTab(input.activeTab);
  return Object.freeze({
    route: "APP",
    activeTab,
    primaryTabs: PRIMARY_MOBILE_TABS,
    title: TITLES[activeTab] ?? activeTab,
    canRefresh: input.dashboard.phase !== "LOADING",
    canOpenTradingControl,
    showEmergencyStop,
    ...(banner ? { banner } : {}),
    ...(input.lastSuccessfulSyncAt === undefined ? {} : { lastSuccessfulSyncAt: input.lastSuccessfulSyncAt })
  });
}

