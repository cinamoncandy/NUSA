import type { OpportunityDashboardSection } from "../../../cloud/src/dashboardAggregator";
import type { OpportunitySchedule } from "../../../cloud/src/opportunityScheduler";

function finite(value: number, field: string): void {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
}

export function validateOpportunitySchedule(schedule: OpportunitySchedule): void {
  if (schedule.mode !== "PAPER" && schedule.mode !== "DRY_RUN") throw new Error("opportunity schedule mode is invalid");
  finite(schedule.totalAllocation, "totalAllocation");
  finite(schedule.reservedCash, "reservedCash");
  if (schedule.totalAllocation < 0 || schedule.reservedCash < 0 || !Array.isArray(schedule.opportunities) || !Array.isArray(schedule.rejected)) throw new Error("opportunity schedule shape is invalid");
  const ids = new Set<string>();
  for (const opportunity of schedule.opportunities) {
    if (!opportunity.id.trim() || !opportunity.asset.trim() || ids.has(opportunity.id)) throw new Error("opportunity identity is invalid");
    ids.add(opportunity.id);
    finite(opportunity.score, "opportunity score");
    finite(opportunity.allocation, "opportunity allocation");
    if (!Number.isSafeInteger(opportunity.rank) || opportunity.rank < 1 || opportunity.allocation < 0) throw new Error("opportunity rank or allocation is invalid");
  }
  for (const rejected of schedule.rejected) if (!rejected.id.trim() || !rejected.reason.trim()) throw new Error("opportunity rejection is invalid");
}

export function buildOpportunityDashboardSection(schedule: OpportunitySchedule, generatedAt: number): OpportunityDashboardSection {
  if (!Number.isSafeInteger(generatedAt) || generatedAt < 0) throw new Error("generatedAt must be a non-negative safe integer");
  validateOpportunitySchedule(schedule);
  const top = [...schedule.opportunities].sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id))[0];
  const reasons = schedule.rejected.length === 0 ? [] : ["OPPORTUNITY_CANDIDATES_REJECTED"];
  return Object.freeze({
    status: schedule.rejected.length === 0 ? "HEALTHY" : "CAUTION",
    availability: "AVAILABLE",
    generatedAt,
    reasons: Object.freeze(reasons),
    activeCount: schedule.opportunities.length,
    totalAllocatedCapital: schedule.totalAllocation,
    reservedCash: schedule.reservedCash,
    ...(top == null ? {} : { topOpportunityId: top.id, topOpportunityScore: top.score })
  });
}
