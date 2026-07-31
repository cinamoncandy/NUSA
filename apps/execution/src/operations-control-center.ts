import { randomUUID } from "node:crypto";

export type OperationsMode = "PAPER" | "SHADOW" | "READ_ONLY" | "LIVE_DISABLED";
export type HealthState = "HEALTHY" | "WARNING" | "CRITICAL" | "UNKNOWN";
export type AlertSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";
export type AlertSource = "MARKET" | "EXECUTION" | "RECOVERY" | "RISK" | "EXCHANGE" | "DATABASE" | "RENDERER" | "SYSTEM";
export type SessionState = "STARTING" | "RUNNING" | "STOPPING" | "STOPPED" | "RECOVERING" | "BLOCKED";
export type IncidentType = "RECOVERY" | "RECONNECT" | "RISK_BLOCK" | "KILL_SWITCH" | "UNKNOWN_SUBMISSION" | "RECONCILIATION_DIFF" | "RESTART" | "SHUTDOWN" | "CRASH" | "DATABASE_ERROR" | "EXCHANGE_ERROR";
export const OPERATIONS_CAPABILITY_DESCRIPTOR = Object.freeze({ operationsCenterPresent: true as const, auditLogPresent: true as const, healthMonitorPresent: true as const, productionMutationAllowed: false as const });

export interface HealthEntry { readonly component: string; readonly state: HealthState; readonly reasonCode: string | null; readonly observedAt: string; }
export interface OperationsSnapshot { readonly applicationVersion: string; readonly buildVersion: string; readonly gitCommit: string; readonly mode: OperationsMode; readonly exchangeStatus: HealthState; readonly websocketStatus: HealthState; readonly warmupStatus: HealthState; readonly recoveryStatus: HealthState; readonly reconciliationStatus: HealthState; readonly riskStatus: HealthState; readonly killSwitchActive: boolean; readonly executionSummary: Readonly<Record<string, unknown>>; readonly resources: Readonly<Record<string, string | number>>; readonly lastSync: string | null; readonly clockDriftMs: number | null; readonly health: readonly HealthEntry[]; readonly observedAt: string; }
export interface OperationsAlert { readonly alertId: string; readonly severity: AlertSeverity; readonly source: AlertSource; readonly code: string; readonly message: string; readonly acknowledgedAt: string | null; readonly acknowledgedBy: string | null; readonly createdAt: string; }
export interface IncidentEvent { readonly eventId: string; readonly type: IncidentType; readonly message: string; readonly createdAt: string; readonly sessionId: string | null; readonly alertId: string | null; }
export interface AuditEvent { readonly auditId: string; readonly actor: string; readonly action: string; readonly target: string | null; readonly metadata: Readonly<Record<string, string>>; readonly createdAt: string; }
export interface EvidenceFilter { readonly from?: string; readonly to?: string; readonly strategy?: string; readonly symbol?: string; readonly severity?: string; readonly executionId?: string; readonly sessionId?: string; readonly recovery?: string; }
export interface EvidenceItem { readonly evidenceId: string; readonly createdAt: string; readonly severity: string; readonly strategyId: string | null; readonly symbol: string | null; readonly executionId: string | null; readonly sessionId: string | null; readonly recoveryState: string | null; readonly payload: Readonly<Record<string, unknown>>; }

const iso = (value = new Date().toISOString()): string => { if (Number.isNaN(Date.parse(value))) throw new Error("INVALID_TIMESTAMP"); return value; };
const clean = (value: unknown): string => { const text = String(value ?? ""); if (/secret|jwt|authorization|access.?key|private.?key/i.test(text)) return "[REDACTED]"; return text; };
const sessionTransitions: Readonly<Record<SessionState, readonly SessionState[]>> = { STARTING: ["RUNNING", "BLOCKED", "STOPPED"], RUNNING: ["STOPPING", "BLOCKED", "RECOVERING"], STOPPING: ["STOPPED", "BLOCKED"], STOPPED: ["STARTING", "RECOVERING"], RECOVERING: ["RUNNING", "BLOCKED", "STOPPED"], BLOCKED: ["RECOVERING", "STOPPED"] };

