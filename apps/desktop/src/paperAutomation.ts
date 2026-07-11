import type { ControlPlane } from "./controlPlane";
import type { PaperBroker, PaperOrder } from "./paperBroker";
import type { StrategySignal } from "./strategyEngine";

export type AutomationOutcome = "SKIPPED" | "DUPLICATE" | "FILLED" | "REJECTED";
export interface AutomationResult { outcome: AutomationOutcome; order?: PaperOrder; error?: string; }

export function executeAutomaticPaperSignal(
  control: ControlPlane,
  broker: PaperBroker,
  market: string,
  price: number,
  positionQuantity: number,
  signal: StrategySignal,
  onClaim: () => void = () => undefined
): AutomationResult {
  if (!control.canAutoTrade() || signal.type === "HOLD") return { outcome: "SKIPPED" };
  const key = `${market}:${signal.timestamp}:${signal.type}`;
  if (!control.claimAutomaticSignal(key)) return { outcome: "DUPLICATE" };
  onClaim();
  try {
    if (signal.type === "SELL" && positionQuantity <= 0) return { outcome: "REJECTED", error: "insufficient paper position" };
    const quantity = signal.type === "SELL" ? Math.min(positionQuantity, control.getOrderQuantity()) : control.getOrderQuantity();
    return { outcome: "FILLED", order: broker.execute(signal.type, quantity, price) };
  } catch (error) {
    return { outcome: "REJECTED", error: error instanceof Error ? error.message : String(error) };
  }
}
