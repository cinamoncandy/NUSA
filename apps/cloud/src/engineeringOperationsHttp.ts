import {
  validateNusaEngineeringOperatingSnapshot,
  type NusaEngineeringOperatingSnapshot,
} from "./engineeringOperatingReadModel";
import {
  authorizeDashboardReadRequest,
  dashboardJsonResponse,
  type DashboardHttpRequest,
  type DashboardHttpResponse,
  type DashboardPrincipal,
  type DashboardTokenVerifier,
} from "./mobileDashboardHttp";

export interface EngineeringOperationsHttpDependencies {
  readonly tokenVerifier: DashboardTokenVerifier;
  readonly loadSnapshot: (principal: DashboardPrincipal) => NusaEngineeringOperatingSnapshot;
}

/** Authenticated GET-only Engineering OS projection; it cannot claim or execute work. */
export function handleEngineeringOperationsHttp(
  request: DashboardHttpRequest,
  dependencies: EngineeringOperationsHttpDependencies,
): DashboardHttpResponse {
  const authorization = authorizeDashboardReadRequest(request, dependencies.tokenVerifier);
  if (!authorization.ok) return authorization.response;
  try {
    return dashboardJsonResponse(200, validateNusaEngineeringOperatingSnapshot(dependencies.loadSnapshot(authorization.principal)));
  } catch {
    return dashboardJsonResponse(503, { error: "ENGINEERING_OPERATIONS_UNAVAILABLE" });
  }
}
