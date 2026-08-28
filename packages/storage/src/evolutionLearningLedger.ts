import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { EvolutionLearningRecord } from "../../../apps/autopilot/src/evolveLearningMemory";
import { canonicalResearchJson } from "../../contracts/src/researchRuntime";

const SCHEMA_VERSION = 1 as const;
const GENESIS_HASH = "0".repeat(64);
const MAX_RECORDS = 4_096;
const OUTCOMES = new Set<EvolutionLearningRecord["outcome"]>([
  "SUCCESS",
  "PARTIAL_SUCCESS",
  "UNDERPERFORMED",
  "FAILED",
  "REGRESSION",
  "UNKNOWN",
]);
const REFERENCE = /^[A-Za-z0-9_.:/#@-]{1,240}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FORBIDDEN_KEY = /(?:password|authorization|cookie|credential|secret|token|nonce|signature|private|access[_-]?key)/i;
const FORBIDDEN_VALUE = /(?:bearer\s+[A-Za-z0-9._-]+|(?:api|access|secret|private)[_-]?key\s*[:=]|-----BEGIN|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.)/i;
const FIELDS = new Set([
  "opportunityId",
  "problem",
  "evidenceReferences",
  "hypothesis",
  "changeReference",
  "validationStatus",
  "outcome",
  "failureReason",
  "rollbackReference",
  "reusable",
  "recordedAt",
]);

export interface EvolutionLearningLedgerDatabase {
  readonly connection: DatabaseSync;
  transaction<T>(fn: () => T): T;
}

export interface EvolutionLearningLedgerReplay {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly records: readonly EvolutionLearningRecord[];
  readonly eventCount: number;
  readonly headHash: string;
}

export class EvolutionLearningLedgerError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "EvolutionLearningLedgerError";
  }
}

interface LedgerMetaRow {
  schema_version: number | bigint;
  event_count: number | bigint;
  ledger_hash: string;
}

interface LedgerEventRow {
  sequence: number | bigint;
  opportunity_id: string;
  content_hash: string;
  payload_json: string;
  recorded_at: string;
  previous_hash: string;
  event_hash: string;
}

function invalid(code: string, message: string): never {
  throw new EvolutionLearningLedgerError(code, `${code}: ${message}`);
}

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") invalid("INVALID_RECORD", `${field} must be text`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || FORBIDDEN_VALUE.test(normalized)) invalid("INVALID_RECORD", `${field} is invalid`);
  return normalized;
}

function nullableText(value: unknown, field: string, maximum: number): string | null {
  if (value == null) return null;
  return text(value, field, maximum);
}

function recordedAt(value: unknown): string {
  const normalized = text(value, "recordedAt", 40);
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) invalid("INVALID_RECORD", "recordedAt must be an ISO timestamp");
  return new Date(timestamp).toISOString();
}

