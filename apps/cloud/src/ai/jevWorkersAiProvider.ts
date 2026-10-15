import { createHash } from "node:crypto";
import { validateJevShadowDecision, type JevShadowDecision } from "./jevShadowRouter";

/**
 * Minimal structural surface of the Cloudflare Workers AI binding, mirrored
 * from the canonical WorkersAiBinding so this provider stays decoupled from
 * the Autopilot coding runtime. Any object with this shape (including the
 * canonical binding) is accepted.
 */
export interface JevWorkersAiRuntime {
  run(model: string, input: {
    readonly prompt: string;
    readonly response_format?: unknown;
  }): Promise<unknown>;
}

export interface JevWorkersAiProviderOptions {
  readonly ai: JevWorkersAiRuntime;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

export interface JevWorkersAiReceipt {
  readonly provider: "workers-ai";
  readonly model: string;
  readonly latencyMs: number;
  readonly timeoutMs: number;
  readonly fallbackApplied: false;
  readonly inputFingerprint: string;
  readonly confidence: number;
  readonly reasonCode: "SUCCESS";
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

export interface JevWorkersAiClassified {
  readonly decision: JevShadowDecision;
  readonly receipt: JevWorkersAiReceipt;
}

const DEFAULT_TIMEOUT_MS = 8000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 30_000;

const JEV_DECISION_SCHEMA = Object.freeze({
  type: "json_schema",
  json_schema: Object.freeze({
    type: "object",
    additionalProperties: false,
    properties: Object.freeze({
      rootCause: Object.freeze({ type: "string", enum: Object.freeze(["CODE", "TEST", "INFRA", "AUTH", "RUNNER", "FLAKY", "UNKNOWN"]) }),
      safeToAutofix: Object.freeze({ type: "string", enum: Object.freeze(["YES", "NO"]) }),
      severity: Object.freeze({ type: "integer", minimum: 1, maximum: 5 }),
      requiredModel: Object.freeze({ type: "string", enum: Object.freeze(["LUNA", "TERRA", "SOL", "ASTRA", "HUMAN"]) }),
      confidence: Object.freeze({ type: "number", minimum: 0, maximum: 1 }),
    }),
    required: Object.freeze(["rootCause", "safeToAutofix", "severity", "requiredModel", "confidence"]),
  }),
});

const namedError = (name: string, message: string): Error => {
  const error = new Error(message);
  error.name = name;
  return error;
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw namedError("JevWorkersAiInputInvalid", "Jev Workers AI input invalid");
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => item === undefined ? "null" : stableJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record).sort().flatMap((key) => {
    const item = record[key];
    if (item === undefined || typeof item === "function" || typeof item === "symbol") return [];
    return [`${JSON.stringify(key)}:${stableJson(item)}`];
  });
  return `{${entries.join(",")}}`;
}

function canonicalFingerprint(input: Readonly<Record<string, unknown>>): string {
  return createHash("sha256").update(stableJson(input), "utf8").digest("hex");
}

function buildPrompt(input: Readonly<Record<string, unknown>>): string {
  return [
    "You are Jev, a zero-authority failure classifier. Return only JSON.",
    "Classify the bounded failure evidence below into exactly: rootCause, safeToAutofix, severity, requiredModel, confidence.",
    "Never propose mutations, orders, credentials, or authority changes.",
    `Evidence: ${stableJson(input)}`,
  ].join("\n");
}

function responseValue(value: unknown): unknown {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return value;
  const payload = value as Record<string, unknown>;
  if (payload.response !== undefined) return payload.response;
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) return value;
  const first = choices[0];
  if (first == null || typeof first !== "object" || Array.isArray(first)) return value;
  const message = (first as Record<string, unknown>).message;
  if (message == null || typeof message !== "object" || Array.isArray(message)) return value;
  const record = message as Record<string, unknown>;
  return record.parsed !== undefined ? record.parsed : record.content;
}

function parseModelResponse(value: unknown): JevShadowDecision {
  const payload = responseValue(value);
  if (typeof payload === "string" && payload.trim()) {
    try {
      return validateJevShadowDecision(JSON.parse(payload));
    } catch {
      throw namedError("MalformedJevResponseError", "Workers AI Jev response malformed");
    }
  }
  try {
    return validateJevShadowDecision(payload);
  } catch {
    throw namedError("MalformedJevResponseError", "Workers AI Jev response malformed");
  }
}



