/**
 * Pure, Electron-free builders and a formatter for structured Paper runtime persistence
 * failure diagnostics. No Electron import -- RuntimeCommandService calls these builders
 * and forwards the result through an injected callback; main.ts decides how (and whether)
 * to log them, keeping RuntimeCommandService itself free of any console/IO dependency.
 */

export type RuntimeMutationDiagnosticKind =
  | "PERSISTENCE_MUTATION_FAILED"
  | "PERSISTENCE_ROLLBACK_COMPLETED"
  | "PERSISTENCE_ROLLBACK_FAILED"
  | "PAPER_TRADING_DISABLED"
  | "AUTOMATIC_EXECUTION_BLOCKED";

export interface RuntimeMutationDiagnostic {
  readonly kind: RuntimeMutationDiagnosticKind;
  readonly timestamp: number;
  readonly message: string;
  readonly details: Readonly<Record<string, string | number | boolean>>;
}

const LOG_PREFIX = "[NUSA_DESKTOP]";

export function formatRuntimeMutationDiagnostic(diagnostic: RuntimeMutationDiagnostic): string {
  return `${LOG_PREFIX} ${JSON.stringify({
    kind: diagnostic.kind,
    timestamp: diagnostic.timestamp,
    message: diagnostic.message,
    details: diagnostic.details
  })}`;
}

/** Never stores a raw Error object or a full stack -- first line only, length-bounded. */
function sanitizeMessage(message: string, maximumLength = 500): string {
  const firstLine = message.split("\n")[0] ?? "";
  return firstLine.length > maximumLength ? `${firstLine.slice(0, maximumLength)}…` : firstLine;
}

export interface PersistenceMutationFailedInput {
  readonly mutationName: string;
}

export function createPersistenceMutationFailedDiagnostic(input: PersistenceMutationFailedInput, now: number = Date.now()): RuntimeMutationDiagnostic {
  return {
    kind: "PERSISTENCE_MUTATION_FAILED",
    timestamp: now,
    message: `Persistence write failed during "${input.mutationName}"`,
    details: { mutationName: input.mutationName }
  };
}

export interface PersistenceRollbackCompletedInput {
  readonly mutationName: string;
}

export function createPersistenceRollbackCompletedDiagnostic(input: PersistenceRollbackCompletedInput, now: number = Date.now()): RuntimeMutationDiagnostic {
  return {
    kind: "PERSISTENCE_ROLLBACK_COMPLETED",
    timestamp: now,
    message: `Runtime state restored to its pre-"${input.mutationName}" snapshot`,
    details: { mutationName: input.mutationName, rollbackSucceeded: true }
  };
}

export interface PersistenceRollbackFailedInput {
  readonly mutationName: string;
  readonly restoreErrorMessage: string;
}

export function createPersistenceRollbackFailedDiagnostic(input: PersistenceRollbackFailedInput, now: number = Date.now()): RuntimeMutationDiagnostic {
  const restoreErrorMessage = sanitizeMessage(input.restoreErrorMessage);
  return {
    kind: "PERSISTENCE_ROLLBACK_FAILED",
    timestamp: now,
    message: `Runtime state rollback after "${input.mutationName}" itself failed: ${restoreErrorMessage}`,
    details: { mutationName: input.mutationName, rollbackSucceeded: false, restoreErrorMessage }
  };
}

export interface PaperTradingDisabledInput {
  readonly mutationName: string;
  readonly controlStatus: string;
}

export function createPaperTradingDisabledDiagnostic(input: PaperTradingDisabledInput, now: number = Date.now()): RuntimeMutationDiagnostic {
  return {
    kind: "PAPER_TRADING_DISABLED",
    timestamp: now,
    message: `Paper Trading disabled after "${input.mutationName}"; operator repair required before resuming`,
    details: { mutationName: input.mutationName, paperTradingAvailable: false, automaticTradingEnabled: false, controlStatus: input.controlStatus }
  };
}

export function createAutomaticExecutionBlockedDiagnostic(now: number = Date.now()): RuntimeMutationDiagnostic {
  return {
    kind: "AUTOMATIC_EXECUTION_BLOCKED",
    timestamp: now,
    message: "Automatic signal claiming and order execution blocked until Paper Trading is repaired",
    details: { automaticTradingEnabled: false }
  };
}
