/**
 * One structured log line per Workers AI call, so provider budget decisions (C1 coding vs C2 audit
 * split, retry counts, context size) rest on observed usage instead of guesses. Numbers only: the
 * prompt and response bodies are never logged.
 */
export type AiCaller = "C1_CODING" | "C2_AUDIT";

export interface AiCallUsage {
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
}

const count = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);

export function aiCallUsage(response: unknown): AiCallUsage {
  const usage = response != null && typeof response === "object" ? (response as { usage?: unknown }).usage : undefined;
  const record = usage != null && typeof usage === "object" ? usage as Record<string, unknown> : {};
  return Object.freeze({ promptTokens: count(record.prompt_tokens), completionTokens: count(record.completion_tokens) });
}

export function logAiCall(input: Readonly<{ caller: AiCaller; model: string; attempt: number; promptChars: number; response: unknown }>, log: (line: string) => void = console.log): void {
  try {
    const usage = aiCallUsage(input.response);
    log(JSON.stringify({
      event: "NUSA_AI_CALL",
      caller: input.caller,
      model: input.model,
      attempt: input.attempt,
      promptChars: input.promptChars,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    }));
  } catch {
    // Telemetry never changes the outcome of the call it observes.
  }
}
