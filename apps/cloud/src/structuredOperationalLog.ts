export type OperationalSeverity = "INFO" | "WARN" | "ERROR";

export interface OperationalLog {
  readonly timestamp: string;
  readonly severity: OperationalSeverity;
  readonly event: string;
  readonly correlationId: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

const SENSITIVE_KEY = /secret|token|password|authorization|api.?key|credential/i;

function sanitize(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return Object.freeze(value.map((item) => sanitize(item)));
  if (value !== null && typeof value === "object") {
    return Object.freeze(Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey)])));
  }
  if (typeof value === "string") {
    return value
      .replace(/\bBearer\s+[^\s,}]+/gi, "Bearer [REDACTED]")
      .replace(/(secret|token|password|authorization|api.?key|credential)\s*[:=]\s*(?:Bearer\s+)?[^\s,}]+/gi, "$1=[REDACTED]");
  }
  return value;
}

export function operationalLog(
  severity: OperationalSeverity,
  event: string,
  correlationId: string,
  details?: Readonly<Record<string, unknown>>
): void {
  if (!event.trim() || !correlationId.trim()) throw new Error("operational log event and correlationId are required");
  const record: OperationalLog = Object.freeze({
    timestamp: new Date().toISOString(),
    severity,
    event: event.trim(),
    correlationId: correlationId.trim(),
    ...(details === undefined ? {} : { details: sanitize(details) as Readonly<Record<string, unknown>> })
  });
  process.stdout.write(`${JSON.stringify(record)}\n`);
}
