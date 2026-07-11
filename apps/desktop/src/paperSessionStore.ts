import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PaperBrokerState } from "./paperBroker";

export interface SessionLoadResult<T> {
  state?: T;
  diagnostic?: string;
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
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as PaperBrokerState;
      if (parsed.version !== 1) throw new Error("unsupported paper session version");
      return parsed;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return undefined;
      throw error;
    }
  }

  loadSafe(): SessionLoadResult<PaperBrokerState> {
    try {
      const text = readFileSync(this.filePath, "utf8");
      return { state: validatePaperBrokerState(JSON.parse(text) as unknown) };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return {};
      return { diagnostic: `paper session recovery failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  save(state: PaperBrokerState): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, this.filePath);
  }
}
