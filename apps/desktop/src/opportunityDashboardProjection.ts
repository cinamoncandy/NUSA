import type { OpportunityDashboardSection } from "../../cloud/src/dashboardAggregator";
import type { OpportunitySchedule } from "../../cloud/src/opportunityScheduler";

function finite(value: number, field: string): void {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
}

export function buildOpportunityDashboardSection(schedule: OpportunitySchedule, generatedAt: number): OpportunityDashboardSection {
  if (!Number.isSafeInteger(generatedAt) || generatedAt < 0) throw new Error("generatedAt must be a non-negative safe integer");
  if (schedule.mode !== "PAPER" && schedule.mode !== "DRY_RUN") throw new Error("opportunity schedule mode is invalid");
  finite(schedule.totalAllocation, "totalAllocation");
  finite(schedule.reservedCash, "reservedCash");
  if (schedule.totalAllocation < 0 || schedule.reservedCash < 0) throw new Error("opportunity allocation must be non-negative");
  for (const opportunity of schedule.opportunities) {
    if (!opportunity.id.trim() || !opportunity.asset.trim()) throw new Error("opportunity identity is invalid");
    finite(opportunity.score, "opportunity score");
    finite(opportunity.allocation, "opportunity allocation");
    if (!Number.isSafeInteger(opportunity.rank) || opportunity.rank < 1 || opportunity.allocation < 0) throw new Error("opportunity rank or allocation is invalid");
  }
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