function normalize(value: EvolutionLearningRecord): EvolutionLearningRecord {
  if (value == null || typeof value !== "object" || Array.isArray(value)) invalid("INVALID_RECORD", "learning record must be an object");
  const candidate = value as unknown as Record<string, unknown>;
  for (const key of Object.keys(candidate)) {
    if (!FIELDS.has(key) || FORBIDDEN_KEY.test(key)) invalid("FORBIDDEN_FIELD", "learning record contains a forbidden field");
  }
  const opportunityId = text(candidate.opportunityId, "opportunityId", 160);
  const problem = text(candidate.problem, "problem", 2_000);
  if (!Array.isArray(candidate.evidenceReferences) || candidate.evidenceReferences.length === 0) invalid("EVIDENCE_REQUIRED", "learning evidence is required");
  const evidenceReferences = candidate.evidenceReferences.map((reference) => {
    const normalized = text(reference, "evidenceReference", 240);
    if (!REFERENCE.test(normalized)) invalid("INVALID_EVIDENCE_REFERENCE", "learning evidence reference is invalid");
    return normalized;
  });
  const uniqueEvidenceReferences = [...new Set(evidenceReferences)].sort((left, right) => left.localeCompare(right));
  if (uniqueEvidenceReferences.length === 0) invalid("EVIDENCE_REQUIRED", "learning evidence is required");
  const hypothesis = text(candidate.hypothesis, "hypothesis", 2_000);
  const changeReference = text(candidate.changeReference, "changeReference", 240);
  const validationStatus = text(candidate.validationStatus, "validationStatus", 80);
  if (typeof candidate.outcome !== "string" || !OUTCOMES.has(candidate.outcome as EvolutionLearningRecord["outcome"])) invalid("INVALID_RECORD", "learning outcome is invalid");
  if (typeof candidate.reusable !== "boolean") invalid("INVALID_RECORD", "learning reusable flag is invalid");
  const failureReason = nullableText(candidate.failureReason, "failureReason", 1_000);
  const rollbackReference = nullableText(candidate.rollbackReference, "rollbackReference", 240);
  return Object.freeze({
    opportunityId,
    problem,
    evidenceReferences: Object.freeze(uniqueEvidenceReferences),
    hypothesis,
    changeReference,
    validationStatus,
    outcome: candidate.outcome as EvolutionLearningRecord["outcome"],
    failureReason,
    rollbackReference,
    reusable: candidate.reusable,
    recordedAt: recordedAt(candidate.recordedAt),
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function contentHash(record: EvolutionLearningRecord): string {
  return sha256(canonicalResearchJson(record));
}

function hashValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) invalid("CORRUPTED_LEDGER", `${field} is not a SHA-256 hash`);
  return value.toLowerCase();
}

function safeInteger(value: unknown, field: string): number {
  const normalized = typeof value === "bigint" ? Number(value) : value;
  if (typeof normalized !== "number" || !Number.isSafeInteger(normalized) || normalized < 0) invalid("CORRUPTED_LEDGER", `${field} is invalid`);
  return normalized;
}

function canonicalEvent(sequence: number, record: EvolutionLearningRecord, previousHash: string): string {
  return canonicalResearchJson({
    schemaVersion: SCHEMA_VERSION,
    sequence,
    opportunityId: record.opportunityId,
    contentHash: contentHash(record),
    payload: record,
    recordedAt: record.recordedAt,
    previousHash,
  });
}

function eventHash(sequence: number, record: EvolutionLearningRecord, previousHash: string): string {
  return sha256(canonicalEvent(sequence, record, previousHash));
}

function parsePayload(payload: unknown): EvolutionLearningRecord {
  if (typeof payload !== "string") invalid("CORRUPTED_LEDGER", "learning payload is not text");
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    invalid("CORRUPTED_LEDGER", "learning payload is not valid JSON");
  }
  let normalized: EvolutionLearningRecord;
  try {
    normalized = normalize(parsed as EvolutionLearningRecord);
  } catch {
    invalid("CORRUPTED_LEDGER", "learning payload failed validation");
  }
  if (canonicalResearchJson(normalized) !== payload) invalid("CORRUPTED_LEDGER", "learning payload is not canonical");
  return normalized;
}

function readMeta(connection: EvolutionLearningLedgerDatabase["connection"]): { readonly eventCount: number; readonly ledgerHash: string } {
  const row = connection.prepare("SELECT schema_version, event_count, ledger_hash FROM evolution_learning_ledger_meta WHERE id = 1").get() as LedgerMetaRow | undefined;
  if (row == null) invalid("CORRUPTED_LEDGER", "learning ledger metadata is missing");
  if (safeInteger(row.schema_version, "schemaVersion") !== SCHEMA_VERSION) invalid("UNSUPPORTED_SCHEMA", "learning ledger schema is unsupported");
  return Object.freeze({ eventCount: safeInteger(row.event_count, "eventCount"), ledgerHash: hashValue(row.ledger_hash, "ledgerHash") });
}

export class SqliteEvolutionLearningLedger {
  private readonly maximumRecords: number;
  private cached: EvolutionLearningLedgerReplay;

