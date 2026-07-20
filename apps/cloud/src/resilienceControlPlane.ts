import { createHash } from "node:crypto";
import { BusinessServiceCriticality, ResilienceReadiness, type CriticalBusinessService, type ResilienceLedgerEvent, type ResilienceLedgerRecord, type ResilienceReadinessResult } from "../../../packages/contracts/src/resilience";

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

const genesis = "0".repeat(64);
const eventHash = (sequence: number, previousHash: string, event: ResilienceLedgerEvent): string => createHash("sha256").update(`${sequence}\n${previousHash}\n${JSON.stringify(event)}`, "utf8").digest("hex");
export function appendResilienceEvent(records: readonly ResilienceLedgerRecord[], event: ResilienceLedgerEvent): readonly ResilienceLedgerRecord[] {
  replayResilienceLedger(records); if (!event.eventId.trim() || !event.plan.planId.trim() || !event.plan.version.trim() || !validHash(event.evidenceHash) || event.occurredAt < 0 || !Number.isSafeInteger(event.occurredAt)) throw new Error("invalid resilience event");
  const previousHash = records.at(-1)?.hash ?? genesis; const record = Object.freeze({ sequence: records.length + 1, previousHash, event: Object.freeze({ ...event }), hash: eventHash(records.length + 1, previousHash, event) }); const next = Object.freeze([...records, record]); replayResilienceLedger(next); return next;
}
export function replayResilienceLedger(records: readonly ResilienceLedgerRecord[]): ReadonlyMap<string, ResilienceLedgerEvent> {
  const plans = new Map<string, ResilienceLedgerEvent>(); let previousHash = genesis; let last = -1;
  for (let index = 0; index < records.length; index += 1) { const record = records[index]!; if (record.sequence !== index + 1 || record.previousHash !== previousHash || record.hash !== eventHash(record.sequence, record.previousHash, record.event) || record.event.occurredAt < last) throw new Error("resilience ledger integrity violation"); const key = `${record.event.plan.planId}|${record.event.plan.version}`; if (record.event.type === "PLAN_TESTED" && record.event.plan.approvedAt == null) throw new Error("untested approval boundary"); plans.set(key, record.event); previousHash = record.hash; last = record.event.occurredAt; }
  return plans;
}
