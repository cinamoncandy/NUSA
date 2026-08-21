import {
  validatePersonalPaperOperationsSnapshot,
  type PersonalPaperOperationsSnapshot
} from "../../../../packages/contracts/src/personalPaperOperations";

export interface PersonalPaperOperationsEnvelope {
  readonly version: 1;
  readonly mode: "PAPER";
  readonly observedAt: number;
  readonly expiresAt: number;
  readonly snapshot: PersonalPaperOperationsSnapshot;
  readonly authority: "READ_ONLY";
}

const deepFreeze = <T>(value: T): T => {
  if (value != null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

/** Desktop presentation boundary: validates freshness/authority and exposes a frozen read-only envelope. */
export function buildPersonalPaperOperationsEnvelope(
  snapshot: PersonalPaperOperationsSnapshot,
  maximumAgeMs = 15_000,
  now = Date.now()
): PersonalPaperOperationsEnvelope {
  const validated = validatePersonalPaperOperationsSnapshot(snapshot, now, maximumAgeMs);
  return deepFreeze({
    version: 1 as const,
    mode: "PAPER" as const,
    observedAt: now,
    expiresAt: validated.generatedAt + maximumAgeMs,
    snapshot: validated,
    authority: "READ_ONLY" as const
  });
}

export function validatePersonalPaperOperationsEnvelope(
  envelope: PersonalPaperOperationsEnvelope,
  now = Date.now()
): PersonalPaperOperationsEnvelope {
  if (envelope.version !== 1 || envelope.mode !== "PAPER" || envelope.authority !== "READ_ONLY") {
    throw new Error("unsupported personal PAPER operations envelope");
  }
  if (now > envelope.expiresAt) throw new Error("personal PAPER operations envelope is stale");
  const maximumAgeMs = envelope.expiresAt - envelope.snapshot.generatedAt;
  validatePersonalPaperOperationsSnapshot(envelope.snapshot, now, maximumAgeMs);
  return deepFreeze(structuredClone(envelope));
}
