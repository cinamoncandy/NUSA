import { createHash } from "node:crypto";

export type ResearchTrialOutcome = "COMPLETED" | "FAILED" | "REJECTED" | "ABSTAINED";

export interface ResearchTrialDatasetRef {
  readonly datasetId: string;
  readonly contentSha256: string;
  readonly market: string;
  readonly interval: string;
}

export interface ResearchTrialSearchContext {
  readonly searchId: string;
  readonly attemptOrdinal: number;
}

export interface ResearchTrialInput {
  readonly trialId: string;
  readonly familyId: string;
  readonly hypothesis: string;
  readonly createdAt: string;
  readonly dataset: ResearchTrialDatasetRef;
  readonly candidateIds: readonly string[];
  readonly search: ResearchTrialSearchContext;
  readonly outcome: ResearchTrialOutcome;
  readonly parentTrialId?: string;
  readonly score?: number;
  readonly metrics?: Readonly<Record<string, number | string | boolean | null>>;
  readonly rejectionReasons?: readonly string[];
  /** Reasons the canonical abstention engine withheld this trial from advancement. */
  readonly abstentionReasons?: readonly string[];
  readonly tags?: readonly string[];
}

export interface ResearchTrialRecord extends ResearchTrialInput {
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly previousRecordHash: string;
  readonly recordHash: string;
}

export interface ResearchTrialLedgerSummary {
  readonly trialCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly rejectedCount: number;
  readonly abstainedCount: number;
  readonly distinctSearchCount: number;
  readonly distinctFamilyCount: number;
  readonly maximumSearchAttemptOrdinal: number;
  readonly terminalRecordHash: string;
}

export class ResearchTrialLedgerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ResearchTrialLedgerError";
  }
}

const GENESIS_HASH = "0".repeat(64);
const HEX_64 = /^[0-9a-f]{64}$/;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new ResearchTrialLedgerError("EMPTY_FIELD", `${name} is required`);
}

function normalizeStringArray(values: readonly string[] | undefined, name: string): readonly string[] | undefined {
  if (values == null) return undefined;
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => value.length === 0)) throw new ResearchTrialLedgerError("EMPTY_ARRAY_VALUE", `${name} cannot contain empty values`);
  if (new Set(normalized).size !== normalized.length) throw new ResearchTrialLedgerError("DUPLICATE_ARRAY_VALUE", `${name} must be unique`);
  return Object.freeze([...normalized].sort((left, right) => left.localeCompare(right)));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value != null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .filter((key) => source[key] !== undefined)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, canonicalize(source[key])])
    );
  }
  return value;
}

