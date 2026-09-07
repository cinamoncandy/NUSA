import { createHash } from "node:crypto";
import {
  createEvolutionLearningRecord,
  type EvolutionLearningMemoryRepository,
  type EvolutionLearningRecord,
} from "./evolveLearningMemory";

export interface EvolutionLearningMemoryStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

interface PersistedEvolutionLearningMemory {
  readonly schemaVersion: 2;
  readonly records: readonly EvolutionLearningRecord[];
  readonly recordHashes: readonly string[];
  readonly ledgerHash: string;
}

const MEMORY_KEY = "evolve-learning-memory-v1";
const SCHEMA_VERSION = 2 as const;
const MAX_RECORDS = 256;
const GENESIS_HASH = "evolve-learning-memory-v2";
const ENVELOPE_KEYS = new Set(["schemaVersion", "records", "recordHashes", "ledgerHash"]);
const RECORD_KEYS = new Set([
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
const OUTCOMES = new Set<EvolutionLearningRecord["outcome"]>([
  "SUCCESS",
  "PARTIAL_SUCCESS",
  "UNDERPERFORMED",
  "FAILED",
  "REGRESSION",
  "UNKNOWN",
]);
const FORBIDDEN_KEY = /(password|secret|token|authorization|cookie|credential|private[_. -]?key|access[_. -]?key|nonce|signature|refresh[_. -]?token|account[_. -]?id)/i;
const FORBIDDEN_VALUE = /\b(?:bearer|jwt|password|api[_. -]?key|secret|token|private[_. -]?key|authorization|cookie)\s*[:=]/i;

function canonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("EVOLVE_DURABLE_MEMORY_NONFINITE");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return "{" + entries.map(([key, child]) => JSON.stringify(key) + ":" + canonical(child)).join(",") + "}";
  }
  throw new Error("EVOLVE_DURABLE_MEMORY_CANONICAL_INVALID");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertSafeValue(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (FORBIDDEN_VALUE.test(value)) throw new Error("EVOLVE_DURABLE_MEMORY_FORBIDDEN_VALUE:" + path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeValue(item, path + "[" + index + "]"));
    return;
  }
  if (value != null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY.test(key)) {
        throw new Error("EVOLVE_DURABLE_MEMORY_FORBIDDEN_FIELD:" + path + "." + key);
      }
      assertSafeValue(child, path + "." + key);
    }
  }
}

function normalizeRecord(value: unknown): EvolutionLearningRecord {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("EVOLVE_DURABLE_MEMORY_RECORD_INVALID");
  }
  assertSafeValue(value, "record");
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (keys.some((key) => !RECORD_KEYS.has(key)) || keys.length !== RECORD_KEYS.size) {
    throw new Error("EVOLVE_DURABLE_MEMORY_RECORD_FIELDS_INVALID");
  }

  const references = candidate.evidenceReferences as unknown[];
  if (
    typeof candidate.opportunityId !== "string"
    || typeof candidate.problem !== "string"
    || !Array.isArray(references)
    || typeof candidate.hypothesis !== "string"
    || typeof candidate.changeReference !== "string"
    || typeof candidate.validationStatus !== "string"
    || typeof candidate.recordedAt !== "string"
    || !OUTCOMES.has(candidate.outcome as EvolutionLearningRecord["outcome"])
    || (candidate.failureReason !== null && typeof candidate.failureReason !== "string")
    || (candidate.rollbackReference !== null && typeof candidate.rollbackReference !== "string")
    || typeof candidate.reusable !== "boolean"
  ) {
    throw new Error("EVOLVE_DURABLE_MEMORY_RECORD_INVALID");
  }
  if (
    references.some((reference) => typeof reference !== "string" || !reference.trim())
    || new Set(references).size !== references.length
  ) {
    throw new Error("EVOLVE_DURABLE_MEMORY_EVIDENCE_INVALID");
  }
  if (!Number.isFinite(Date.parse(candidate.recordedAt))) {
    throw new Error("EVOLVE_DURABLE_MEMORY_TIMESTAMP_INVALID");
  }

  return createEvolutionLearningRecord({
    opportunityId: candidate.opportunityId as string,
    problem: candidate.problem as string,
    evidenceReferences: references as string[],
    hypothesis: candidate.hypothesis as string,
    changeReference: candidate.changeReference as string,
    validationStatus: candidate.validationStatus as string,
    outcome: candidate.outcome as EvolutionLearningRecord["outcome"],
    failureReason: candidate.failureReason as string | null,
    rollbackReference: candidate.rollbackReference as string | null,
    reusable: candidate.reusable as boolean,
    recordedAt: candidate.recordedAt as string,
  });
}

function recordIdentity(record: EvolutionLearningRecord): string {
  return record.opportunityId + "\u0000" + record.changeReference;
}

function payloadHash(record: EvolutionLearningRecord): string {
  return sha256(canonical(record));
}

function chainHash(previousHash: string, record: EvolutionLearningRecord): string {
  return sha256(canonical({ previousHash, record }));
}

function buildChain(records: readonly EvolutionLearningRecord[]): readonly string[] {
  let previousHash = GENESIS_HASH;
  const hashes: string[] = [];
  for (const record of records) {
    const hash = chainHash(previousHash, record);
    hashes.push(hash);
    previousHash = hash;
  }
  return Object.freeze(hashes);
}

