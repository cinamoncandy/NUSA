import {
  validateRealReadOnlyObservabilitySnapshot,
  type RealReadOnlyObservabilitySnapshot
} from "../../../packages/contracts/src/realReadOnlyObservability";
import {
  authorizeDashboardReadRequest,
  dashboardJsonResponse,
  type DashboardHttpRequest,
  type DashboardHttpResponse,
  type DashboardPrincipal,
  type DashboardTokenVerifier
} from "./mobileDashboardHttp";

export interface RealReadOnlyOperationsHttpDependencies {
  readonly tokenVerifier: DashboardTokenVerifier;
  readonly loadSnapshot: (principal: DashboardPrincipal) => RealReadOnlyObservabilitySnapshot;
}

/**
 * Authenticated GET-only REAL_READ_ONLY observability transport, mirroring the Shadow one.
 *
 * authorizeDashboardReadRequest pins both the method (GET) and the scope (dashboard:read), so
 * this module exposes no verb that could mutate a real account -- there is deliberately no
 * sibling handler here the way PAPER has handlePersonalPaperOrderHttp.
 *
 * The snapshot is re-validated on the way out rather than trusted from the loader: redaction and
 * the zero-mutation counter invariant must hold at the boundary that actually leaves the process,
 * not only where the snapshot was assembled.
 */
export function handleRealReadOnlyOperationsHttp(
  request: DashboardHttpRequest,
  dependencies: RealReadOnlyOperationsHttpDependencies
): DashboardHttpResponse {
  const authorization = authorizeDashboardReadRequest(request, dependencies.tokenVerifier);
  if (!authorization.ok) return authorization.response;
  try {
    const snapshot = validateRealReadOnlyObservabilitySnapshot(dependencies.loadSnapshot(authorization.principal));
    return dashboardJsonResponse(200, snapshot);
  } catch {
    // Fail closed with a fixed code: a validation failure here can mean redaction did not hold,
    // so the reason must never be echoed back to the caller.
    return dashboardJsonResponse(503, { error: "REAL_READONLY_OPERATIONS_UNAVAILABLE" });
  }
}
