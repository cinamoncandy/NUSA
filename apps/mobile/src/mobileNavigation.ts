/**
 * The visible navigation is organized around the user's supervision jobs, not legacy
 * trading-product nouns. Screen implementations keep their existing route keys so this
 * contract changes the information architecture without creating parallel screens.
 */
export type PrimaryMobileTab = "HOME" | "OBSERVE" | "PAPER" | "SUPERVISE";
export type SecondaryMobileTab = "MORE";
export type LegacyMobileTab = "CONTROL" | "SETTINGS";

export const PRIMARY_MOBILE_TABS: readonly PrimaryMobileTab[] = Object.freeze(["HOME", "OBSERVE", "PAPER", "SUPERVISE"]);
export const MORE_NAVIGATION_ITEMS = Object.freeze(["STRATEGIES", "ANALYTICS", "HISTORY", "JOURNAL", "SETTINGS", "AI_ASSISTANT", "BACKUP", "ABOUT"] as const);
export const GLOBAL_NAVIGATION_ACTIONS = Object.freeze(["SEARCH", "NOTIFICATIONS", "SYSTEM_STATUS", "EMERGENCY_STOP", "ACCOUNT_STATUS"] as const);

export interface MobileNavigationMemory {
  readonly activeTab: PrimaryMobileTab | SecondaryMobileTab;
  readonly moreItem?: typeof MORE_NAVIGATION_ITEMS[number];
  readonly searchQuery?: string;
  readonly selectedMarket?: string;
  readonly selectedPortfolioTab?: "ASSETS" | "POSITIONS" | "PNL";
  readonly scrollPositions?: Readonly<Record<string, number>>;
}

export interface MobileNavigationState {
  readonly activeTab: PrimaryMobileTab | SecondaryMobileTab;
  readonly moreItem?: typeof MORE_NAVIGATION_ITEMS[number];
  readonly depth: 1 | 2;
  readonly memory: MobileNavigationMemory;
}

export function normalizeMobileTab(tab: PrimaryMobileTab | SecondaryMobileTab | LegacyMobileTab): PrimaryMobileTab | SecondaryMobileTab {
  if (tab === "CONTROL") return "PAPER";
  if (tab === "SETTINGS") return "MORE";
  if (tab === "MORE") return "MORE";
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
