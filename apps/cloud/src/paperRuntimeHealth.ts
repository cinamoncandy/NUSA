import { evaluateComponentHealth, type ComponentHealthResult } from "./componentHealth";
import type { CloudRuntimeLivenessSnapshot } from "./server";

export interface PaperRuntimeHealthPolicy {
  readonly heartbeatStaleAfterMs: number;
  readonly marketEventStaleAfterMs: number;
}

export interface PaperRuntimeHealthProjection {
  readonly process: ComponentHealthResult;
  readonly workload: ComponentHealthResult;
}

export function projectPaperRuntimeHealth(
  liveness: CloudRuntimeLivenessSnapshot & { readonly lastAcceptedMarketReceiptAt?: number | null; readonly lastFailureAt?: number | null },
  now: number,
  policy: PaperRuntimeHealthPolicy,
): PaperRuntimeHealthProjection {
  const process = evaluateComponentHealth({
    componentId: "PAPER_PROCESS",
    now,
    policy: { staleAfterMs: policy.heartbeatStaleAfterMs },
    latest: {
      componentId: "PAPER_PROCESS",
      signal: liveness.lastError == null ? "PASS" : "DEGRADED",
      observedAt: liveness.lastHeartbeatAt,
      provenance: "cloud-runtime-heartbeat",
      evidenceId: `heartbeat:${liveness.startedAt}:${liveness.lastHeartbeatAt}`,
    },
  });

  const workload = evaluateComponentHealth({
    componentId: "PAPER_WORKLOAD",
    now,
    policy: { staleAfterMs: policy.marketEventStaleAfterMs },
    ...(liveness.lastAcceptedMarketReceiptAt == null ? {} : {
      latest: {
        componentId: "PAPER_WORKLOAD",
        signal: liveness.lastError == null ? "PASS" as const : "DEGRADED" as const,
        observedAt: liveness.lastAcceptedMarketReceiptAt,
        provenance: "cloud-paper-market-events",
        evidenceId: `market-event:${liveness.startedAt}:${liveness.lastAcceptedMarketReceiptAt}:${liveness.eventCount}`,
      },
    }),
    ...(liveness.lastFailureAt == null ? {} : { previousFailure: {
      componentId: "PAPER_WORKLOAD" as const,
      signal: "FAIL" as const,
      observedAt: liveness.lastFailureAt,
      provenance: "cloud-runtime-failure",
      evidenceId: `failure:${liveness.startedAt}:${liveness.lastFailureAt}`,
    } }),
  });

  return Object.freeze({ process, workload });
}
