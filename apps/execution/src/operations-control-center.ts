import { createHash, randomUUID } from "node:crypto";

export type OperationsHealth = "HEALTHY" | "DEGRADED" | "CRITICAL" | "UNKNOWN";
export type ActorKind = "HUMAN" | "SYSTEM" | "AI" | "META_AI" | "AUTOMATION" | "PROVIDER";
export type SafeControlAction = "REQUEST_HALT" | "REQUEST_RECOVERY_REVIEW";

export interface HealthSignal { readonly component: string; readonly state: OperationsHealth; readonly reasonCode: string | null; readonly observedAt: string; }
export interface EvidenceReference { readonly id: string; readonly kind: string; readonly digest: string; readonly observedAt: string; }
export interface OperationsProjectionInput {
  readonly governanceState: string;
  readonly operationalState: "SAFE" | "DEGRADED" | "RESTRICTED" | "HALT" | "UNKNOWN";
  readonly hardRisk: "PASS" | "REJECT" | "BLOCK" | "UNKNOWN";
  readonly killSwitchActive: boolean;
  readonly reconciliation: "MATCH" | "DIFF" | "UNKNOWN";
  readonly marketData: "HEALTHY" | "STALE" | "DISCONNECTED" | "UNKNOWN";
  readonly recoveryReady: boolean;
  readonly health: readonly HealthSignal[];
  readonly evidence: readonly EvidenceReference[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface OperationsProjection extends OperationsProjectionInput {
  readonly mode: "READ_ONLY_OPERATIONS";
  readonly overallHealth: OperationsHealth;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly executionAuthority: false;
  readonly realMoneyExecutionAllowed: false;
  readonly observedAt: string;
}
export interface OperationsAuditEvent { readonly auditId: string; readonly actorId: string; readonly actorKind: ActorKind; readonly action: string; readonly target: string | null; readonly observedAt: string; readonly metadata: Readonly<Record<string, unknown>>; }
export interface OperationsAlert { readonly alertId: string; readonly severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL"; readonly code: string; readonly message: string; readonly createdAt: string; readonly acknowledgedAt: string | null; readonly acknowledgedBy: string | null; }
export interface IncidentEvent { readonly eventId: string; readonly type: string; readonly message: string; readonly createdAt: string; readonly evidenceId: string | null; }
export interface SafeControlRequest { readonly requestId: string; readonly action: SafeControlAction; readonly actorId: string; readonly actorKind: ActorKind; readonly reasonCode: string; readonly requestedAt: string; readonly executesMutation: false; readonly authorizesLive: false; }

export const OPERATIONS_CONTROL_DESCRIPTOR = Object.freeze({ readOnlyProjection: true as const, safeReductionRequestsOnly: true as const, executionAuthority: false as const, killSwitchReleaseAuthority: false as const, credentialExecutionUse: false as const, realMoneyExecutionAllowed: false as const });
const secretKeyPattern = /secret|password|token|authorization|access.?key|private.?key|credential/i;
const secretValuePattern = /bearer\s+|private[_ -]?key|api[_ -]?secret/i;
const validIso = (value: string): string => { if (Number.isNaN(Date.parse(value))) throw new Error("OPERATIONS_INVALID_TIMESTAMP"); return value; };
function sanitize(value: unknown, key = ""): unknown {
  if (secretKeyPattern.test(key)) return "[REDACTED]";
  if (typeof value === "string" && secretValuePattern.test(value)) return "[REDACTED]";
  if (Array.isArray(value)) return Object.freeze(value.map((item) => sanitize(item)));
  if (value && typeof value === "object") return Object.freeze(Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitize(v, k)])));
  return value;
}
function deriveOverallHealth(input: OperationsProjectionInput): OperationsHealth {
  if (input.operationalState === "UNKNOWN" || input.hardRisk === "UNKNOWN" || input.reconciliation === "UNKNOWN" || input.marketData === "UNKNOWN" || input.health.some((x) => x.state === "UNKNOWN")) return "UNKNOWN";
  if (input.killSwitchActive || input.operationalState === "HALT" || input.hardRisk === "BLOCK" || input.reconciliation === "DIFF" || input.marketData === "DISCONNECTED" || input.health.some((x) => x.state === "CRITICAL")) return "CRITICAL";
  if (input.operationalState !== "SAFE" || input.hardRisk !== "PASS" || input.marketData !== "HEALTHY" || !input.recoveryReady || input.health.some((x) => x.state === "DEGRADED")) return "DEGRADED";
  return "HEALTHY";
}
export function buildOperationsProjection(input: OperationsProjectionInput, observedAt = new Date().toISOString()): OperationsProjection {
  const at = validIso(observedAt);
  const health = Object.freeze(input.health.map((entry) => Object.freeze({ ...entry, observedAt: validIso(entry.observedAt) })));
  const evidence = Object.freeze(input.evidence.map((entry) => { if (!entry.id.trim() || !entry.kind.trim() || !/^[a-z0-9:+._-]{8,}$/i.test(entry.digest)) throw new Error("OPERATIONS_EVIDENCE_REFERENCE_INVALID"); return Object.freeze({ ...entry, observedAt: validIso(entry.observedAt) }); }));
  return Object.freeze({ ...input, mode: "READ_ONLY_OPERATIONS", overallHealth: deriveOverallHealth({ ...input, health }), governanceState: String(sanitize(input.governanceState)), health, evidence, metadata: sanitize(input.metadata ?? {}) as Readonly<Record<string, unknown>>, executionAuthority: false, realMoneyExecutionAllowed: false, observedAt: at });
}
export class OperationsAuditLog {
  private readonly events: OperationsAuditEvent[] = [];
  append(actorId: string, actorKind: ActorKind, action: string, target: string | null, metadata: Readonly<Record<string, unknown>> = {}, observedAt = new Date().toISOString()): OperationsAuditEvent { if (!actorId.trim() || !action.trim()) throw new Error("OPERATIONS_AUDIT_REQUIRED_FIELD"); const event = Object.freeze({ auditId: randomUUID(), actorId, actorKind, action, target, observedAt: validIso(observedAt), metadata: sanitize(metadata) as Readonly<Record<string, unknown>> }); this.events.push(event); return event; }
  list(): readonly OperationsAuditEvent[] { return Object.freeze([...this.events]); }
}
export class OperationsAlertCenter {
  private readonly alerts = new Map<string, OperationsAlert>();
  constructor(private readonly audit: OperationsAuditLog) {}
  raise(severity: OperationsAlert["severity"], code: string, message: string, createdAt = new Date().toISOString()): OperationsAlert { if (!code.trim()) throw new Error("OPERATIONS_ALERT_CODE_REQUIRED"); const alert = Object.freeze({ alertId: randomUUID(), severity, code, message: String(sanitize(message)), createdAt: validIso(createdAt), acknowledgedAt: null, acknowledgedBy: null }); this.alerts.set(alert.alertId, alert); return alert; }
  acknowledge(alertId: string, actorId: string, actorKind: ActorKind, at = new Date().toISOString()): OperationsAlert { const prior = this.alerts.get(alertId); if (!prior) throw new Error("OPERATIONS_ALERT_NOT_FOUND"); const next = Object.freeze({ ...prior, acknowledgedAt: validIso(at), acknowledgedBy: actorId }); this.alerts.set(alertId, next); this.audit.append(actorId, actorKind, "ALERT_ACKNOWLEDGED", alertId, { code: prior.code }, at); return next; }
  list(): readonly OperationsAlert[] { return Object.freeze([...this.alerts.values()]); }
}
export class IncidentTimeline {
  private readonly events: IncidentEvent[] = [];
  append(type: string, message: string, evidenceId: string | null = null, createdAt = new Date().toISOString()): IncidentEvent { if (!type.trim()) throw new Error("OPERATIONS_INCIDENT_TYPE_REQUIRED"); const event = Object.freeze({ eventId: randomUUID(), type, message: String(sanitize(message)), createdAt: validIso(createdAt), evidenceId }); this.events.push(event); return event; }
  list(): readonly IncidentEvent[] { return Object.freeze([...this.events]); }
}
export class OperationsControlCenter {
  constructor(private readonly audit: OperationsAuditLog) {}
  requestSafeControl(action: SafeControlAction, actorId: string, actorKind: ActorKind, reasonCode: string, requestedAt = new Date().toISOString()): SafeControlRequest { if (action !== "REQUEST_HALT" && action !== "REQUEST_RECOVERY_REVIEW") throw new Error("OPERATIONS_RISK_INCREASE_ACTION_PROHIBITED"); if (!actorId.trim() || !reasonCode.trim()) throw new Error("OPERATIONS_CONTROL_REQUIRED_FIELD"); const at = validIso(requestedAt); const request = Object.freeze({ requestId: randomUUID(), action, actorId, actorKind, reasonCode, requestedAt: at, executesMutation: false as const, authorizesLive: false as const }); this.audit.append(actorId, actorKind, action, request.requestId, { reasonCode }, at); return request; }
}
export function evidenceReferenceDigest(input: Readonly<Record<string, unknown>>): string { return `sha256:${createHash("sha256").update(JSON.stringify(sanitize(input))).digest("hex")}`; }
