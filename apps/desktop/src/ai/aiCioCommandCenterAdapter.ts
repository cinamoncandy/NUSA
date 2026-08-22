import type { AiCioDashboardSnapshot } from "../../../cloud/src/dashboardAggregator";

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


const DASHBOARD_STATUSES = new Set(["HEALTHY", "CAUTION", "BLOCKED", "NO_DATA"]);
const SECTION_STATUSES = new Set(["HEALTHY", "CAUTION", "BLOCKED"]);
const AVAILABILITIES = new Set(["AVAILABLE", "STALE", "UNAVAILABLE", "INVALID"]);
const SECTION_NAMES = ["portfolio", "opportunities", "strategies", "committee", "execution", "research", "risk"] as const;

const validateSnapshotShape = (snapshot: AiCioDashboardSnapshot, envelopeGeneratedAt: number): void => {
  if (!snapshot || typeof snapshot !== "object") throw new Error("AI CIO snapshot must be an object");
  assertTime(snapshot.generatedAt, "snapshot.generatedAt");
  if (snapshot.generatedAt !== envelopeGeneratedAt) throw new Error("AI CIO command center timestamp mismatch");
  if (!DASHBOARD_STATUSES.has(snapshot.status)) throw new Error("invalid AI CIO dashboard status");
  if (typeof snapshot.tradingPermitted !== "boolean") throw new Error("invalid AI CIO trading permission");
  if (snapshot.status !== "HEALTHY" && snapshot.tradingPermitted) throw new Error("non-healthy AI CIO dashboard cannot permit trading");
  if (!Array.isArray(snapshot.warnings) || snapshot.warnings.some((warning) => typeof warning !== "string" || !warning.trim())) {
    throw new Error("invalid AI CIO dashboard warnings");
  }

  for (const name of SECTION_NAMES) {
    const section = snapshot[name];
    if (!section || typeof section !== "object") throw new Error(`missing AI CIO dashboard section: ${name}`);
    if (!SECTION_STATUSES.has(section.status)) throw new Error(`invalid AI CIO dashboard section status: ${name}`);
    if (section.availability != null && !AVAILABILITIES.has(section.availability)) throw new Error(`invalid AI CIO dashboard availability: ${name}`);
    assertTime(section.generatedAt, `${name}.generatedAt`);
    if (section.generatedAt > snapshot.generatedAt) throw new Error(`AI CIO dashboard section is newer than snapshot: ${name}`);
    if (!Array.isArray(section.reasons) || section.reasons.some((reason) => typeof reason !== "string" || !reason.trim())) {
      throw new Error(`invalid AI CIO dashboard reasons: ${name}`);
    }
  }
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
  validateSnapshotShape(envelope.snapshot, envelope.generatedAt);
  return deepFreeze(clonePlain(envelope));
}
