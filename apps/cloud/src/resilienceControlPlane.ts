import { BusinessServiceCriticality, ResilienceReadiness, type CriticalBusinessService, type ResilienceReadinessResult } from "../../../packages/contracts/src/resilience";

const freeze = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);
const validHash = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);

export function evaluateResilienceReadiness(service: CriticalBusinessService, now: number, knownDependencies: ReadonlySet<string>): ResilienceReadinessResult {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("now must be a non-negative safe integer");
  const blockers: string[] = [];
  if (!service.businessServiceId.trim() || !service.canonicalName.trim()) blockers.push("SERVICE_IDENTITY_UNKNOWN");
  if (!service.tenantId.trim() || !service.legalEntityId.trim() || !service.region.trim() || !service.jurisdiction.trim()) blockers.push("ISOLATION_BOUNDARY_UNKNOWN");
  if (!service.ownerId?.trim()) blockers.push("OWNER_UNKNOWN");
  if (service.criticality === BusinessServiceCriticality.UNKNOWN) blockers.push("CRITICALITY_UNKNOWN");
  if (!service.recoveryPolicyId?.trim() || !service.continuityPlanId?.trim()) blockers.push("RECOVERY_PLAN_UNKNOWN");
  if (service.objectives == null || ![service.objectives.rtoMs, service.objectives.rpoMs, service.objectives.maximumTolerableDowntimeMs].every(value => Number.isSafeInteger(value) && value >= 0)) blockers.push("RECOVERY_OBJECTIVES_UNKNOWN");
  if (service.recoveryPlanTestedAt == null || service.recoveryPlanTestedAt > now) blockers.push("RECOVERY_PLAN_UNTESTED");
  if (service.expiresAt != null && service.expiresAt <= now) blockers.push("RECOVERY_PLAN_EXPIRED");
  if (!validHash(service.evidenceHash)) blockers.push("EVIDENCE_UNVERIFIED");
  if (service.dependencyIds.some(id => !knownDependencies.has(id))) blockers.push("DEPENDENCY_UNKNOWN");
  return Object.freeze({ serviceId: service.businessServiceId, readiness: blockers.length === 0 ? ResilienceReadiness.READY : blockers.some(code => code.includes("UNKNOWN")) ? ResilienceReadiness.UNKNOWN : ResilienceReadiness.BLOCKED, blockers: freeze([...new Set(blockers)].sort()), productionMutationAllowed: false });
}