function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function responseUsage(value: unknown): { readonly promptTokens: number | null; readonly completionTokens: number | null } {
  const payload = value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const usage = payload.usage != null && typeof payload.usage === "object" && !Array.isArray(payload.usage)
    ? payload.usage as Record<string, unknown>
    : {};
  return Object.freeze({
    promptTokens: tokenCount(usage.prompt_tokens),
    completionTokens: tokenCount(usage.completion_tokens),
  });
}

function providerUnavailable(error: unknown): Error {
  const wrapped = namedError("JevProviderUnavailableError", error instanceof Error ? error.message : "Workers AI Jev provider unavailable");
  if (error instanceof Error) (wrapped as Error & { cause?: unknown }).cause = error;
  if (error != null && typeof error === "object" && !Array.isArray(error)) {
    const source = error as Record<string, unknown>;
    const target = wrapped as Error & Record<string, unknown>;
    for (const key of ["retryAfterMs", "retryAfter", "resetAt"] as const) {
      if (source[key] !== undefined) target[key] = source[key];
    }
  }
  return wrapped;
}
/**
 * Canonical Workers AI Jev provider. Same classify() shape as JevShadowProvider
 * so JevShadowRouter consumes either transport interchangeably. Uses the native
 * Cloudflare AI binding — no API key, no endpoint secret, no raw credentials.
 * Every failure throws (router applies the deterministic fallback); quota and
 * rate-limit shaped errors keep canonical reason codes for provider governance.
 */
export class JevWorkersAiProvider {
  private readonly ai: JevWorkersAiRuntime;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly inFlight = new Map<string, Promise<JevWorkersAiClassified>>();

  public constructor(options: JevWorkersAiProviderOptions) {
    if (options.ai == null || typeof options.ai.run !== "function") throw new Error("Jev Workers AI runtime invalid");
    if (typeof options.model !== "string" || !options.model.trim()) throw new Error("Jev Workers AI model invalid");
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) throw new Error("Jev Workers AI timeout invalid");
    this.ai = options.ai;
    this.model = options.model.trim();
    this.timeoutMs = timeoutMs;
    this.now = options.now ?? (() => Date.now());
  }

  public async classify(input: Readonly<Record<string, unknown>>): Promise<JevShadowDecision> {
    return (await this.classifyDetailed(input)).decision;
  }

  public classifyDetailed(input: Readonly<Record<string, unknown>>): Promise<JevWorkersAiClassified> {
    if (input == null || typeof input !== "object" || Array.isArray(input)) throw namedError("JevWorkersAiInputInvalid", "Jev Workers AI input invalid");
    const fingerprint = canonicalFingerprint(input);
    const pending = this.inFlight.get(fingerprint);
    if (pending) return pending;
    const started = this.now();
    const providerCall = this.ai.run(this.model, { prompt: buildPrompt(input), response_format: JEV_DECISION_SCHEMA });
    const task = this.finishWithTimeout(providerCall, fingerprint, started);
    this.inFlight.set(fingerprint, task);
    const release = () => {
      if (this.inFlight.get(fingerprint) === task) this.inFlight.delete(fingerprint);
    };
    providerCall.then(release, release);
    return task;
  }

  private async finishWithTimeout(providerCall: Promise<unknown>, fingerprint: string, started: number): Promise<JevWorkersAiClassified> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        providerCall,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(namedError("TimeoutError", "Workers AI Jev provider timed out")), this.timeoutMs);
        }),
      ]);
      const decision = parseModelResponse(response);
      const usage = responseUsage(response);
      return Object.freeze({
        decision,
        receipt: Object.freeze({
          provider: "workers-ai" as const,
          model: this.model,
          latencyMs: Math.max(0, this.now() - started),
          timeoutMs: this.timeoutMs,
          fallbackApplied: false as const,
          inputFingerprint: fingerprint,
          confidence: decision.confidence,
          reasonCode: "SUCCESS" as const,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          liveAuthority: "NONE" as const,
          productionMutationAllowed: false as const,
          aiAuthority: "ZERO_AUTHORITY" as const,
        }),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "MalformedJevResponseError")) throw error;
      throw providerUnavailable(error);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