export class SessionManager {
  private state: SessionState = "STOPPED";
  public constructor(private readonly audit: AuditLog) {}
  get current(): SessionState { return this.state; }
  transition(next: SessionState, actor = "operator"): SessionState { if (!sessionTransitions[this.state].includes(next)) throw new Error(`INVALID_SESSION_TRANSITION:${this.state}->${next}`); const previous = this.state; this.state = next; this.audit.append(actor, "SESSION_TRANSITION", next, { from: previous, to: next }); return next; }
}
export class AuditLog {
  private readonly events: AuditEvent[] = [];
  append(actor: string, action: string, target: string | null = null, metadata: Readonly<Record<string, string>> = {}, createdAt = new Date().toISOString()): AuditEvent { const event = Object.freeze({ auditId: randomUUID(), actor: clean(actor), action: clean(action), target: target == null ? null : clean(target), metadata: Object.freeze(Object.fromEntries(Object.entries(metadata).map(([k, v]) => [clean(k), clean(v)]))), createdAt: iso(createdAt) }); this.events.push(event); return event; }
  list(): readonly AuditEvent[] { return Object.freeze([...this.events]); }
}
export class AlertCenter {
  private readonly alerts = new Map<string, OperationsAlert>();
  public constructor(private readonly audit: AuditLog) {}
  create(input: Omit<OperationsAlert, "alertId" | "acknowledgedAt" | "acknowledgedBy">): OperationsAlert { const alert = Object.freeze({ ...input, alertId: randomUUID(), acknowledgedAt: null, acknowledgedBy: null, createdAt: iso(input.createdAt) }); this.alerts.set(alert.alertId, alert); return alert; }
  acknowledge(alertId: string, actor: string, at = new Date().toISOString()): OperationsAlert { const existing = this.alerts.get(alertId); if (!existing) throw new Error("ALERT_NOT_FOUND"); const next = Object.freeze({ ...existing, acknowledgedAt: iso(at), acknowledgedBy: clean(actor) }); this.alerts.set(alertId, next); this.audit.append(actor, "ALERT_ACKNOWLEDGE", alertId); return next; }
  list(): readonly OperationsAlert[] { return Object.freeze([...this.alerts.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))); }
}
export class IncidentTimeline { private readonly events: IncidentEvent[] = []; append(input: Omit<IncidentEvent, "eventId">): IncidentEvent { const event = Object.freeze({ ...input, eventId: randomUUID(), createdAt: iso(input.createdAt) }); this.events.push(event); return event; } list(): readonly IncidentEvent[] { return Object.freeze([...this.events].sort((a, b) => a.createdAt.localeCompare(b.createdAt))); } }
export class EvidenceBrowser { private readonly items: EvidenceItem[] = []; append(item: EvidenceItem): void { if (this.items.some(x => x.evidenceId === item.evidenceId)) throw new Error("DUPLICATE_EVIDENCE"); this.items.push(Object.freeze({ ...item, payload: Object.freeze({ ...item.payload }) })); } list(filter: EvidenceFilter = {}): readonly EvidenceItem[] { return Object.freeze(this.items.filter(x => (!filter.strategy || x.strategyId === filter.strategy) && (!filter.symbol || x.symbol === filter.symbol) && (!filter.severity || x.severity === filter.severity) && (!filter.executionId || x.executionId === filter.executionId) && (!filter.sessionId || x.sessionId === filter.sessionId) && (!filter.recovery || x.recoveryState === filter.recovery) && (!filter.from || x.createdAt >= filter.from) && (!filter.to || x.createdAt <= filter.to))); } exportJson(filter?: EvidenceFilter): string { return JSON.stringify(this.list(filter)); } exportCsv(filter?: EvidenceFilter): string { const rows = this.list(filter); return ["evidenceId,createdAt,severity,strategyId,symbol,executionId,sessionId,recoveryState", ...rows.map(x => [x.evidenceId, x.createdAt, x.severity, x.strategyId, x.symbol, x.executionId, x.sessionId, x.recoveryState].map(v => JSON.stringify(v ?? "")).join(","))].join("\n"); } }
export function buildOperationsSnapshot(input: Omit<OperationsSnapshot, "observedAt" | "mode"> & { readonly mode?: OperationsMode; readonly observedAt?: string }): OperationsSnapshot { return Object.freeze({ ...input, mode: input.mode ?? "READ_ONLY", observedAt: iso(input.observedAt) }); }
export function buildHealth(component: string, state: HealthState, reasonCode: string | null = null, observedAt?: string): HealthEntry { if (!component.trim()) throw new Error("HEALTH_COMPONENT_REQUIRED"); return Object.freeze({ component, state, reasonCode, observedAt: iso(observedAt) }); }
