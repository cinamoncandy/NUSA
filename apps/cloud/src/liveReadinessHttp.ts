import {
  dashboardJsonResponse,
  authorizeDashboardReadRequest,
  type DashboardHttpRequest,
  type DashboardHttpResponse,
  type DashboardPrincipal,
  type DashboardTokenVerifier,
} from "./mobileDashboardHttp";
import { projectLiveReadinessObservabilitySnapshot } from "./liveReadinessProjection";
import type { LiveReadinessProductionSourceSnapshot } from "./liveReadinessSourceProvider";

export interface LiveReadinessHttpDependencies {
  readonly tokenVerifier: DashboardTokenVerifier;
  readonly loadSnapshot: (principal: DashboardPrincipal) => LiveReadinessProductionSourceSnapshot;
}

/** Authenticated GET-only LIVE preparation observability. It contains no activation sibling. */
export function handleLiveReadinessHttp(
  request: DashboardHttpRequest,
  dependencies: LiveReadinessHttpDependencies,
): DashboardHttpResponse {
  const authorization = authorizeDashboardReadRequest(request, dependencies.tokenVerifier);
  if (!authorization.ok) return authorization.response;
  try {
    return dashboardJsonResponse(200, projectLiveReadinessObservabilitySnapshot(dependencies.loadSnapshot(authorization.principal)));
  } catch {
    return dashboardJsonResponse(503, { error: "LIVE_READINESS_UNAVAILABLE" });
  }
}
