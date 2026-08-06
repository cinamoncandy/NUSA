export type OperationalSeverity = "INFO" | "WARN" | "ERROR";
export interface OperationalLog { readonly timestamp: string; readonly severity: OperationalSeverity; readonly event: string; readonly correlationId: string; readonly details?: Readonly<Record<string, unknown>>; }
export function operationalLog(severity: OperationalSeverity, event: string, correlationId: string, details?: Readonly<Record<string, unknown>>): void {
  const record: OperationalLog = { timestamp: new Date().toISOString(), severity, event, correlationId, ...(details === undefined ? {} : { details }) };
  process.stdout.write(`${JSON.stringify(record)}\n`);
}
