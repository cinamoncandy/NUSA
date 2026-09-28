/**
 * Presentation boundary for the mobile app.
 *
 * App.tsx imports every screen presenter from here and nowhere else. Screen presenters receive
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
