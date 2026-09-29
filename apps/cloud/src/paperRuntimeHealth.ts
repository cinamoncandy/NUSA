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
  liveness: CloudRuntimeLivenessSnapshot,
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
    ...(liveness.lastMarketEventAt == null ? {} : {
      latest: {
        componentId: "PAPER_WORKLOAD",
        signal: liveness.lastError == null ? "PASS" as const : "DEGRADED" as const,
        observedAt: liveness.lastMarketEventAt,
        provenance: "cloud-paper-market-events",
        evidenceId: `market-event:${liveness.startedAt}:${liveness.lastMarketEventAt}:${liveness.eventCount}`,
      },
    }),
  });

  return Object.freeze({ process, workload });
}
