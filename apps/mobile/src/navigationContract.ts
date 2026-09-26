export const PRIMARY_DESTINATIONS = ["Home", "Paper", "Live", "More"] as const;
export type PrimaryDestination = (typeof PRIMARY_DESTINATIONS)[number];

export const primaryDestinationLabels: Readonly<Record<PrimaryDestination, string>> = Object.freeze({
  Home: "HOME",
  Paper: "PAPER",
  Live: "LIVE",
  More: "MORE",
});

export const primaryDestinationDisplayLabels: Readonly<Record<PrimaryDestination, string>> = Object.freeze({
  Home: "NUSA",
  Paper: "PAPER",
  Live: "LIVE",
  More: "더보기",
});

export type MoreDestination =
  | "Strategies"
  | "Portfolio"
  | "Risk"
  | "Performance"
  | "PaperEvidence"
  | "OrderHistory"
  | "SystemStatus"
  | "Notifications"
  | "Settings"
  | "Help";

export const MORE_DESTINATIONS: readonly MoreDestination[] = Object.freeze([
  "Strategies",
  "Portfolio",
  "Risk",
  "Performance",
  "PaperEvidence",
  "OrderHistory",
  "SystemStatus",
  "Notifications",
  "Settings",
  "Help",
]);

/**
 * Presentation-only navigation contract.
 * Runtime, PAPER, auth and authority layers must not import this module.
 */
export function isPrimaryDestination(value: string): value is PrimaryDestination {
  return (PRIMARY_DESTINATIONS as readonly string[]).includes(value);
}
