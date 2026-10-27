import type { MobileRuntimeSnapshot } from "./mobileRuntime";

export type RuntimePresentationStatus =
  | "CONNECTED"
  | "RECOVERING"
  | "DEGRADED"
  | "DISCONNECTED"
  | "AUTH_REQUIRED"
  | "UNAVAILABLE";

export interface RuntimePresentation {
  readonly status: RuntimePresentationStatus;
  readonly label: string;
  readonly detail: string | null;
  readonly motion: "NONE" | "RECOVERY";
}

/**
 * Pure presentation projection. It cannot mutate auth, PAPER, session or runtime.
 * AUTH_REQUIRED is intentionally not inferred from network/recovery state; only
 * the authentication boundary may supply that state.
 */
export function projectRuntimePresentation(
  runtime: MobileRuntimeSnapshot,
  authRequired = false,
): RuntimePresentation {
  if (authRequired) {
    return Object.freeze({
      status: "AUTH_REQUIRED",
      label: "인증 필요",
      detail: null,
      motion: "NONE",
    });
  }

  if (runtime.recovery === "RECOVERING" || runtime.network === "RECOVERING" || runtime.network === "SYNCING") {
    return Object.freeze({
      status: "RECOVERING",
      label: "복구 중",
      detail: runtime.reason ?? null,
      motion: "RECOVERY",
    });
  }

  if (runtime.network === "DEGRADED") {
    return Object.freeze({
      status: "DEGRADED",
      label: "연결 저하",
      detail: runtime.reason ?? null,
      motion: "NONE",
    });
  }

  if (runtime.network === "OFFLINE") {
    return Object.freeze({
      status: "DISCONNECTED",
      label: "연결 안 됨",
      detail: runtime.reason ?? null,
      motion: "NONE",
    });
  }

  if (runtime.recovery === "BLOCKED") {
    return Object.freeze({
      status: "UNAVAILABLE",
      label: "사용 불가",
      detail: runtime.reason ?? null,
      motion: "NONE",
    });
  }

  return Object.freeze({
    status: "CONNECTED",
    label: "연결됨",
    detail: null,
    motion: "NONE",
  });
}