function validateRecords(
  values: readonly unknown[],
  expectedHashes?: readonly unknown[],
  expectedLedgerHash?: unknown,
): readonly EvolutionLearningRecord[] {
  if (expectedHashes !== undefined && expectedHashes.length !== values.length) {
    throw new Error("EVOLVE_DURABLE_MEMORY_HASH_LENGTH_INVALID");
  }
  const records: EvolutionLearningRecord[] = [];
  const identities = new Set<string>();
  let previousRecordedAt = -Infinity;
  let previousHash = GENESIS_HASH;

  values.forEach((value, index) => {
    const record = normalizeRecord(value);
    const identity = recordIdentity(record);
    if (identities.has(identity)) throw new Error("EVOLVE_DURABLE_MEMORY_IDENTITY_CONFLICT");
    identities.add(identity);

    const recordedAt = Date.parse(record.recordedAt);
    if (recordedAt < previousRecordedAt) {
      throw new Error("EVOLVE_DURABLE_MEMORY_TIMESTAMP_REGRESSION");
    }
    const hash = chainHash(previousHash, record);
    if (expectedHashes !== undefined && expectedHashes[index] !== hash) {
      throw new Error("EVOLVE_DURABLE_MEMORY_INTEGRITY_FAILED");
    }
    records.push(record);
    previousRecordedAt = recordedAt;
    previousHash = hash;
  });

  if (expectedLedgerHash !== undefined && expectedLedgerHash !== previousHash) {
    throw new Error("EVOLVE_DURABLE_MEMORY_LEDGER_INTEGRITY_FAILED");
  }
  return Object.freeze(records);
}

function parsePersistedValue(stored: unknown): readonly EvolutionLearningRecord[] {
  assertSafeValue(stored, "memory");
  if (Array.isArray(stored)) return validateRecords(stored);

  if (
    typeof stored !== "object"
    || stored === null
    || (stored as { schemaVersion?: unknown }).schemaVersion !== SCHEMA_VERSION
  ) {
    throw new Error("EVOLVE_DURABLE_MEMORY_INVALID");
  }

  const envelope = stored as Partial<PersistedEvolutionLearningMemory>;
  const envelopeKeys = Object.keys(envelope);
  if (
    envelopeKeys.some((key) => !ENVELOPE_KEYS.has(key))
    || envelopeKeys.length !== ENVELOPE_KEYS.size
    || !Array.isArray(envelope.records)
    || !Array.isArray(envelope.recordHashes)
    || typeof envelope.ledgerHash !== "string"
    || envelope.records.length > MAX_RECORDS
  ) {
    throw new Error("EVOLVE_DURABLE_MEMORY_INVALID");
  }
  return validateRecords(envelope.records, envelope.recordHashes, envelope.ledgerHash);
}

/** Validate a coordinator write before it reaches durable storage. */
export function validatePersistedEvolutionLearningMemory(value: unknown): void {
  if (value == null) throw new Error("EVOLVE_DURABLE_MEMORY_INVALID");
  parsePersistedValue(value);
}

/**
 * Durable, bounded adapter for the existing Level 7 learning-memory contract.
 *
 * The adapter owns no executor, queue, scheduler, lifecycle, promotion,
 * deployment, or production mutation authority. It validates the persistence
 * boundary, derives stable identities from opportunity/change references, and
 * stores a versioned integrity envelope so restart replay cannot silently
 * accept reordered, deleted, or mutated learning evidence.
 */
export class DurableEvolutionLearningMemory implements EvolutionLearningMemoryRepository {
  private readonly records: EvolutionLearningRecord[];
  private readonly recordHashes: string[];

  private constructor(records: readonly EvolutionLearningRecord[]) {
    this.records = [...records].slice(-MAX_RECORDS);
    this.recordHashes = [...buildChain(this.records)];
  }

  static async hydrate(storage: EvolutionLearningMemoryStorage): Promise<DurableEvolutionLearningMemory> {
    const stored = await storage.get<unknown>(MEMORY_KEY);
    if (stored == null) return new DurableEvolutionLearningMemory([]);

    return new DurableEvolutionLearningMemory(parsePersistedValue(stored));
  }

  append(record: EvolutionLearningRecord): void {
    const normalized = normalizeRecord(record);
    const identity = recordIdentity(normalized);
    const existing = this.records.find((candidate) => recordIdentity(candidate) === identity);
    if (existing !== undefined) {
      if (payloadHash(existing) === payloadHash(normalized)) return;
      throw new Error("EVOLVE_DURABLE_MEMORY_IDENTITY_CONFLICT");
    }

    const previous = this.records.at(-1);
    if (previous !== undefined && Date.parse(normalized.recordedAt) < Date.parse(previous.recordedAt)) {
      throw new Error("EVOLVE_DURABLE_MEMORY_TIMESTAMP_REGRESSION");
    }

    this.records.push(normalized);
    if (this.records.length > MAX_RECORDS) {
      this.records.splice(0, this.records.length - MAX_RECORDS);
    }
    this.recordHashes.splice(0, this.recordHashes.length, ...buildChain(this.records));
  }

  list(): readonly EvolutionLearningRecord[] {
    return Object.freeze([...this.records]);
  }

  async flush(storage: EvolutionLearningMemoryStorage): Promise<void> {
    try {
      const envelope: PersistedEvolutionLearningMemory = Object.freeze({
        schemaVersion: SCHEMA_VERSION,
        records: Object.freeze([...this.records]),
        recordHashes: Object.freeze([...this.recordHashes]),
        ledgerHash: this.recordHashes.at(-1) ?? GENESIS_HASH,
      });
      await storage.put(MEMORY_KEY, envelope);
    } catch {
      throw new Error("EVOLVE_DURABLE_MEMORY_PERSISTENCE_FAILED");
    }
  }
}
