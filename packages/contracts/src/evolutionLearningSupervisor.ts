export type EvolutionLearningSupervisorOutcome =
  | "SUCCESS"
  | "PARTIAL_SUCCESS"
  | "UNDERPERFORMED"
  | "FAILED"
  | "REGRESSION"
  | "UNKNOWN";

export interface EvolutionLearningSupervisorRecord {
  readonly opportunityId: string;
  readonly problem: string;
  readonly hypothesis: string;
  readonly outcome: EvolutionLearningSupervisorOutcome;
  readonly validationStatus: string;
  readonly evidenceReferences: readonly string[];
  readonly changeReference: string;
  readonly failureReason: string | null;
  readonly rollbackReference: string | null;
  readonly reusable: boolean;
  readonly recordedAt: string;
}

export interface EvolutionLearningSupervisorSnapshot {
  readonly schemaVersion: 1;
  readonly scope: "EVOLUTION_LEARNING_EVIDENCE_ONLY";
  readonly authority: "READ_ONLY";
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly eventCount: number;
  readonly headHash: string;
  readonly latest: EvolutionLearningSupervisorRecord | null;
  /** Newest-first bounded evidence history. Optional on input for schema-v1 compatibility. */
  readonly recent?: readonly EvolutionLearningSupervisorRecord[];
}

const OUTCOMES = new Set<EvolutionLearningSupervisorOutcome>([
  "SUCCESS",
  "PARTIAL_SUCCESS",
  "UNDERPERFORMED",
  "FAILED",
  "REGRESSION",
  "UNKNOWN",
]);
const SHA256 = /^[a-f0-9]{64}$/i;
const MAX_RECENT = 5;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is invalid`);
  return value.trim();
}

function nullableText(value: unknown, name: string): string | null {
  if (value == null) return null;
  return text(value, name);
}

function record(value: unknown): EvolutionLearningSupervisorRecord {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("evolution learning latest record is invalid");
  const input = value as Record<string, unknown>;
  if (!OUTCOMES.has(input.outcome as EvolutionLearningSupervisorOutcome)) throw new Error("evolution learning outcome is invalid");
  if (!Array.isArray(input.evidenceReferences) || input.evidenceReferences.length === 0 || input.evidenceReferences.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("evolution learning evidence is invalid");
  }
  if (typeof input.reusable !== "boolean") throw new Error("evolution learning reusable flag is invalid");
  const recordedAt = text(input.recordedAt, "recordedAt");
  if (!Number.isFinite(Date.parse(recordedAt))) throw new Error("evolution learning recordedAt is invalid");
  return freeze({
    opportunityId: text(input.opportunityId, "opportunityId"),
    problem: text(input.problem, "problem"),
    hypothesis: text(input.hypothesis, "hypothesis"),
    outcome: input.outcome as EvolutionLearningSupervisorOutcome,
    validationStatus: text(input.validationStatus, "validationStatus"),
    evidenceReferences: freeze((input.evidenceReferences as string[]).map((item) => item.trim())),
    changeReference: text(input.changeReference, "changeReference"),
    failureReason: nullableText(input.failureReason, "failureReason"),
    rollbackReference: nullableText(input.rollbackReference, "rollbackReference"),
    reusable: input.reusable,
    recordedAt,
  });
}

function sameIdentity(left: EvolutionLearningSupervisorRecord, right: EvolutionLearningSupervisorRecord): boolean {
  return left.opportunityId === right.opportunityId
    && left.changeReference === right.changeReference
    && left.recordedAt === right.recordedAt;
}

export function validateEvolutionLearningSupervisorSnapshot(value: unknown): EvolutionLearningSupervisorSnapshot {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("evolution learning supervisor snapshot is required");
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 1) throw new Error("unsupported evolution learning supervisor schema");
  if (input.scope !== "EVOLUTION_LEARNING_EVIDENCE_ONLY") throw new Error("evolution learning supervisor scope is invalid");
  if (input.authority !== "READ_ONLY") throw new Error("evolution learning supervisor authority must remain READ_ONLY");
  if (input.aiAuthority !== "ZERO_AUTHORITY") throw new Error("evolution learning supervisor AI authority must remain ZERO_AUTHORITY");
  if (input.liveAuthority !== "NONE") throw new Error("evolution learning supervisor LIVE authority must remain NONE");
  if (input.productionMutationAllowed !== false) throw new Error("evolution learning supervisor production mutation must remain false");
  if (!Number.isSafeInteger(input.eventCount) || (input.eventCount as number) < 0) throw new Error("evolution learning supervisor eventCount is invalid");
  if (typeof input.headHash !== "string" || !SHA256.test(input.headHash)) throw new Error("evolution learning supervisor headHash is invalid");
  const latest = input.latest == null ? null : record(input.latest);
  if ((input.eventCount as number) === 0 && latest !== null) throw new Error("evolution learning supervisor empty ledger cannot expose latest evidence");
  if ((input.eventCount as number) > 0 && latest === null) throw new Error("evolution learning supervisor non-empty ledger requires latest evidence");

  const recentInput = input.recent;
  if (recentInput != null && !Array.isArray(recentInput)) throw new Error("evolution learning recent evidence is invalid");
  if (Array.isArray(recentInput) && recentInput.length > MAX_RECENT) throw new Error("evolution learning recent evidence exceeds bounded history");
  const recent = freeze(
    recentInput == null
      ? (latest == null ? [] : [latest])
      : (recentInput as unknown[]).map((item) => record(item)),
  );
  if ((input.eventCount as number) === 0 && recent.length !== 0) throw new Error("evolution learning empty ledger cannot expose recent evidence");
  if ((input.eventCount as number) > 0 && recent.length === 0) throw new Error("evolution learning non-empty ledger requires recent evidence");
  if (recent.length > (input.eventCount as number)) throw new Error("evolution learning recent evidence exceeds ledger count");
  if (latest != null && !sameIdentity(recent[0]!, latest)) throw new Error("evolution learning recent evidence must start with latest evidence");
  for (let index = 1; index < recent.length; index += 1) {
    if (Date.parse(recent[index - 1]!.recordedAt) < Date.parse(recent[index]!.recordedAt)) {
      throw new Error("evolution learning recent evidence must be newest first");
    }
  }

  return freeze({
    schemaVersion: 1,
    scope: "EVOLUTION_LEARNING_EVIDENCE_ONLY",
    authority: "READ_ONLY",
    aiAuthority: "ZERO_AUTHORITY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    eventCount: input.eventCount as number,
    headHash: input.headHash.toLowerCase(),
    latest,
    recent,
  });
}
