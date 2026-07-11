import {
  ControlAuditEvent,
  ControlCommandRequest,
  ControlCommandResult,
  ControlRuntimeSnapshot
} from "../../../packages/contracts/src/controlPlane";

export interface ControlCommandProcessorState {
  readonly runtime: ControlRuntimeSnapshot;
  readonly processedCommandIds: ReadonlySet<string>;
}

export interface ProcessControlCommandInput {
  readonly now: number;
  readonly request: ControlCommandRequest;
  readonly state: ControlCommandProcessorState;
}

const assertText = (value: string, field: string): void => {
  if (value.trim().length === 0) {
    throw new Error(`${field} must not be empty`);
  }
};

const assertTimestamp = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
};

const freezeRuntime = (runtime: ControlRuntimeSnapshot): ControlRuntimeSnapshot => Object.freeze({ ...runtime });

const audit = (
  request: ControlCommandRequest,
  now: number,
  status: ControlAuditEvent["status"],
  reason: string,
  runtime: ControlRuntimeSnapshot,
  cancelOpenOrders: boolean
): ControlAuditEvent => Object.freeze({
  commandId: request.id.trim(),
  userId: request.userId.trim(),
  deviceId: request.deviceId.trim(),
  type: request.type,
  status,
  decidedAt: now,
  reason,
  resultingMode: runtime.mode,
  cancelOpenOrders
});

export const processControlCommand = ({ now, request, state }: ProcessControlCommandInput): ControlCommandResult => {
  assertTimestamp(now, "now");
  assertText(request.id, "request.id");
  assertText(request.userId, "request.userId");
  assertText(request.deviceId, "request.deviceId");
  assertText(request.reason, "request.reason");
  assertTimestamp(request.issuedAt, "request.issuedAt");
  assertTimestamp(request.expiresAt, "request.expiresAt");

  if (request.expiresAt < request.issuedAt) {
    throw new Error("request.expiresAt must not precede request.issuedAt");
  }
  if (request.issuedAt > now) {
    throw new Error("future-issued control command rejected");
  }

  const current = freezeRuntime(state.runtime);
  const id = request.id.trim();
  if (state.processedCommandIds.has(id)) {
    return Object.freeze({
      status: "DUPLICATE",
      runtime: current,
      audit: audit(request, now, "DUPLICATE", "command already processed", current, false)
    });
  }
  if (request.expiresAt < now) {
    return Object.freeze({
      status: "REJECTED",
      runtime: current,
      audit: audit(request, now, "REJECTED", "command expired", current, false)
    });
  }
  if (current.lastAcceptedCommandAt !== undefined && request.issuedAt <= current.lastAcceptedCommandAt) {
    return Object.freeze({
      status: "REJECTED",
      runtime: current,
      audit: audit(request, now, "REJECTED", "command ordering violation", current, false)
    });
  }

  let next: ControlRuntimeSnapshot;
  let cancelOpenOrders = false;

  switch (request.type) {
    case "PAUSE":
      next = freezeRuntime({ ...current, mode: "STOPPED", lastAcceptedCommandAt: request.issuedAt });
      break;
    case "EMERGENCY_STOP":
      cancelOpenOrders = true;
      next = freezeRuntime({ ...current, mode: "STOPPED", killSwitchActive: true, lastAcceptedCommandAt: request.issuedAt });
      break;
    case "RESUME_PAPER":
      if (request.authStrength !== "STRONG") {
        return Object.freeze({
          status: "REJECTED",
          runtime: current,
          audit: audit(request, now, "REJECTED", "strong authentication required", current, false)
        });
      }
      if (!current.healthy || current.killSwitchActive || current.mode === "FAULTED") {
        return Object.freeze({
          status: "REJECTED",
          runtime: current,
          audit: audit(request, now, "REJECTED", "runtime is not safe to resume", current, false)
        });
      }
      next = freezeRuntime({ ...current, mode: "PAPER", lastAcceptedCommandAt: request.issuedAt });
      break;
    default: {
      const exhaustive: never = request.type;
      throw new Error(`unsupported command: ${exhaustive}`);
    }
  }

  return Object.freeze({
    status: "ACCEPTED",
    runtime: next,
    audit: audit(request, now, "ACCEPTED", "command accepted", next, cancelOpenOrders)
  });
};
