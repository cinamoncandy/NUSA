import type { AiCioDashboardSnapshot } from "../../cloud/src/dashboardAggregator";

export interface AiCioCommandCenterEnvelopeV1 {
  readonly version: 1;
  readonly mode: "PAPER" | "DRY_RUN";
  readonly generatedAt: number;
  readonly expiresAt: number;
  readonly snapshot: AiCioDashboardSnapshot;
}

export interface AiCioCommandCenterAdapterInput {
  readonly mode: "PAPER" | "DRY_RUN";
  readonly snapshot: AiCioDashboardSnapshot;
  readonly maximumAgeMs: number;
}

const assertTime = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
};

const clonePlain = <T>(value: T): T => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("AI CIO snapshot is not serializable");
  return JSON.parse(serialized) as T;
};

export function buildAiCioCommandCenterEnvelope(
  input: AiCioCommandCenterAdapterInput,
  now: number
): AiCioCommandCenterEnvelopeV1 {
  assertTime(now, "now");
  assertTime(input.maximumAgeMs, "maximumAgeMs");
  assertTime(input.snapshot.generatedAt, "snapshot.generatedAt");
  if (input.maximumAgeMs === 0) throw new Error("maximumAgeMs must be positive");
  if (input.snapshot.generatedAt > now) throw new Error("AI CIO snapshot cannot come from the future");
  if (now - input.snapshot.generatedAt > input.maximumAgeMs) throw new Error("AI CIO snapshot is stale");

  const snapshot = deepFreeze(clonePlain(input.snapshot));
  return deepFreeze({
    version: 1 as const,
    mode: input.mode,
    generatedAt: input.snapshot.generatedAt,
    expiresAt: input.snapshot.generatedAt + input.maximumAgeMs,
    snapshot
  });
}

export function validateAiCioCommandCenterEnvelope(
  envelope: AiCioCommandCenterEnvelopeV1,
  now: number
): AiCioCommandCenterEnvelopeV1 {
  assertTime(now, "now");
  if (envelope.version !== 1) throw new Error("unsupported AI CIO command center envelope version");
  if (envelope.mode !== "PAPER" && envelope.mode !== "DRY_RUN") throw new Error("invalid AI CIO command center mode");
  assertTime(envelope.generatedAt, "generatedAt");
  assertTime(envelope.expiresAt, "expiresAt");
  if (envelope.expiresAt <= envelope.generatedAt) throw new Error("invalid AI CIO command center expiry");
  if (envelope.generatedAt > now) throw new Error("AI CIO command center envelope cannot come from the future");
  if (now > envelope.expiresAt) throw new Error("AI CIO command center envelope is stale");
  if (envelope.snapshot.generatedAt !== envelope.generatedAt) throw new Error("AI CIO command center timestamp mismatch");
  return deepFreeze(clonePlain(envelope));
}
