import type { PersonalPaperOperationsSnapshot } from "../../../packages/contracts/src/personalPaperOperations";
import {
  authorizeDashboardReadRequest,
  dashboardJsonResponse,
  type DashboardHttpRequest,
  type DashboardHttpResponse,
  type DashboardPrincipal,
  type DashboardTokenVerifier
} from "./mobileDashboardHttp";

export interface PersonalPaperOperationsHttpDependencies {
  readonly tokenVerifier: DashboardTokenVerifier;
  readonly loadSnapshot: (principal: DashboardPrincipal) => PersonalPaperOperationsSnapshot;
}

/**
 * Read-only PAPER/Research operations projection. It deliberately shares the same authenticated
 * `dashboard:read` boundary as the existing mobile dashboard and exposes no mutation method.
 */
export function handlePersonalPaperOperationsHttp(
  request: DashboardHttpRequest,
  dependencies: PersonalPaperOperationsHttpDependencies
): DashboardHttpResponse {
  const authorization = authorizeDashboardReadRequest(request, dependencies.tokenVerifier);
  if (!authorization.ok) return authorization.response;

  try {
    const snapshot = dependencies.loadSnapshot(authorization.principal);
    if (snapshot.liveAuthority !== "NONE" || snapshot.productionMutationAllowed !== false) {
      return dashboardJsonResponse(503, { error: "PAPER_OPERATIONS_AUTHORITY_VIOLATION" });
    }
    return dashboardJsonResponse(200, snapshot);
  } catch {
    return dashboardJsonResponse(503, { error: "PAPER_OPERATIONS_UNAVAILABLE" });
  }
}
