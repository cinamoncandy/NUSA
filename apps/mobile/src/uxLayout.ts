import type { Theme } from "./designSystem";

export const uxLayout = Object.freeze({
  maxWorkspaceWidth: 1080,
  phoneGutter: 20,
  wideGutter: 24,
  compactBreakpoint: 600,
  wideBreakpoint: 840,
  summaryColumnWidth: 360,
  sectionGap: 24,
  contentGap: 14,
  metricGap: 10,
});

export function screenTokens(theme: Theme) {
  return Object.freeze({
    background: theme.colors.background,
    horizontalPadding: uxLayout.phoneGutter,
    topPadding: 18,
    bottomPadding: 32,
    maxWidth: uxLayout.maxWorkspaceWidth,
    sectionGap: uxLayout.sectionGap,
    contentGap: uxLayout.contentGap,
  });
}

export function metricTone(theme: Theme, tone: "default" | "primary" | "success" | "warning" | "danger" | "info" = "default") {
  const accent = tone === "primary" ? theme.colors.primary
    : tone === "success" ? theme.colors.success
      : tone === "warning" ? theme.colors.warning
        : tone === "danger" ? theme.colors.danger
          : tone === "info" ? theme.colors.info
            : theme.colors.borderStrong;
  return Object.freeze({
    accent,
    background: tone === "primary" ? theme.colors.primarySoft : theme.colors.surface,
    border: tone === "default" ? theme.colors.border : accent,
  });
}
