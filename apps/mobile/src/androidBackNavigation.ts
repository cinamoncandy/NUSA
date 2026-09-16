export type AndroidBackTab = "Home" | "Markets" | "Paper" | "Portfolio" | "AiSignal" | "Order";

export interface AndroidBackNavigationState {
  readonly paperLearningOpen: boolean;
  readonly utilityViewOpen: boolean;
  readonly utilityMenuOpen: boolean;
  readonly activeTab: AndroidBackTab;
}

export type AndroidBackNavigationAction =
  | "CLOSE_PAPER_LEARNING"
  | "CLOSE_UTILITY_VIEW"
  | "CLOSE_UTILITY_MENU"
  | "GO_HOME"
  | "EXIT_APP";

/**
 * Resolves Android hardware-back navigation without touching session, runtime,
 * PAPER execution, broker, or authority state. Nested UI is always collapsed
 * before the root screen is allowed to exit the application.
 */
export function resolveAndroidBackNavigation(state: AndroidBackNavigationState): AndroidBackNavigationAction {
  if (state.paperLearningOpen) return "CLOSE_PAPER_LEARNING";
  if (state.utilityViewOpen) return "CLOSE_UTILITY_VIEW";
  if (state.utilityMenuOpen) return "CLOSE_UTILITY_MENU";
  if (state.activeTab !== "Home") return "GO_HOME";
  return "EXIT_APP";
}
