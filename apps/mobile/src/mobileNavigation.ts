export type PrimaryMobileTab = "HOME" | "MARKET" | "TRADE" | "PORTFOLIO" | "MORE";
export type LegacyMobileTab = "CONTROL" | "SETTINGS";

export const PRIMARY_MOBILE_TABS: readonly PrimaryMobileTab[] = Object.freeze(["HOME", "MARKET", "TRADE", "PORTFOLIO", "MORE"]);
export const MORE_NAVIGATION_ITEMS = Object.freeze(["STRATEGIES", "ANALYTICS", "HISTORY", "JOURNAL", "SETTINGS", "AI_ASSISTANT", "BACKUP", "ABOUT"] as const);
export const GLOBAL_NAVIGATION_ACTIONS = Object.freeze(["SEARCH", "NOTIFICATIONS", "SYSTEM_STATUS", "EMERGENCY_STOP", "ACCOUNT_STATUS"] as const);

export interface MobileNavigationMemory {
  readonly activeTab: PrimaryMobileTab;
  readonly moreItem?: typeof MORE_NAVIGATION_ITEMS[number];
  readonly searchQuery?: string;
  readonly selectedMarket?: string;
  readonly selectedPortfolioTab?: "ASSETS" | "POSITIONS" | "PNL";
  readonly scrollPositions?: Readonly<Record<string, number>>;
}

export interface MobileNavigationState {
  readonly activeTab: PrimaryMobileTab;
  readonly moreItem?: typeof MORE_NAVIGATION_ITEMS[number];
  readonly depth: 1 | 2;
  readonly memory: MobileNavigationMemory;
}

export function normalizeMobileTab(tab: PrimaryMobileTab | LegacyMobileTab): PrimaryMobileTab {
  if (tab === "CONTROL") return "TRADE";
  if (tab === "SETTINGS") return "MORE";
  if (!PRIMARY_MOBILE_TABS.includes(tab)) throw new Error("unsupported mobile tab");
  return tab;
}

export function createMobileNavigationState(input: MobileNavigationMemory, moreItem?: typeof MORE_NAVIGATION_ITEMS[number]): MobileNavigationState {
  const activeTab = normalizeMobileTab(input.activeTab);
  if (moreItem !== undefined && !MORE_NAVIGATION_ITEMS.includes(moreItem)) throw new Error("unsupported More navigation item");
  if (moreItem !== undefined && activeTab !== "MORE") throw new Error("secondary navigation requires More");
  const scrollPositions = input.scrollPositions ?? {};
  if (Object.values(scrollPositions).some((value) => !Number.isFinite(value) || value < 0)) throw new Error("scroll positions must be non-negative");
  const memory = Object.freeze({ ...input, activeTab, ...(moreItem === undefined ? {} : { moreItem }), scrollPositions: Object.freeze({ ...scrollPositions }) });
  return Object.freeze({ activeTab, ...(moreItem === undefined ? {} : { moreItem }), depth: moreItem === undefined ? 1 : 2, memory });
}

export function restoreMobileNavigationState(memory: MobileNavigationMemory | undefined): MobileNavigationState {
  return createMobileNavigationState(memory ?? { activeTab: "HOME" });
}
