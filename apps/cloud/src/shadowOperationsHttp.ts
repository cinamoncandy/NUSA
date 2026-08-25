import {
  validateShadowObservabilitySnapshot,
  type ShadowObservabilitySnapshot
} from "../../../packages/contracts/src/shadowObservabilityReadOnly";
import {
  authorizeDashboardReadRequest,
  dashboardJsonResponse,
  type DashboardHttpRequest,
  type DashboardHttpResponse,
  type DashboardPrincipal,
  type DashboardTokenVerifier
} from "./mobileDashboardHttp";

export interface ShadowOperationsHttpDependencies {
  readonly tokenVerifier: DashboardTokenVerifier;
  readonly loadSnapshot: (principal: DashboardPrincipal) => ShadowObservabilitySnapshot;
}

/** Authenticated GET-only Shadow observability transport. It never exposes a mutation handler. */
export function handleShadowOperationsHttp(
  request: DashboardHttpRequest,
  dependencies: ShadowOperationsHttpDependencies
): DashboardHttpResponse {
  const authorization = authorizeDashboardReadRequest(request, dependencies.tokenVerifier);
  if (!authorization.ok) return authorization.response;
  try {
    const snapshot = validateShadowObservabilitySnapshot(dependencies.loadSnapshot(authorization.principal));
    return dashboardJsonResponse(200, snapshot);
  } catch {
    return dashboardJsonResponse(503, { error: "SHADOW_OPERATIONS_UNAVAILABLE" });
  }
}