  public constructor(private readonly db: EvolutionLearningLedgerDatabase, maximumRecords = MAX_RECORDS) {
    if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 1 || maximumRecords > MAX_RECORDS) invalid("INVALID_RETENTION", "learning ledger capacity is invalid");
    this.maximumRecords = maximumRecords;
    this.cached = this.replay();
  }

  public append(value: EvolutionLearningRecord): EvolutionLearningRecord {
    const record = normalize(value);
    const current = this.replay();
    const existing = current.records.find((item) => item.opportunityId === record.opportunityId);
    if (existing != null) {
      if (contentHash(existing) !== contentHash(record)) invalid("IDENTITY_CONFLICT", "learning opportunity was reused with different evidence");
      return existing;
    }
    if (current.records.length >= this.maximumRecords) invalid("CAPACITY_EXCEEDED", "learning ledger capacity is exhausted");
    const previous = current.records.at(-1);
    if (previous != null && Date.parse(record.recordedAt) < Date.parse(previous.recordedAt)) invalid("CHRONOLOGY_REGRESSION", "learning record timestamp regressed");

    this.db.transaction(() => {
      const meta = readMeta(this.db.connection);
      if (meta.eventCount !== current.eventCount || meta.ledgerHash !== current.headHash) invalid("CONCURRENT_CHANGE", "learning ledger changed during append");
      const sequence = meta.eventCount + 1;
      const previousHash = meta.ledgerHash;
      const currentContentHash = contentHash(record);
      const currentEventHash = eventHash(sequence, record, previousHash);
      this.db.connection.prepare(
        "INSERT INTO evolution_learning_ledger_events (sequence, opportunity_id, content_hash, payload_json, recorded_at, previous_hash, event_hash) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(sequence, record.opportunityId, currentContentHash, canonicalResearchJson(record), record.recordedAt, previousHash, currentEventHash);
      this.db.connection.prepare(
        "UPDATE evolution_learning_ledger_meta SET event_count = ?, ledger_hash = ? WHERE id = 1 AND schema_version = ?"
      ).run(sequence, currentEventHash, SCHEMA_VERSION);
    });
    this.cached = this.replay();
    return this.cached.records.at(-1)!;
  }

  public replay(): EvolutionLearningLedgerReplay {
    const meta = readMeta(this.db.connection);
    const rows = this.db.connection.prepare(
      "SELECT sequence, opportunity_id, content_hash, payload_json, recorded_at, previous_hash, event_hash FROM evolution_learning_ledger_events ORDER BY sequence ASC"
    ).all() as unknown as LedgerEventRow[];
    if (rows.length !== meta.eventCount) invalid("CORRUPTED_LEDGER", "learning ledger event count mismatch");
    const records: EvolutionLearningRecord[] = [];
    let previousHash = GENESIS_HASH;
    let previousRecordedAt = -1;
    rows.forEach((row, index) => {
      const sequence = safeInteger(row.sequence, "sequence");
      if (sequence !== index + 1) invalid("CORRUPTED_LEDGER", "learning ledger sequence is not contiguous");
      const opportunityId = text(row.opportunity_id, "opportunityId", 160);
      const storedContentHash = hashValue(row.content_hash, "contentHash");
      const storedPreviousHash = hashValue(row.previous_hash, "previousHash");
      const storedEventHash = hashValue(row.event_hash, "eventHash");
      if (storedPreviousHash !== previousHash) invalid("CORRUPTED_LEDGER", "learning ledger hash chain is broken");
      const record = parsePayload(row.payload_json);
      const observedAt = Date.parse(record.recordedAt);
      if (observedAt < previousRecordedAt) invalid("CORRUPTED_LEDGER", "learning ledger chronology regressed");
      if (record.opportunityId !== opportunityId || record.recordedAt !== row.recorded_at || contentHash(record) !== storedContentHash) invalid("CORRUPTED_LEDGER", "learning ledger row identity is inconsistent");
      if (eventHash(sequence, record, storedPreviousHash) !== storedEventHash) invalid("CORRUPTED_LEDGER", "learning ledger event hash is invalid");
      records.push(record);
      previousHash = storedEventHash;
      previousRecordedAt = observedAt;
    });
    if (previousHash !== meta.ledgerHash) invalid("CORRUPTED_LEDGER", "learning ledger head hash is invalid");
    this.cached = Object.freeze({ schemaVersion: SCHEMA_VERSION, records: Object.freeze(records), eventCount: records.length, headHash: previousHash });
    return this.cached;
  }

  public list(): readonly EvolutionLearningRecord[] {
    return this.replay().records;
  }

  public get(opportunityId: string): EvolutionLearningRecord | undefined {
    const id = text(opportunityId, "opportunityId", 160);
    return this.replay().records.find((record) => record.opportunityId === id);
  }

  public headHash(): string {
    return this.replay().headHash;
  }

  public size(): number {
    return this.replay().eventCount;
  }
}
