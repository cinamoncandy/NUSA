import type { PaperSide } from "../paper/paperBroker";
import { assertLocalSimulationPaperOrderAllowed } from "../paper/desktopPaperAuthorityPolicy";

export function parsePaperOrderIpc(input: unknown): Readonly<{ side: PaperSide; quantity: number }> {
  assertLocalSimulationPaperOrderAllowed();
  if (input == null || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid paper order input");
  const candidate = input as Record<string, unknown>;
  if (
    Object.keys(candidate).sort().join(",") !== "quantity,side" ||
    (candidate.side !== "BUY" && candidate.side !== "SELL") ||
    typeof candidate.quantity !== "number" || !Number.isFinite(candidate.quantity) || candidate.quantity <= 0
  ) throw new Error("invalid paper order input");
  return Object.freeze({ side: candidate.side, quantity: candidate.quantity });
}
