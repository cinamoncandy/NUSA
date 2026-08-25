import type { PaperBrokerState } from "./paperBroker";
import { loadJsonWithBackup, writeJsonWithBackup } from "../recovery/sessionRecovery";

export interface SessionLoadResult<T> {
  readonly state?: T;
  readonly diagnostic?: string;
  readonly restoredFromBackup?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function validatePaperBrokerState(value: unknown): PaperBrokerState {
  if (!isRecord(value) || value.version !== 1) throw new Error("unsupported or missing paper session version");
  if (!isFiniteNumber(value.cash) || value.cash < 0) throw new Error("invalid paper session cash");
  if (!isFiniteNumber(value.feeRate) || value.feeRate < 0) throw new Error("invalid paper session fee rate");
  if (!isRecord(value.position) || typeof value.position.market !== "string" ||
      !isFiniteNumber(value.position.quantity) || value.position.quantity < 0 ||
      !isFiniteNumber(value.position.averagePrice) || value.position.averagePrice < 0 ||
      !isFiniteNumber(value.position.realizedPnl)) throw new Error("invalid paper session position");
  if (!Array.isArray(value.orders)) throw new Error("invalid paper session orders");
  for (const order of value.orders) {
    if (!isRecord(order) || typeof order.id !== "string" || typeof order.market !== "string" ||
        (order.side !== "BUY" && order.side !== "SELL") || !isFiniteNumber(order.quantity) || order.quantity <= 0 ||
        !isFiniteNumber(order.price) || order.price <= 0 || !isFiniteNumber(order.fee) || order.fee < 0 ||
        typeof order.filledAt !== "string") throw new Error("invalid paper session order");
  }
  return value as unknown as PaperBrokerState;
}

export class PaperSessionStore {
  constructor(private readonly filePath: string) {}

  load(): PaperBrokerState | undefined {
    const result = loadJsonWithBackup(this.filePath, validatePaperBrokerState, "paper session");
    if (result.diagnostic) throw new Error(result.diagnostic);
    return result.state;
  }

  loadSafe(): SessionLoadResult<PaperBrokerState> {
    return loadJsonWithBackup(this.filePath, validatePaperBrokerState, "paper session");
  }

  save(state: PaperBrokerState): void {
    writeJsonWithBackup(this.filePath, state);
  }
}

