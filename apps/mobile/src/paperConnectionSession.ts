export type PaperConnectionStatus = "NOT_CONFIGURED" | "READY" | "UNAVAILABLE";

export interface PaperConnectionState {
  readonly status: PaperConnectionStatus;
  readonly endpoint: string | null;
  readonly reason: string;
  readonly verifiedAt: number | null;
}

const normalizeEndpoint = (value: string): string | null => {
  const endpoint = value.trim().replace(/\/+$/, "");
  return endpoint || null;
};

let state: PaperConnectionState = Object.freeze({
  status: "NOT_CONFIGURED",
  endpoint: null,
  reason: "PAPER endpoint and credential are not verified.",
  verifiedAt: null
});

/**
 * Process-memory truth for the endpoint-bound verified PAPER session.
 * The endpoint is non-secret and may also be persisted in app settings; credentials never enter this module.
 */
export function getPaperConnectionState(): PaperConnectionState { return state; }
export function getConfiguredPaperEndpoint(): string | null { return state.endpoint; }

export function setConfiguredPaperEndpoint(value: string): void {
  const endpoint = normalizeEndpoint(value);
  if (state.endpoint === endpoint) return;
  state = Object.freeze({
    status: "NOT_CONFIGURED",
    endpoint,
    reason: endpoint == null ? "PAPER endpoint is not configured." : "PAPER endpoint changed and must be verified again.",
    verifiedAt: null
  });
}

export function markPaperConnectionReady(endpointValue: string, verifiedAt = Date.now()): void {
  const endpoint = normalizeEndpoint(endpointValue);
  if (endpoint == null) throw new Error("PAPER endpoint is not configured.");
  if (!Number.isSafeInteger(verifiedAt) || verifiedAt < 0) throw new Error("verifiedAt is invalid.");
  state = Object.freeze({ status: "READY", endpoint, reason: "Verified PAPER connection is ready.", verifiedAt });
}

export function markPaperConnectionUnavailable(endpointValue: string, reason: string): void {
  const endpoint = normalizeEndpoint(endpointValue);
  state = Object.freeze({
    status: "UNAVAILABLE",
    endpoint,
    reason: reason.trim() || "PAPER connection is unavailable.",
    verifiedAt: null
  });
}

export function clearPaperConnectionSession(endpointValue = ""): void {
  const endpoint = normalizeEndpoint(endpointValue);
  state = Object.freeze({
    status: "NOT_CONFIGURED",
    endpoint,
    reason: endpoint == null ? "PAPER endpoint and credential are not configured." : "PAPER credential is not configured.",
    verifiedAt: null
  });
}