export function canonicalSerializeResearchTrial(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function hashRecord(recordWithoutHash: Omit<ResearchTrialRecord, "recordHash">): string {
  return createHash("sha256").update(canonicalSerializeResearchTrial(recordWithoutHash), "utf8").digest("hex");
}

function validateInput(input: ResearchTrialInput): ResearchTrialInput {
  assertNonEmpty(input.trialId, "trialId");
  assertNonEmpty(input.familyId, "familyId");
  assertNonEmpty(input.hypothesis, "hypothesis");
  assertNonEmpty(input.dataset.datasetId, "dataset.datasetId");
  assertNonEmpty(input.dataset.market, "dataset.market");
  assertNonEmpty(input.dataset.interval, "dataset.interval");
  assertNonEmpty(input.search.searchId, "search.searchId");
  if (!HEX_64.test(input.dataset.contentSha256)) throw new ResearchTrialLedgerError("INVALID_DATASET_HASH", "dataset.contentSha256 must be a lowercase sha256 hex digest");
  if (!Number.isFinite(Date.parse(input.createdAt))) throw new ResearchTrialLedgerError("INVALID_CREATED_AT", "createdAt must be an ISO-compatible timestamp");
  if (!Number.isInteger(input.search.attemptOrdinal) || input.search.attemptOrdinal <= 0) throw new ResearchTrialLedgerError("INVALID_ATTEMPT_ORDINAL", "search.attemptOrdinal must be a positive integer");
  if (input.score != null && !Number.isFinite(input.score)) throw new ResearchTrialLedgerError("INVALID_SCORE", "score must be finite when supplied");
  const candidateIds = normalizeStringArray(input.candidateIds, "candidateIds") ?? Object.freeze([]);
  if (candidateIds.length === 0) throw new ResearchTrialLedgerError("EMPTY_CANDIDATES", "candidateIds requires at least one candidate");
  const rejectionReasons = normalizeStringArray(input.rejectionReasons, "rejectionReasons");
  const abstentionReasons = normalizeStringArray(input.abstentionReasons, "abstentionReasons");
  const tags = normalizeStringArray(input.tags, "tags");
  if (input.outcome === "REJECTED" && (rejectionReasons == null || rejectionReasons.length === 0)) {
    throw new ResearchTrialLedgerError("MISSING_REJECTION_REASON", "rejected trials require at least one rejection reason");
  }
  if (input.outcome !== "REJECTED" && rejectionReasons != null && rejectionReasons.length > 0) {
    throw new ResearchTrialLedgerError("UNEXPECTED_REJECTION_REASON", "only rejected trials may contain rejection reasons");
  }
  if (input.outcome === "ABSTAINED" && (abstentionReasons == null || abstentionReasons.length === 0)) {
    throw new ResearchTrialLedgerError("MISSING_ABSTENTION_REASON", "abstained trials require at least one abstention reason");
  }
  if (input.outcome !== "ABSTAINED" && abstentionReasons != null && abstentionReasons.length > 0) {
    throw new ResearchTrialLedgerError("UNEXPECTED_ABSTENTION_REASON", "only abstained trials may contain abstention reasons");
  }
  if (input.parentTrialId != null) assertNonEmpty(input.parentTrialId, "parentTrialId");
  const metrics = input.metrics == null ? undefined : freeze({ ...input.metrics });
  return freeze({
    trialId: input.trialId.trim(),
    familyId: input.familyId.trim(),
    hypothesis: input.hypothesis.trim(),
    createdAt: input.createdAt,
    dataset: freeze({
      datasetId: input.dataset.datasetId.trim(),
      contentSha256: input.dataset.contentSha256,
      market: input.dataset.market.trim(),
      interval: input.dataset.interval.trim()
    }),
    candidateIds,
    search: freeze({ searchId: input.search.searchId.trim(), attemptOrdinal: input.search.attemptOrdinal }),
    outcome: input.outcome,
    ...(input.parentTrialId != null ? { parentTrialId: input.parentTrialId.trim() } : {}),
    ...(input.score != null ? { score: input.score } : {}),
    ...(metrics != null ? { metrics } : {}),
    ...(rejectionReasons != null ? { rejectionReasons } : {}),
    ...(abstentionReasons != null ? { abstentionReasons } : {}),
    ...(tags != null ? { tags } : {})
  });
}

function expectedAttemptOrdinal(records: readonly ResearchTrialRecord[], searchId: string): number {
  const attempts = records.filter((record) => record.search.searchId === searchId).map((record) => record.search.attemptOrdinal);
  return attempts.length === 0 ? 1 : Math.max(...attempts) + 1;
}

export function appendResearchTrial(records: readonly ResearchTrialRecord[], input: ResearchTrialInput): readonly ResearchTrialRecord[] {
  verifyResearchTrialLedger(records);
  const normalized = validateInput(input);
  if (records.some((record) => record.trialId === normalized.trialId)) throw new ResearchTrialLedgerError("DUPLICATE_TRIAL_ID", `trialId ${normalized.trialId} already exists`);
  if (normalized.parentTrialId != null && !records.some((record) => record.trialId === normalized.parentTrialId)) {
    throw new ResearchTrialLedgerError("UNKNOWN_PARENT_TRIAL", `parentTrialId ${normalized.parentTrialId} does not exist in the ledger`);
  }
  const expectedOrdinal = expectedAttemptOrdinal(records, normalized.search.searchId);
  if (normalized.search.attemptOrdinal !== expectedOrdinal) {
    throw new ResearchTrialLedgerError("NON_CONTIGUOUS_SEARCH_ATTEMPT", `search ${normalized.search.searchId} expected attempt ${expectedOrdinal} but received ${normalized.search.attemptOrdinal}`);
  }
  const withoutHash: Omit<ResearchTrialRecord, "recordHash"> = freeze({
    ...normalized,
    schemaVersion: 1,
    sequence: records.length + 1,
    previousRecordHash: records.at(-1)?.recordHash ?? GENESIS_HASH
  });
  const record: ResearchTrialRecord = freeze({ ...withoutHash, recordHash: hashRecord(withoutHash) });
  return Object.freeze([...records, record]);
}

export function appendResearchTrialIdempotent(records: readonly ResearchTrialRecord[], input: ResearchTrialInput): readonly ResearchTrialRecord[] {
  verifyResearchTrialLedger(records);
  const normalized = validateInput(input);
  const existing = records.find((record) => record.trialId === normalized.trialId);
  if (existing == null) return appendResearchTrial(records, normalized);

  const { schemaVersion: _schemaVersion, sequence: _sequence, previousRecordHash: _previousRecordHash, recordHash: _recordHash, ...existingInput } = existing;
  if (canonicalSerializeResearchTrial(existingInput) !== canonicalSerializeResearchTrial(normalized)) {
    throw new ResearchTrialLedgerError(
      "REPLAY_EVIDENCE_MISMATCH",
      `trialId ${normalized.trialId} replay does not match persisted evidence`,
    );
  }
  return records;
}

export function verifyResearchTrialLedger(records: readonly ResearchTrialRecord[]): void {
  const trialIds = new Set<string>();
  const searchOrdinals = new Map<string, number>();
  let previousHash = GENESIS_HASH;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (record.schemaVersion !== 1) throw new ResearchTrialLedgerError("UNSUPPORTED_SCHEMA_VERSION", `record ${index + 1} has unsupported schemaVersion`);
    if (record.sequence !== index + 1) throw new ResearchTrialLedgerError("INVALID_SEQUENCE", `record ${index + 1} has invalid sequence`);
    if (trialIds.has(record.trialId)) throw new ResearchTrialLedgerError("DUPLICATE_TRIAL_ID", `trialId ${record.trialId} is duplicated`);
    trialIds.add(record.trialId);
    if (record.parentTrialId != null && !trialIds.has(record.parentTrialId)) throw new ResearchTrialLedgerError("UNKNOWN_PARENT_TRIAL", `parentTrialId ${record.parentTrialId} must refer to an earlier trial`);
    const expectedOrdinal = (searchOrdinals.get(record.search.searchId) ?? 0) + 1;
    if (record.search.attemptOrdinal !== expectedOrdinal) throw new ResearchTrialLedgerError("NON_CONTIGUOUS_SEARCH_ATTEMPT", `search ${record.search.searchId} expected attempt ${expectedOrdinal}`);
    searchOrdinals.set(record.search.searchId, record.search.attemptOrdinal);
    if (record.previousRecordHash !== previousHash) throw new ResearchTrialLedgerError("BROKEN_HASH_CHAIN", `record ${record.sequence} previousRecordHash does not match`);
    const { recordHash, ...withoutHash } = record;
    if (!HEX_64.test(recordHash) || hashRecord(withoutHash) !== recordHash) throw new ResearchTrialLedgerError("RECORD_HASH_MISMATCH", `record ${record.sequence} hash does not match content`);
    previousHash = recordHash;
  }
}

