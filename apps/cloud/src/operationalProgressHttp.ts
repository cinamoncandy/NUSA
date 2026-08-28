import type { OperationalProgressSnapshot } from "../../../packages/contracts/src/operationalProgress";
import { validateOperationalProgressSnapshot } from "../../../packages/contracts/src/operationalProgress";
import { authorizeDashboardReadRequest, dashboardJsonResponse, type DashboardHttpRequest, type DashboardHttpResponse, type DashboardPrincipal, type DashboardTokenVerifier } from "./mobileDashboardHttp";

export interface OperationalProgressHttpDependencies {
  readonly tokenVerifier: DashboardTokenVerifier;
  readonly loadSnapshot: (principal: DashboardPrincipal) => OperationalProgressSnapshot;
}

export function handleOperationalProgressHttp(request: DashboardHttpRequest, dependencies: OperationalProgressHttpDependencies): DashboardHttpResponse {
  const authorization = authorizeDashboardReadRequest(request, dependencies.tokenVerifier);
  if (!authorization.ok) return authorization.response;
  try {
    const snapshot = validateOperationalProgressSnapshot(dependencies.loadSnapshot(authorization.principal));
    if (snapshot.authority !== "READ_ONLY" || snapshot.scope !== "OPERATIONAL_EVIDENCE_ONLY") return dashboardJsonResponse(503, { error: "OPERATIONAL_PROGRESS_AUTHORITY_VIOLATION" });
    return dashboardJsonResponse(200, snapshot);
  } catch {
    return dashboardJsonResponse(503, { error: "OPERATIONAL_PROGRESS_UNAVAILABLE" });
  }
}
