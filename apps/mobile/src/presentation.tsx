/**
 * Presentation boundary for the mobile app.
 *
 * App.tsx imports every screen presenter, shared primitive and theme provider from here and
 * nowhere else (enforced by tests/mobile-presentation-boundary.test.js). Screen presenters receive
 * already-derived screen models (for example buildHomeFieldInput, buildPaperFieldHeader,
 * buildLiveFieldHeader) and design tokens (designSystem.ts: fieldPalette, fieldMotion; fieldFonts),
 * so a future redesign replaces presenters here without touching data, safety or navigation.
 *
 * The current presenters are the interim "field-v1" design. See docs/UI_ARCHITECTURE.md.
 */
export const PRESENTATION = Object.freeze({ id: "field-v1", status: "INTERIM" as const });

export { HomeView, type HomeDestination } from "./homeView";
export { PaperShadowMonitorView } from "./paperShadowMonitorView";
export { LiveReadinessMonitorView } from "./liveReadinessMonitorView";
export { MoreMenuView } from "./moreMenuView";
export { TabTransition } from "./tabTransition";
export { PortfolioView } from "./portfolioView";
export { NotificationView } from "./notificationView";
export { SettingsView } from "./settingsView";
export { OrderHistoryView } from "./orderHistoryView";
export { StrategiesView } from "./strategiesView";
export { MoreDetailView, type TruthfulMoreDetail } from "./moreDetailView";
export { PrimaryNavigation } from "./primaryNavigation";
export { SafetyLine } from "./safetyLine";
export { PerformanceView } from "./performanceView";
// Shared primitives and theming the shell renders directly.
export { NusaButton, NusaCard, StatusChip, WaveMark } from "./components";
export { ThemeProvider, useTheme, type ThemePreference } from "./ThemeProvider";
