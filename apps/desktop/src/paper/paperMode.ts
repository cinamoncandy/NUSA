export type DesktopPaperMode = "CLOUD_PAPER" | "LOCAL_SIMULATION" | "READ_ONLY_REAL";

export interface ResolveDesktopPaperModeInput {
  readonly packaged: boolean;
  readonly requestedMode?: string | null;
}

/**
 * Packaged Desktop is a Cloud PAPER client by default. Local simulation is intentionally
 * development-only and can never become an implicit fallback when Cloud is unavailable.
 */
export function resolveDesktopPaperMode(input: ResolveDesktopPaperModeInput): DesktopPaperMode {
  const requested = input.requestedMode?.trim().toUpperCase();
  if (!requested) return "CLOUD_PAPER";
  if (requested === "CLOUD_PAPER") return "CLOUD_PAPER";
  if (requested === "READ_ONLY_REAL") return "READ_ONLY_REAL";
  if (requested === "LOCAL_SIMULATION") {
    if (input.packaged) throw new Error("LOCAL_SIMULATION is prohibited in packaged Desktop runtime.");
    return "LOCAL_SIMULATION";
  }
  throw new Error("Unknown Desktop PAPER mode.");
}

export const desktopPaperModeCanMutateLocalBroker = (mode: DesktopPaperMode): boolean => mode === "LOCAL_SIMULATION";
export const desktopPaperModeCanSubmitCloudPaper = (mode: DesktopPaperMode): boolean => mode === "CLOUD_PAPER";
