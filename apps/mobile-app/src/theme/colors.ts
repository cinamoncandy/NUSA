/** Same palette as apps/web/styles.css's :root custom properties -- kept in sync by eye so the
 * mobile app reads as the same product, not a different app that happens to talk to the same API. */
export const colors = {
  bg: "#0a0c10",
  surface: "#14171d",
  surfaceRaised: "#1b2029",
  border: "rgba(255, 255, 255, 0.12)",
  fg: "#eef1f5",
  muted: "#8891a0",
  primary: "#5b8cff",
  success: "#34d399",
  warning: "#f3b13d",
  danger: "#f2596b"
} as const;
