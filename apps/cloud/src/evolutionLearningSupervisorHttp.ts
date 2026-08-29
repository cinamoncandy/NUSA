import type { EvolutionLearningSupervisorSnapshot } from "../../../packages/contracts/src/evolutionLearningSupervisor";
import { validateEvolutionLearningSupervisorSnapshot } from "../../../packages/contracts/src/evolutionLearningSupervisor";
import { authorizeDashboardReadRequest, dashboardJsonResponse, type DashboardHttpRequest, type DashboardHttpResponse, type DashboardPrincipal, type DashboardTokenVerifier } from "./mobileDashboardHttp";

export interface EvolutionLearningSupervisorHttpDependencies {
  readonly tokenVerifier: DashboardTokenVerifier;
  readonly loadSnapshot: (principal: DashboardPrincipal) => EvolutionLearningSupervisorSnapshot;
}

export function handleEvolutionLearningSupervisorHttp(
  request: DashboardHttpRequest,
  dependencies: EvolutionLearningSupervisorHttpDependencies,
): DashboardHttpResponse {
  const authorization = authorizeDashboardReadRequest(request, dependencies.tokenVerifier);
  if (!authorization.ok) return authorization.response;
  try {
    const snapshot = validateEvolutionLearningSupervisorSnapshot(dependencies.loadSnapshot(authorization.principal));
    if (
      snapshot.authority !== "READ_ONLY"
      || snapshot.scope !== "EVOLUTION_LEARNING_EVIDENCE_ONLY"
      || snapshot.aiAuthority !== "ZERO_AUTHORITY"
      || snapshot.liveAuthority !== "NONE"
      || snapshot.productionMutationAllowed !== false
    ) {
      return dashboardJsonResponse(503, { error: "EVOLUTION_LEARNING_AUTHORITY_VIOLATION" });
    }
    return dashboardJsonResponse(200, snapshot);
  } catch {
    return dashboardJsonResponse(503, { error: "EVOLUTION_LEARNING_UNAVAILABLE" });
  }
}
