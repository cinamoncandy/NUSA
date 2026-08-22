export type ReadOnlyConnectionCode = "CONNECTED" | "NOT_CONFIGURED" | "INVALID_CREDENTIALS" | "IP_NOT_ALLOWED" | "NETWORK_ERROR" | "TIMEOUT" | "PROVIDER_ERROR" | "UNKNOWN_ERROR";
export type ReadOnlyReconciliationStatus = "UNKNOWN" | "MATCH" | "DIFF";

export interface ReadOnlyOperatorProjectionInput {
  readonly observedAt: string;
  readonly connectionCode: ReadOnlyConnectionCode;
  readonly configured: boolean;
  readonly assetCount: number | null;
  readonly openOrderCount: number | null;
  readonly krwBalance: string | null;
  readonly reconciliationStatus: ReadOnlyReconciliationStatus;
}

export interface ReadOnlyOperatorProjection {
  readonly mode: "READ_ONLY";
  readonly observedAt: string;
  readonly connection: Readonly<{ configured: boolean; code: ReadOnlyConnectionCode; available: boolean }>;
  readonly account: Readonly<{ assetCount: number | null; openOrderCount: number | null; krwBalance: string | null }>;
  readonly reconciliation: Readonly<{ status: ReadOnlyReconciliationStatus; healthy: boolean | null }>;
  readonly authority: Readonly<{ execution: false; orderMutation: false; withdrawals: false; credentialMaterial: false }>;
}

function count(value: number | null): number | null {
  return value === null || !Number.isSafeInteger(value) || value < 0 ? null : value;
}

function displayBalance(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  return normalized;
}

/**
 * Produces the only shape intended for operator/mobile observation of authenticated broker state.
 * It deliberately accepts no credentials, tokens, adapters, callbacks, or mutation handles.
 */
export function projectReadOnlyOperatorState(input: ReadOnlyOperatorProjectionInput): ReadOnlyOperatorProjection {
  const reconciliationHealthy = input.reconciliationStatus === "MATCH" ? true : input.reconciliationStatus === "DIFF" ? false : null;
  return Object.freeze({
    mode: "READ_ONLY",
    observedAt: input.observedAt,
    connection: Object.freeze({ configured: input.configured, code: input.connectionCode, available: input.connectionCode === "CONNECTED" }),
    account: Object.freeze({ assetCount: count(input.assetCount), openOrderCount: count(input.openOrderCount), krwBalance: displayBalance(input.krwBalance) }),
    reconciliation: Object.freeze({ status: input.reconciliationStatus, healthy: reconciliationHealthy }),
    authority: Object.freeze({ execution: false, orderMutation: false, withdrawals: false, credentialMaterial: false }),
  });
}
