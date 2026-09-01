/**
 * Maps App.tsx's navigation state (activeTab / utilityView) to a UX telemetry screenId, and
 * generates a per-app-launch session id.
 *
 * Kept as pure, testable logic separate from App.tsx: App.tsx only needs to call
 * screenIdForNavigationState() inside a useEffect keyed on [activeTab, utilityView] and feed the
 * result into emitUxTelemetryEvent (uxTelemetryClient.ts) -- it does not decide whether telemetry
 * is enabled, does not manage settings, and renders nothing.
 */

export function screenIdForNavigationState(activeTab: string, utilityView: string | null): string {
  return utilityView ?? activeTab;
}

/** One id per app process lifetime; not persisted, not derived from any user identity. */
export function createUxTelemetrySessionId(now: number = Date.now(), random: () => number = Math.random): string {
  return `mobile-${now}-${random().toString(36).slice(2, 10)}`;
}
