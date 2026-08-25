import type { ControlEvent, ControlPlaneState, ControlStatus } from "./controlPlane";
import type { SessionLoadResult } from "../paper/paperSessionStore";
import { loadJsonWithBackup, writeJsonWithBackup } from "../recovery/sessionRecovery";

const statuses: readonly ControlStatus[] = ["STOPPED", "RUNNING", "PAUSED", "FAULTED"];
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function validateEvent(value: unknown): value is ControlEvent {
  return isRecord(value) && typeof value.id === "string" && typeof value.type === "string" &&
    typeof value.message === "string" && typeof value.timestamp === "string";
}

function validateState(value: unknown): ControlPlaneState {
  if (!isRecord(value) || value.version !== 1 || !statuses.includes(value.status as ControlStatus) ||
      typeof value.strategyId !== "string" || typeof value.orderQuantity !== "number" ||
      !Number.isFinite(value.orderQuantity) || value.orderQuantity <= 0 || !Array.isArray(value.events) ||
      !value.events.every(validateEvent) || !Array.isArray(value.processedSignalKeys) ||
      !value.processedSignalKeys.every((key) => typeof key === "string")) throw new Error("invalid control session state");
  return value as unknown as ControlPlaneState;
}

export class ControlSessionStore {
  constructor(private readonly filePath: string) {}

  loadSafe(): SessionLoadResult<ControlPlaneState> {
    return loadJsonWithBackup(this.filePath, validateState, "control session");
  }

  save(state: ControlPlaneState): void {
    writeJsonWithBackup(this.filePath, state);
  }
}

