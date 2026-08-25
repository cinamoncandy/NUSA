import type { DatabaseSync } from "node:sqlite";

export interface OperationsAuditRecord { readonly auditId: string; readonly actor: string; readonly action: string; readonly target: string | null; readonly metadata: Readonly<Record<string, unknown>>; readonly createdAt: string; }
export interface OperationsAlertRecord { readonly alertId: string; readonly severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL"; readonly source: string; readonly code: string; readonly message: string; readonly createdAt: string; }

export function appendOperationsAudit(db: DatabaseSync, record: OperationsAuditRecord): void {
  db.prepare("INSERT INTO desktop_operations_audit (audit_id, created_at, payload) VALUES (?, ?, ?) ON CONFLICT(audit_id) DO NOTHING").run(record.auditId, record.createdAt, JSON.stringify(record));
}

export function loadOperationsAudit(db: DatabaseSync, limit = 50): readonly OperationsAuditRecord[] {
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 && limit <= 500 ? limit : 50;
  const rows = db.prepare("SELECT payload FROM desktop_operations_audit ORDER BY created_at DESC, audit_id DESC LIMIT ?").all(safeLimit) as Array<{ payload: string }>;
  return Object.freeze(rows.map((row) => Object.freeze(JSON.parse(row.payload) as OperationsAuditRecord)));
}

export function appendOperationsAlert(db: DatabaseSync, record: OperationsAlertRecord): void {
  db.prepare("INSERT INTO desktop_operations_alerts (alert_id, created_at, severity, payload) VALUES (?, ?, ?, ?) ON CONFLICT(alert_id) DO NOTHING").run(record.alertId, record.createdAt, record.severity, JSON.stringify(record));
}

export function loadOperationsAlerts(db: DatabaseSync, limit = 50): readonly OperationsAlertRecord[] {
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 && limit <= 500 ? limit : 50;
  const rows = db.prepare("SELECT payload FROM desktop_operations_alerts ORDER BY created_at DESC, alert_id DESC LIMIT ?").all(safeLimit) as Array<{ payload: string }>;
  return Object.freeze(rows.map((row) => Object.freeze(JSON.parse(row.payload) as OperationsAlertRecord)));
}
