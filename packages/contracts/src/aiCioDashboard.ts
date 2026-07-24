export const AI_CIO_DASHBOARD_CHANNEL = "ai-cio:dashboard:get" as const;

export interface AiCioDashboardReadFailure {
  readonly ok: false;
  readonly status: "NO_DATA" | "UNAVAILABLE";
  readonly message: "AI CIO dashboard is not available";
}

export interface AiCioDashboardReadSuccess<T> {
  readonly ok: true;
  readonly snapshot: T;
}

export type AiCioDashboardReadResult<T> = AiCioDashboardReadSuccess<T> | AiCioDashboardReadFailure;
