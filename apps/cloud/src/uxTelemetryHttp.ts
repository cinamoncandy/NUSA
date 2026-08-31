import {
  authorizeUxTelemetryWriteRequest,
  dashboardJsonResponse,
  type DashboardHttpRequest,
  type DashboardHttpResponse,
  type DashboardTokenVerifier,
} from "./mobileDashboardHttp";
import { appendUxTelemetryEvent, type UxTelemetryStorage } from "./uxTelemetryJournal";

export interface UxTelemetryHttpDependencies {
  readonly tokenVerifier: DashboardTokenVerifier;
  readonly storage: UxTelemetryStorage;
}

/**
 * Ingests one client-emitted UX telemetry event (see uxTelemetryEvent.ts / uxTelemetryJournal.ts).
 *
 * The event's ownerPrincipalId is always overwritten with the authenticated principal's own
 * userId before validation -- a client can never claim to be emitting telemetry on behalf of a
 * different owner. This is the only trust boundary this handler adds on top of
 * appendUxTelemetryEvent's own fail-closed validation and dedup/bound behavior.
 */
export async function handleUxTelemetryEventHttp(
  request: DashboardHttpRequest,
  body: unknown,
  dependencies: UxTelemetryHttpDependencies,
): Promise<DashboardHttpResponse> {
  const authorization = authorizeUxTelemetryWriteRequest(request, dependencies.tokenVerifier);
  if (!authorization.ok) return authorization.response;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return dashboardJsonResponse(400, { error: "INVALID_UX_TELEMETRY_EVENT" });
  }
  const boundEvent = { ...(body as Record<string, unknown>), ownerPrincipalId: authorization.principal.userId };

  const result = await appendUxTelemetryEvent(dependencies.storage, boundEvent);
  if (!result.appended) {
    if (result.reason === "EVENT_INVALID") return dashboardJsonResponse(400, { error: "INVALID_UX_TELEMETRY_EVENT", details: result.errors });
    if (result.reason === "DUPLICATE_EVENT_ID") return dashboardJsonResponse(200, { status: "DUPLICATE_IGNORED" });
    return dashboardJsonResponse(503, { error: "UX_TELEMETRY_UNAVAILABLE" });
  }
  return dashboardJsonResponse(202, { status: "ACCEPTED" });
}