export function summarizeResearchTrialLedger(records: readonly ResearchTrialRecord[]): ResearchTrialLedgerSummary {
  verifyResearchTrialLedger(records);
  const searchIds = new Set<string>();
  const familyIds = new Set<string>();
  let maximumSearchAttemptOrdinal = 0;
  let completedCount = 0;
  let failedCount = 0;
  let rejectedCount = 0;
  let abstainedCount = 0;
  for (const record of records) {
    searchIds.add(record.search.searchId);
    familyIds.add(record.familyId);
    maximumSearchAttemptOrdinal = Math.max(maximumSearchAttemptOrdinal, record.search.attemptOrdinal);
    if (record.outcome === "COMPLETED") completedCount += 1;
    else if (record.outcome === "FAILED") failedCount += 1;
    else if (record.outcome === "REJECTED") rejectedCount += 1;
    else abstainedCount += 1;
  }
  return freeze({
    trialCount: records.length,
    completedCount,
    failedCount,
    rejectedCount,
    abstainedCount,
    distinctSearchCount: searchIds.size,
    distinctFamilyCount: familyIds.size,
    maximumSearchAttemptOrdinal,
    terminalRecordHash: records.at(-1)?.recordHash ?? GENESIS_HASH
  });
}

export function serializeResearchTrialLedger(records: readonly ResearchTrialRecord[]): string {
  verifyResearchTrialLedger(records);
  return records.map((record) => canonicalSerializeResearchTrial(record)).join("\n") + (records.length === 0 ? "" : "\n");
}

export function parseResearchTrialLedger(serialized: string): readonly ResearchTrialRecord[] {
  const trimmed = serialized.trim();
  if (!trimmed) return Object.freeze([]);
  const records = trimmed.split(/\r?\n/).map((line, index) => {
    try {
      return JSON.parse(line) as ResearchTrialRecord;
    } catch (error) {
      throw new ResearchTrialLedgerError("INVALID_JSONL", `line ${index + 1} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  verifyResearchTrialLedger(records);
  return Object.freeze(records.map((record) => freeze({ ...record })));
}
