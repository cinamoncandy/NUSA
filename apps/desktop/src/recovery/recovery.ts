export type RecoveryComponent = "IPC" | "WEBSOCKET" | "RENDERER" | "STORAGE" | "MEMORY";
export type RecoveryHealth = "HEALTHY" | "WARNING" | "CRITICAL";

export interface RecoveryEvent {
  readonly id: string;
  readonly timestamp: number;
  readonly component: RecoveryComponent;
  readonly status: RecoveryHealth;
  readonly message: string;
}

export interface RecoveryHealthInput {
  readonly now: number;
  readonly ipcHealthy: boolean;
  readonly websocketConnected: boolean;
  readonly rendererHealthy: boolean;
  readonly storageHealthy: boolean;
  readonly lastMarketDataAt?: number;
  readonly maximumMarketDataAgeMs: number;
  readonly heapUsedBytes?: number;
  readonly maximumHeapUsedBytes: number;
}

export interface RecoveryHealthReport {
  readonly status: RecoveryHealth;
  readonly reasons: readonly string[];
  readonly generatedAt: number;
}

export class RecoveryLedger {
  private readonly events: RecoveryEvent[] = [];

  public constructor(private readonly maximumEvents = 1_000) {
    if (!Number.isSafeInteger(maximumEvents) || maximumEvents < 1) throw new Error("maximumEvents must be a positive safe integer");
  }

  public record(event: RecoveryEvent): RecoveryEvent {
    if (!event.id || !Number.isSafeInteger(event.timestamp) || event.timestamp < 0 || !event.message) throw new Error("invalid recovery event");
    if (this.events.some((candidate) => candidate.id === event.id)) return this.events.find((candidate) => candidate.id === event.id)!;
    const frozen = Object.freeze({ ...event });
    this.events.push(frozen);
    if (this.events.length > this.maximumEvents) this.events.splice(0, this.events.length - this.maximumEvents);
    return frozen;
  }

  public list(): readonly RecoveryEvent[] {
    return Object.freeze(this.events.map((event) => Object.freeze({ ...event })));
  }
}

export function buildRecoveryHealthReport(input: RecoveryHealthInput): RecoveryHealthReport {
  if (!Number.isSafeInteger(input.now) || input.now < 0 || !Number.isSafeInteger(input.maximumMarketDataAgeMs) || input.maximumMarketDataAgeMs <= 0 || !Number.isSafeInteger(input.maximumHeapUsedBytes) || input.maximumHeapUsedBytes <= 0) {
    throw new Error("invalid recovery health input");
  }
  const reasons: string[] = [];
  let status: RecoveryHealth = "HEALTHY";
  const critical = (reason: string): void => { reasons.push(reason); status = "CRITICAL"; };
  const warning = (reason: string): void => { reasons.push(reason); if (status === "HEALTHY") status = "WARNING"; };
  if (!input.storageHealthy) critical("Storage recovery is unavailable");
  if (!input.ipcHealthy) warning("IPC is unavailable");
  if (!input.rendererHealthy) warning("Renderer is recovering");
  if (!input.websocketConnected) warning("Market WebSocket is disconnected");
  if (input.lastMarketDataAt == null) warning("Market data has not arrived");
  else if (!Number.isSafeInteger(input.lastMarketDataAt) || input.lastMarketDataAt > input.now) critical("Market data timestamp is invalid");
  else if (input.now - input.lastMarketDataAt > input.maximumMarketDataAgeMs) warning("Market data is delayed");
  if (input.heapUsedBytes != null && (!Number.isSafeInteger(input.heapUsedBytes) || input.heapUsedBytes < 0)) critical("Memory usage is invalid");
  else if (input.heapUsedBytes != null && input.heapUsedBytes > input.maximumHeapUsedBytes) warning("Memory usage exceeds the recovery threshold");
  return Object.freeze({ status, reasons: Object.freeze(reasons), generatedAt: input.now });
}

export interface RetryPolicy { readonly timeoutMs: number; readonly maximumAttempts: number; }

export async function retryWithTimeout<T>(operation: () => Promise<T>, policy: RetryPolicy): Promise<T> {
  if (!Number.isSafeInteger(policy.timeoutMs) || policy.timeoutMs <= 0 || !Number.isSafeInteger(policy.maximumAttempts) || policy.maximumAttempts < 1) throw new Error("invalid retry policy");
  let lastError: unknown;
  for (let attempt = 0; attempt < policy.maximumAttempts; attempt += 1) {
    try {
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          operation(),
          new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("IPC request timed out")), policy.timeoutMs); })
        ]);
      } finally { if (timer) clearTimeout(timer); }
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("IPC request failed");
}
