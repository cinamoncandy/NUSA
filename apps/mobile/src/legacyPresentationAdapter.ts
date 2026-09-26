import type { PrimaryDestination } from "./navigationContract";

export type LegacyPrimarySurface = "Home" | "Markets" | "AiSignal";
export type LegacyDetailSurface = "Paper" | "Portfolio" | "Order";

/**
 * Temporary compatibility boundary while canonical destinations replace the
 * legacy App.tsx presentation router. Runtime/auth/PAPER layers must not import it.
 */
export function legacySurfaceForPrimary(destination: PrimaryDestination): LegacyPrimarySurface | null {
  switch (destination) {
    case "Home":
      return "Home";
    case "Paper":
    case "Live":
    case "More":
      return null;
  }
}

export function legacyDetailForMore(
  destination: "Portfolio" | "PaperEvidence" | "OrderHistory",
): LegacyDetailSurface {
  switch (destination) {
    case "Portfolio":
      return "Portfolio";
    case "PaperEvidence":
      return "Paper";
    case "OrderHistory":
      return "Order";
  }
}
