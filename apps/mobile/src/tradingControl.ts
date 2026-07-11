export type TradingControlMode = "PAPER_RUNNING" | "PAUSED" | "STOPPED" | "FAULTED";
export type TradingControlCommandType = "EMERGENCY_STOP" | "PAUSE" | "RESUME_PAPER";
export type TradingControlAuthLevel = "STANDARD" | "STRONG";

export interface TradingControlCommand {
  readonly id: string;
  readonly type: TradingControlCommandType;
  readonly actorId: string;
  readonly authLevel: TradingControlAuthLevel;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly reason: string;
}

export interface TradingControlState {
  readonly mode: TradingControlMode;
  readonly lastAcceptedCommandAt: number;
  readonly processedCommandIds: readonly string[];
}

export interface TradingControlContext {
  readonly now: number;
  readonly systemHealthy: boolean;
  readonly killSwitchLatched: boolean;
  readonly maximumCommandLifetimeMs?: number;
}

export interface TradingControlDecision {
  readonly accepted: true;
  readonly state: TradingControlState;
  readonly tradingAllowed: boolean;
  readonly cancelOpenOrders: boolean;
  readonly audit: {
    readonly commandId: string;
    readonly commandType: TradingControlCommandType;
    readonly actorId: string;
    readonly acceptedAt: number;
    readonly resultingMode: TradingControlMode;
    readonly reason: string;
  };
}

const DEFAULT_MAXIMUM_COMMAND_LIFETIME_MS = 5 * 60_000;

const assertText = (value: string, field: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${field} must not be empty`);
  }
  return normalized;
};

const assertTimestamp = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
};

const validateState = (state: TradingControlState): void => {
  assertTimestamp(state.lastAcceptedCommandAt, "lastAcceptedCommandAt");
  const ids = state.processedCommandIds.map((id) => assertText(id, "processedCommandId"));
  if (new Set(ids).size !== ids.length) {
    throw new Error("processedCommandIds must not contain duplicates");
  }
};

const validateCommand = (
  command: TradingControlCommand,
  context: TradingControlContext
): { readonly id: string; readonly actorId: string; readonly reason: string } => {
  assertTimestamp(context.now, "now");
  assertTimestamp(command.issuedAt, "command.issuedAt");
  assertTimestamp(command.expiresAt, "command.expiresAt");

  const maximumLifetime = context.maximumCommandLifetimeMs ?? DEFAULT_MAXIMUM_COMMAND_LIFETIME_MS;
  if (!Number.isSafeInteger(maximumLifetime) || maximumLifetime <= 0) {
    throw new Error("maximumCommandLifetimeMs must be a positive safe integer");
  }
  if (command.expiresAt < command.issuedAt) {
    throw new Error("command.expiresAt must not be earlier than issuedAt");
  }
  if (command.expiresAt - command.issuedAt > maximumLifetime) {
    throw new Error("command lifetime exceeds the allowed maximum");
  }
  if (command.issuedAt > context.now) {
    throw new Error("future-dated command rejected");
  }
  if (command.expiresAt < context.now) {
    throw new Error("expired command rejected");
  }

  return Object.freeze({
    id: assertText(command.id, "command.id"),
    actorId: assertText(command.actorId, "command.actorId"),
    reason: assertText(command.reason, "command.reason")
  });
};

export const applyTradingControlCommand = (
  state: TradingControlState,
  command: TradingControlCommand,
  context: TradingControlContext
): TradingControlDecision => {
  validateState(state);
  const normalized = validateCommand(command, context);

  if (state.processedCommandIds.includes(normalized.id)) {
    throw new Error(`duplicate command id: ${normalized.id}`);
  }
  if (command.issuedAt <= state.lastAcceptedCommandAt) {
    throw new Error("command ordering is stale or non-monotonic");
  }

  let resultingMode: TradingControlMode;
  let cancelOpenOrders = false;

  switch (command.type) {
    case "EMERGENCY_STOP":
      resultingMode = "STOPPED";
      cancelOpenOrders = true;
      break;
    case "PAUSE":
      if (state.mode === "FAULTED") {
        throw new Error("faulted control state cannot be paused");
      }
      resultingMode = "PAUSED";
      break;
    case "RESUME_PAPER":
      if (command.authLevel !== "STRONG") {
        throw new Error("RESUME_PAPER requires strong authentication");
      }
      if (!context.systemHealthy || context.killSwitchLatched || state.mode === "FAULTED") {
        throw new Error("RESUME_PAPER blocked by runtime safety state");
      }
      if (state.mode !== "PAUSED" && state.mode !== "STOPPED") {
        throw new Error("RESUME_PAPER requires PAUSED or STOPPED state");
      }
      resultingMode = "PAPER_RUNNING";
      break;
  }

  const nextState = Object.freeze({
    mode: resultingMode,
    lastAcceptedCommandAt: command.issuedAt,
    processedCommandIds: Object.freeze([...state.processedCommandIds, normalized.id])
  });

  return Object.freeze({
    accepted: true,
    state: nextState,
    tradingAllowed: resultingMode === "PAPER_RUNNING",
    cancelOpenOrders,
    audit: Object.freeze({
      commandId: normalized.id,
      commandType: command.type,
      actorId: normalized.actorId,
      acceptedAt: context.now,
      resultingMode,
      reason: normalized.reason
    })
  });
};
