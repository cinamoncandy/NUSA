import { MOBILE_DASHBOARD_API_VERSION, type MobileDashboardResponse } from "../../../packages/contracts/src/mobileDashboard";

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
const isFiniteNonNegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isUnit = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

export function decodeMobileDashboardResponse(payload: unknown, now: number, maxAgeMs: number): MobileDashboardResponse {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("now must be a non-negative safe integer");
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) throw new Error("maxAgeMs must be a non-negative safe integer");
  if (!isRecord(payload)) throw new Error("dashboard payload must be an object");
  if (payload.apiVersion !== MOBILE_DASHBOARD_API_VERSION) throw new Error("unsupported dashboard API version");
  if (!Number.isSafeInteger(payload.generatedAt) || (payload.generatedAt as number) < 0 || (payload.generatedAt as number) > now) {
    throw new Error("dashboard generatedAt is invalid");
  }
  if (now - (payload.generatedAt as number) > maxAgeMs) throw new Error("dashboard payload is stale");
  if (!Array.isArray(payload.positions) || !Array.isArray(payload.decisions) || !Array.isArray(payload.issues) || !Array.isArray(payload.staleIntelligenceSources)) {
    throw new Error("dashboard collection fields are invalid");
  }
  for (const field of ["deployableCapital", "deployedCapital", "cashCapital", "reservedCapital", "spotCapital", "futuresCapital"] as const) {
    if (!isFiniteNonNegative(payload[field])) throw new Error(`${field} is invalid`);
  }
  const visible = (payload.deployedCapital as number) + (payload.cashCapital as number);
  if (Math.abs(visible - (payload.deployableCapital as number)) > 1e-8) throw new Error("dashboard capital totals do not reconcile");
  if ((payload.spotCapital as number) + (payload.futuresCapital as number) > (payload.deployedCapital as number) + 1e-8) {
    throw new Error("dashboard instrument totals exceed deployed capital");
  }
  for (const position of payload.positions) {
    if (!isRecord(position) || typeof position.symbol !== "string" || !position.symbol.trim()) throw new Error("dashboard position is invalid");
    if (position.instrument !== "SPOT" && position.instrument !== "FUTURES") throw new Error("dashboard position instrument is invalid");
    if (!isFiniteNonNegative(position.capital) || !isUnit(position.share)) throw new Error("dashboard position allocation is invalid");
    if (!Number.isInteger(position.leverage) || (position.leverage as number) < 1 || (position.leverage as number) > 20) throw new Error("dashboard position leverage is invalid");
  }
  if (payload.killSwitchActive === true && payload.tradingAllowed === true) throw new Error("kill switch cannot allow trading");
  if (payload.overallHealth !== "HEALTHY" && payload.tradingAllowed === true) throw new Error("unhealthy dashboard cannot allow trading");

  return Object.freeze({
    ...(payload as unknown as MobileDashboardResponse),
    issues: Object.freeze([...(payload.issues as string[])]),
    staleIntelligenceSources: Object.freeze([...(payload.staleIntelligenceSources as string[])]),
    positions: Object.freeze((payload.positions as MobileDashboardResponse["positions"]).map((item) => Object.freeze({ ...item }))),
    decisions: Object.freeze((payload.decisions as MobileDashboardResponse["decisions"]).map((item) => Object.freeze({ ...item, reasons: Object.freeze([...item.reasons]) })))
  });
}
