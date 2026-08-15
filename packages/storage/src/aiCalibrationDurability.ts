import { DatabaseSync } from "node:sqlite";
import {
  aiSha256,
  canonicalAiJson,
  isAiSha256,
  type AiCalibrationOutcome,
  type AiCalibrationPrediction
} from "../../contracts/src/aiInference";
import type {
  AiCalibrationDurableReplay,
  AiCalibrationDurableStore,
  AiCalibrationPendingExpiry
} from "../../contracts/src/aiCalibrationDurability";

const SCHEMA_VERSION = 1 as const;
const GENESIS_HASH = "0".repeat(64);
type EventType = "PREDICTION" | "OUTCOME_RESOLVED" | "PENDING_EXPIRED";

type SqlRow = Record<string, string | number | bigint | null>;

interface EventRow extends SqlRow {
  sequence: number | bigint;
  event_type: string;
  prediction_id: string;
  prediction_content_hash: string;
  payload_json: string;
  recorded_at: number | bigint;
  previous_hash: string;
  event_hash: string;
}

interface MetaRow extends SqlRow {
  schema_version: number | bigint;
  event_count: number | bigint;
  ledger_hash: string;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ai_calibration_durability_meta (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  schema_version INTEGER NOT NULL,
  event_count INTEGER NOT NULL CHECK(event_count >= 0),
  ledger_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_calibration_durability_events (
  sequence INTEGER PRIMARY KEY,
  event_type TEXT NOT NULL CHECK(event_type IN ('PREDICTION','OUTCOME_RESOLVED','PENDING_EXPIRED')),
  prediction_id TEXT NOT NULL,
  prediction_content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  previous_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL UNIQUE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_calibration_prediction_once
  ON ai_calibration_durability_events(prediction_id)
  WHERE event_type = 'PREDICTION';
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_calibration_terminal_once
  ON ai_calibration_durability_events(prediction_id)
  WHERE event_type IN ('OUTCOME_RESOLVED','PENDING_EXPIRED');
`;

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value.trim();
}

function nonNegativeSafeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
  return value;
}

function asSafeInteger(value: string | number | bigint | null, field: string): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted) || converted < 0) throw new Error(`${field} must be a non-negative safe integer`);
  return converted;
}

function asHash(value: unknown, field: string): string {
  if (!isAiSha256(value)) throw new Error(`${field} must be sha256`);
  return value.toLowerCase();
}

function parseCanonicalJson(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "string") throw new Error("durable calibration payload must be text");
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new Error("durable calibration payload JSON is invalid"); }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("durable calibration payload must be an object");
  if (canonicalAiJson(parsed) !== value) throw new Error("durable calibration payload is not canonical");
  return parsed as Readonly<Record<string, unknown>>;
}

function predictionPayload(prediction: AiCalibrationPrediction): AiCalibrationPrediction {
  return Object.freeze({
    predictionId: requiredText(prediction.predictionId, "predictionId"),
    orchestrationRunId: requiredText(prediction.orchestrationRunId, "orchestrationRunId"),
    proposalId: requiredText(prediction.proposalId, "proposalId"),
    agentId: requiredText(prediction.agentId, "agentId"),
    role: prediction.role,
    providerId: requiredText(prediction.providerId, "providerId"),
    modelVersionId: requiredText(prediction.modelVersionId, "modelVersionId"),
    promptArtifactId: requiredText(prediction.promptArtifactId, "promptArtifactId"),
    promptArtifactVersion: requiredText(prediction.promptArtifactVersion, "promptArtifactVersion"),
    promptArtifactDigest: asHash(prediction.promptArtifactDigest, "promptArtifactDigest"),
    outcomeDefinitionId: requiredText(prediction.outcomeDefinitionId, "outcomeDefinitionId"),
    outcomeDefinitionVersion: requiredText(prediction.outcomeDefinitionVersion, "outcomeDefinitionVersion"),
    targetId: requiredText(prediction.targetId, "targetId"),
    anchorValue: prediction.anchorValue,
    anchorObservedAt: prediction.anchorObservedAt,
    anchorEvidenceReference: requiredText(prediction.anchorEvidenceReference, "anchorEvidenceReference"),
    rawProbability: prediction.rawProbability,
    predictedAt: prediction.predictedAt,
    horizonMs: prediction.horizonMs,
    provenance: prediction.provenance,
    contentHash: asHash(prediction.contentHash, "prediction.contentHash")
  });
}

function outcomePayload(outcome: AiCalibrationOutcome): AiCalibrationOutcome {
  return Object.freeze({
    predictionId: requiredText(outcome.predictionId, "predictionId"),
    predictionContentHash: asHash(outcome.predictionContentHash, "predictionContentHash"),
    outcomeDefinitionId: requiredText(outcome.outcomeDefinitionId, "outcomeDefinitionId"),
    outcomeDefinitionVersion: requiredText(outcome.outcomeDefinitionVersion, "outcomeDefinitionVersion"),
    outcome: outcome.outcome,
    resolvedValue: outcome.resolvedValue,
    resolvedAt: outcome.resolvedAt,
    evidenceReferences: Object.freeze(outcome.evidenceReferences.map((reference) => requiredText(reference, "evidenceReference"))),
    provenance: outcome.provenance,
    contentHash: asHash(outcome.contentHash, "outcome.contentHash")
  });
}

function expiryPayload(expiry: AiCalibrationPendingExpiry): AiCalibrationPendingExpiry {
  return Object.freeze({
    predictionId: requiredText(expiry.predictionId, "predictionId"),
    predictionContentHash: asHash(expiry.predictionContentHash, "predictionContentHash"),
    expiredAt: nonNegativeSafeInteger(expiry.expiredAt, "expiredAt")
  });
}

function eventIdentity(
  sequence: number,
  eventType: EventType,
  predictionId: string,
  predictionContentHash: string,
  payload: Readonly<Record<string, unknown>>,
  recordedAt: number,
  previousHash: string
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    sequence,
    eventType,
    predictionId,
    predictionContentHash,
    payload,
    recordedAt,
    previousHash
  });
}

export class SqliteAiCalibrationDurableStore implements AiCalibrationDurableStore {
  private readonly connection: DatabaseSync;
  private closed = false;
  /**
   * In-memory mirror of the verified chain, refreshed in full by replay() (still a genuine full
   * disk read + hash-chain re-verification) and extended incrementally after each successful
   * appendEvent() commit. appendPrediction/appendOutcomeAndResolve/expirePending previously each
   * called this.replay() themselves -- an O(n) re-walk-and-reverify of the entire table on every
   * single write to an append-only, ever-growing ledger. ensureCache() lazily warms the cache via
   * a real replay() the first time it's needed, so correctness never depends on caller order.
   */
  private cacheWarmed = false;
  private cachedPredictions = new Map<string, AiCalibrationPrediction>();
  private cachedOutcomes = new Map<string, AiCalibrationOutcome>();
  private cachedExpired = new Map<string, AiCalibrationPendingExpiry>();

  public constructor(filename = ":memory:") {
    this.connection = new DatabaseSync(filename);
    try {
      this.connection.exec("PRAGMA foreign_keys = ON");
      this.connection.exec("PRAGMA busy_timeout = 5000");
      if (filename !== ":memory:") this.connection.exec("PRAGMA journal_mode = WAL");
      this.connection.exec("PRAGMA synchronous = FULL");
      this.ensureSchema();
      const check = this.connection.prepare("PRAGMA quick_check").get() as Record<string, unknown> | undefined;
      if (check == null || !Object.values(check).includes("ok")) throw new Error("AI calibration sqlite quick_check failed");
    } catch (error) {
      this.connection.close();
      this.closed = true;
      throw error;
    }
  }

  public replay(): AiCalibrationDurableReplay {
    this.assertOpen();
    const meta = this.readMeta();
    const rows = this.connection.prepare(
      "SELECT sequence, event_type, prediction_id, prediction_content_hash, payload_json, recorded_at, previous_hash, event_hash FROM ai_calibration_durability_events ORDER BY sequence ASC"
    ).all() as unknown as EventRow[];
    if (rows.length !== meta.eventCount) throw new Error("durable calibration event count mismatch");

    const predictions = new Map<string, AiCalibrationPrediction>();
    const outcomes = new Map<string, AiCalibrationOutcome>();
    const expired = new Map<string, AiCalibrationPendingExpiry>();
    let previousHash = GENESIS_HASH;

    rows.forEach((row, index) => {
      const sequence = asSafeInteger(row.sequence, "sequence");
      if (sequence !== index + 1) throw new Error("durable calibration sequence is not contiguous");
      const eventType = requiredText(row.event_type, "eventType") as EventType;
      if (eventType !== "PREDICTION" && eventType !== "OUTCOME_RESOLVED" && eventType !== "PENDING_EXPIRED") throw new Error("unsupported durable calibration event type");
      const predictionId = requiredText(row.prediction_id, "predictionId");
      const predictionContentHash = asHash(row.prediction_content_hash, "predictionContentHash");
      const recordedAt = asSafeInteger(row.recorded_at, "recordedAt");
      const storedPreviousHash = asHash(row.previous_hash, "previousHash");
      const storedEventHash = asHash(row.event_hash, "eventHash");
      if (storedPreviousHash !== previousHash) throw new Error("durable calibration hash chain mismatch");
      const payload = parseCanonicalJson(row.payload_json);
      const expectedHash = aiSha256(eventIdentity(sequence, eventType, predictionId, predictionContentHash, payload, recordedAt, storedPreviousHash));
      if (expectedHash !== storedEventHash) throw new Error("durable calibration event hash mismatch");

      if (eventType === "PREDICTION") {
        if (predictions.has(predictionId)) throw new Error("duplicate durable calibration prediction event");
        const prediction = payload as unknown as AiCalibrationPrediction;
        if (requiredText(prediction.predictionId, "prediction.predictionId") !== predictionId) throw new Error("durable calibration prediction identity mismatch");
        if (asHash(prediction.contentHash, "prediction.contentHash") !== predictionContentHash) throw new Error("durable calibration prediction content hash mismatch");
        predictions.set(predictionId, predictionPayload(prediction));
      } else if (eventType === "OUTCOME_RESOLVED") {
        const prediction = predictions.get(predictionId);
        if (prediction == null) throw new Error("durable calibration outcome precedes prediction");
        if (prediction.contentHash.toLowerCase() !== predictionContentHash) throw new Error("durable calibration outcome linkage mismatch");
        if (expired.has(predictionId)) throw new Error("durable calibration outcome follows expiry");
        if (outcomes.has(predictionId)) throw new Error("duplicate durable calibration outcome event");
        const outcome = payload as unknown as AiCalibrationOutcome;
        if (requiredText(outcome.predictionId, "outcome.predictionId") !== predictionId) throw new Error("durable calibration outcome identity mismatch");
        if (asHash(outcome.predictionContentHash, "outcome.predictionContentHash") !== predictionContentHash) throw new Error("durable calibration outcome prediction hash mismatch");
        outcomes.set(predictionId, outcomePayload(outcome));
      } else {
        const prediction = predictions.get(predictionId);
        if (prediction == null) throw new Error("durable calibration expiry precedes prediction");
        if (prediction.contentHash.toLowerCase() !== predictionContentHash) throw new Error("durable calibration expiry linkage mismatch");
        if (outcomes.has(predictionId)) throw new Error("durable calibration expiry follows outcome");
        if (expired.has(predictionId)) throw new Error("duplicate durable calibration expiry event");
        const item = payload as unknown as AiCalibrationPendingExpiry;
        const normalized = expiryPayload(item);
        if (normalized.predictionId !== predictionId || normalized.predictionContentHash !== predictionContentHash) throw new Error("durable calibration expiry identity mismatch");
        expired.set(predictionId, normalized);
      }
      previousHash = storedEventHash;
    });

    if (previousHash !== meta.ledgerHash) throw new Error("durable calibration ledger head mismatch");
    this.cachedPredictions = predictions;
    this.cachedOutcomes = outcomes;
    this.cachedExpired = expired;
    this.cacheWarmed = true;
    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      predictions: Object.freeze([...predictions.values()]),
      outcomes: Object.freeze([...outcomes.values()]),
      expiredPending: Object.freeze([...expired.values()]),
      eventCount: rows.length,
      headHash: previousHash
    });
  }

  /** Lazily warms the cache via a real replay() the first time it's needed. */
  private ensureCache(): void {
    if (!this.cacheWarmed) this.replay();
  }

  public appendPrediction(prediction: AiCalibrationPrediction, recordedAt: number): void {
    const normalized = predictionPayload(prediction);
    this.ensureCache();
    const prior = this.cachedPredictions.get(normalized.predictionId);
    if (prior != null) {
      if (prior.contentHash.toLowerCase() !== normalized.contentHash.toLowerCase()) throw new Error("conflicting durable calibration prediction replay");
      return;
    }
    this.appendEvent("PREDICTION", normalized.predictionId, normalized.contentHash, normalized as unknown as Readonly<Record<string, unknown>>, recordedAt);
    this.cachedPredictions.set(normalized.predictionId, normalized);
  }

  public appendOutcomeAndResolve(outcome: AiCalibrationOutcome, recordedAt: number): void {
    const normalized = outcomePayload(outcome);
    this.ensureCache();
    const prediction = this.cachedPredictions.get(normalized.predictionId);
    if (prediction == null) throw new Error("durable calibration prediction is missing");
    if (prediction.contentHash.toLowerCase() !== normalized.predictionContentHash.toLowerCase()) throw new Error("durable calibration outcome prediction hash mismatch");
    const priorOutcome = this.cachedOutcomes.get(normalized.predictionId);
    if (priorOutcome != null) {
      if (priorOutcome.contentHash.toLowerCase() !== normalized.contentHash.toLowerCase()) throw new Error("conflicting durable calibration outcome replay");
      return;
    }
    if (this.cachedExpired.has(normalized.predictionId)) throw new Error("durable calibration prediction is already expired");
    this.appendEvent("OUTCOME_RESOLVED", normalized.predictionId, normalized.predictionContentHash, normalized as unknown as Readonly<Record<string, unknown>>, recordedAt);
    this.cachedOutcomes.set(normalized.predictionId, normalized);
  }

  public expirePending(expiry: AiCalibrationPendingExpiry): void {
    const normalized = expiryPayload(expiry);
    this.ensureCache();
    const prediction = this.cachedPredictions.get(normalized.predictionId);
    if (prediction == null) throw new Error("durable calibration prediction is missing");
    if (prediction.contentHash.toLowerCase() !== normalized.predictionContentHash.toLowerCase()) throw new Error("durable calibration expiry prediction hash mismatch");
    if (this.cachedOutcomes.has(normalized.predictionId)) throw new Error("durable calibration prediction is already resolved");
    const prior = this.cachedExpired.get(normalized.predictionId);
    if (prior != null) {
      if (prior.predictionContentHash !== normalized.predictionContentHash || prior.expiredAt !== normalized.expiredAt) throw new Error("conflicting durable calibration expiry replay");
      return;
    }
    this.appendEvent("PENDING_EXPIRED", normalized.predictionId, normalized.predictionContentHash, normalized as unknown as Readonly<Record<string, unknown>>, normalized.expiredAt);
    this.cachedExpired.set(normalized.predictionId, normalized);
  }

  public close(): void {
    if (this.closed) return;
    this.connection.close();
    this.closed = true;
  }

  private appendEvent(
    eventType: EventType,
    predictionId: string,
    predictionContentHash: string,
    payload: Readonly<Record<string, unknown>>,
    recordedAtValue: number
  ): void {
    this.assertOpen();
    const recordedAt = nonNegativeSafeInteger(recordedAtValue, "recordedAt");
    const payloadJson = canonicalAiJson(payload);
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const meta = this.readMeta();
      const sequence = meta.eventCount + 1;
      const eventHash = aiSha256(eventIdentity(sequence, eventType, predictionId, predictionContentHash, payload, recordedAt, meta.ledgerHash));
      this.connection.prepare(
        "INSERT INTO ai_calibration_durability_events (sequence, event_type, prediction_id, prediction_content_hash, payload_json, recorded_at, previous_hash, event_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(sequence, eventType, predictionId, predictionContentHash, payloadJson, recordedAt, meta.ledgerHash, eventHash);
      this.connection.prepare(
        "UPDATE ai_calibration_durability_meta SET event_count = ?, ledger_hash = ? WHERE id = 1 AND schema_version = ?"
      ).run(sequence, eventHash, SCHEMA_VERSION);
      this.connection.exec("COMMIT");
    } catch (error) {
      try { this.connection.exec("ROLLBACK"); } catch { /* preserve original failure */ }
      throw error;
    }
  }

  private ensureSchema(): void {
    this.connection.exec(SCHEMA_SQL);
    const row = this.connection.prepare(
      "SELECT schema_version, event_count, ledger_hash FROM ai_calibration_durability_meta WHERE id = 1"
    ).get() as unknown as MetaRow | undefined;
    if (row == null) {
      this.connection.prepare(
        "INSERT INTO ai_calibration_durability_meta (id, schema_version, event_count, ledger_hash) VALUES (1, ?, 0, ?)"
      ).run(SCHEMA_VERSION, GENESIS_HASH);
      return;
    }
    const version = asSafeInteger(row.schema_version, "schemaVersion");
    if (version !== SCHEMA_VERSION) throw new Error(`unsupported AI calibration durability schema version: ${version}`);
    asSafeInteger(row.event_count, "eventCount");
    asHash(row.ledger_hash, "ledgerHash");
  }

  private readMeta(): { readonly eventCount: number; readonly ledgerHash: string } {
    const row = this.connection.prepare(
      "SELECT schema_version, event_count, ledger_hash FROM ai_calibration_durability_meta WHERE id = 1"
    ).get() as unknown as MetaRow | undefined;
    if (row == null) throw new Error("AI calibration durability metadata is missing");
    const version = asSafeInteger(row.schema_version, "schemaVersion");
    if (version !== SCHEMA_VERSION) throw new Error(`unsupported AI calibration durability schema version: ${version}`);
    return Object.freeze({ eventCount: asSafeInteger(row.event_count, "eventCount"), ledgerHash: asHash(row.ledger_hash, "ledgerHash") });
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("AI calibration durable store is closed");
  }
}
