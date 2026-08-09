import type { DatabaseSync } from "node:sqlite";
import {
  aiSha256,
  canonicalAiJson,
  type AiCalibrationOutcome,
  type AiCalibrationPrediction
} from "../../contracts/src/aiInference";

export interface AiCalibrationDatabase {
  readonly connection: DatabaseSync;
  transaction<T>(fn: () => T): T;
}

export interface AiCalibrationPendingRecord {
  readonly predictionId: string;
  readonly predictionContentHash: string;
}

export interface AiCalibrationDurableSnapshot {
  readonly predictions: readonly AiCalibrationPrediction[];
  readonly outcomes: readonly AiCalibrationOutcome[];
  readonly pending: readonly AiCalibrationPendingRecord[];
}

type EventType = "PREDICTION" | "OUTCOME" | "PENDING_ADD" | "PENDING_REMOVE";
type PendingRemovalReason = "RESOLVED" | "EXPIRED";

type EventRow = {
  sequence: number | bigint;
  event_type: string;
  identity_id: string;
  payload_json: string;
  payload_hash: string;
  previous_hash: string;
  hash: string;
};

type StateRow = { schema_version: number | bigint; sequence: number | bigint; ledger_hash: string };

const SCHEMA_VERSION = 1;
const ZERO_HASH = "0".repeat(64);
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ai_calibration_events (
  sequence INTEGER PRIMARY KEY,
  event_type TEXT NOT NULL CHECK(event_type IN ('PREDICTION','OUTCOME','PENDING_ADD','PENDING_REMOVE')),
  identity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS ai_calibration_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  schema_version INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  ledger_hash TEXT NOT NULL
);
`;

const expectedEventColumns = ["sequence", "event_type", "identity_id", "payload_json", "payload_hash", "previous_hash", "hash"];
const expectedStateColumns = ["id", "schema_version", "sequence", "ledger_hash"];

const exactColumns = (connection: DatabaseSync, table: string, expected: readonly string[]): void => {
  const columns = connection.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: unknown }>;
  const actual = columns.map((column) => String(column.name)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((name, index) => name !== wanted[index])) {
    throw new Error(`unsupported calibration schema: ${table}`);
  }
};

const record = (value: unknown, name: string): Record<string, unknown> => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
};

const safePrediction = (value: AiCalibrationPrediction): AiCalibrationPrediction => Object.freeze({
  predictionId: value.predictionId,
  orchestrationRunId: value.orchestrationRunId,
  proposalId: value.proposalId,
  agentId: value.agentId,
  role: value.role,
  providerId: value.providerId,
  modelVersionId: value.modelVersionId,
  promptArtifactId: value.promptArtifactId,
  promptArtifactVersion: value.promptArtifactVersion,
  promptArtifactDigest: value.promptArtifactDigest,
  outcomeDefinitionId: value.outcomeDefinitionId,
  outcomeDefinitionVersion: value.outcomeDefinitionVersion,
  targetId: value.targetId,
  anchorValue: value.anchorValue,
  anchorObservedAt: value.anchorObservedAt,
  anchorEvidenceReference: value.anchorEvidenceReference,
  rawProbability: value.rawProbability,
  predictedAt: value.predictedAt,
  horizonMs: value.horizonMs,
  provenance: value.provenance,
  contentHash: value.contentHash
});

const safeOutcome = (value: AiCalibrationOutcome): AiCalibrationOutcome => Object.freeze({
  predictionId: value.predictionId,
  predictionContentHash: value.predictionContentHash,
  outcomeDefinitionId: value.outcomeDefinitionId,
  outcomeDefinitionVersion: value.outcomeDefinitionVersion,
  outcome: value.outcome,
  resolvedValue: value.resolvedValue,
  resolvedAt: value.resolvedAt,
  evidenceReferences: Object.freeze([...value.evidenceReferences]),
  provenance: value.provenance,
  contentHash: value.contentHash
});

const safePending = (value: AiCalibrationPendingRecord): AiCalibrationPendingRecord => Object.freeze({
  predictionId: value.predictionId,
  predictionContentHash: value.predictionContentHash
});

const safeRemoval = (value: AiCalibrationPendingRecord & { readonly reason: PendingRemovalReason }) => Object.freeze({
  predictionId: value.predictionId,
  predictionContentHash: value.predictionContentHash,
  reason: value.reason
});

const exactPayload = <T>(raw: unknown, safe: T, name: string): T => {
  if (canonicalAiJson(raw) !== canonicalAiJson(safe)) throw new Error(`${name} contains unsupported fields`);
  return safe;
};

const eventHash = (
  sequence: number,
  eventType: EventType,
  identityId: string,
  payloadHash: string,
  previousHash: string
): string => aiSha256({ schemaVersion: SCHEMA_VERSION, sequence, eventType, identityId, payloadHash, previousHash });

const parseEventType = (value: string): EventType => {
  if (value !== "PREDICTION" && value !== "OUTCOME" && value !== "PENDING_ADD" && value !== "PENDING_REMOVE") {
    throw new Error(`unsupported calibration event type: ${value}`);
  }
  return value;
};

const parsePrediction = (value: unknown): AiCalibrationPrediction => {
  const raw = record(value, "calibration prediction");
  return exactPayload(raw, safePrediction(raw as unknown as AiCalibrationPrediction), "calibration prediction");
};

const parseOutcome = (value: unknown): AiCalibrationOutcome => {
  const raw = record(value, "calibration outcome");
  return exactPayload(raw, safeOutcome(raw as unknown as AiCalibrationOutcome), "calibration outcome");
};

const parsePending = (value: unknown): AiCalibrationPendingRecord => {
  const raw = record(value, "calibration pending record");
  return exactPayload(raw, safePending(raw as unknown as AiCalibrationPendingRecord), "calibration pending record");
};

const parseRemoval = (value: unknown): AiCalibrationPendingRecord & { readonly reason: PendingRemovalReason } => {
  const raw = record(value, "calibration pending removal");
  const reason = raw.reason;
  if (reason !== "RESOLVED" && reason !== "EXPIRED") throw new Error("unsupported calibration pending removal reason");
  return exactPayload(raw, safeRemoval({ ...(raw as unknown as AiCalibrationPendingRecord), reason }), "calibration pending removal");
};

export class SqliteAiCalibrationStore {
  public constructor(private readonly db: AiCalibrationDatabase) {
    this.db.connection.exec(SCHEMA_SQL);
    exactColumns(this.db.connection, "ai_calibration_events", expectedEventColumns);
    exactColumns(this.db.connection, "ai_calibration_state", expectedStateColumns);
  }

  public recover(): AiCalibrationDurableSnapshot {
    return this.recoverInternal();
  }

  public recordPrediction(prediction: AiCalibrationPrediction): void {
    const safe = safePrediction(prediction);
    this.db.transaction(() => {
      const snapshot = this.recoverInternal();
      const prior = snapshot.predictions.find((item) => item.predictionId === safe.predictionId);
      if (prior != null) {
        if (prior.contentHash !== safe.contentHash) throw new Error("conflicting durable calibration prediction");
        return;
      }
      this.appendEvent("PREDICTION", safe.predictionId, safe);
      this.appendEvent("PENDING_ADD", safe.predictionId, safePending({ predictionId: safe.predictionId, predictionContentHash: safe.contentHash }));
    });
  }

  public recordOutcome(outcome: AiCalibrationOutcome): void {
    const safe = safeOutcome(outcome);
    this.db.transaction(() => {
      const snapshot = this.recoverInternal();
      const prediction = snapshot.predictions.find((item) => item.predictionId === safe.predictionId);
      if (prediction == null || prediction.contentHash !== safe.predictionContentHash) throw new Error("durable calibration prediction linkage mismatch");
      const prior = snapshot.outcomes.find((item) => item.predictionId === safe.predictionId);
      if (prior != null && prior.contentHash !== safe.contentHash) throw new Error("conflicting durable calibration outcome");
      const pending = snapshot.pending.find((item) => item.predictionId === safe.predictionId);
      if (prior == null) this.appendEvent("OUTCOME", safe.predictionId, safe);
      if (pending != null) {
        if (pending.predictionContentHash !== prediction.contentHash) throw new Error("durable calibration pending linkage mismatch");
        this.appendEvent("PENDING_REMOVE", safe.predictionId, safeRemoval({ ...pending, reason: "RESOLVED" }));
      } else if (prior == null) {
        throw new Error("durable calibration pending prediction is missing");
      }
    });
  }

  public expirePrediction(prediction: AiCalibrationPrediction): void {
    this.db.transaction(() => {
      const snapshot = this.recoverInternal();
      const stored = snapshot.predictions.find((item) => item.predictionId === prediction.predictionId);
      if (stored == null || stored.contentHash !== prediction.contentHash) throw new Error("durable calibration expiry prediction mismatch");
      if (snapshot.outcomes.some((item) => item.predictionId === prediction.predictionId)) return;
      const pending = snapshot.pending.find((item) => item.predictionId === prediction.predictionId);
      if (pending == null) return;
      if (pending.predictionContentHash !== prediction.contentHash) throw new Error("durable calibration expiry linkage mismatch");
      this.appendEvent("PENDING_REMOVE", prediction.predictionId, safeRemoval({ ...pending, reason: "EXPIRED" }));
    });
  }

  private appendEvent(eventType: EventType, identityId: string, payload: unknown): void {
    const state = this.db.connection.prepare("SELECT schema_version, sequence, ledger_hash FROM ai_calibration_state WHERE id = 1").get() as StateRow | undefined;
    if (state != null && Number(state.schema_version) !== SCHEMA_VERSION) throw new Error("unsupported calibration durable state version");
    const sequence = (state == null ? 0 : Number(state.sequence)) + 1;
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("invalid calibration durable sequence");
    const previousHash = state?.ledger_hash ?? ZERO_HASH;
    const payloadHash = aiSha256(payload);
    const hash = eventHash(sequence, eventType, identityId, payloadHash, previousHash);
    this.db.connection.prepare(
      "INSERT INTO ai_calibration_events(sequence,event_type,identity_id,payload_json,payload_hash,previous_hash,hash) VALUES(?,?,?,?,?,?,?)"
    ).run(sequence, eventType, identityId, canonicalAiJson(payload), payloadHash, previousHash, hash);
    this.db.connection.prepare(
      "INSERT INTO ai_calibration_state(id,schema_version,sequence,ledger_hash) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET schema_version=excluded.schema_version, sequence=excluded.sequence, ledger_hash=excluded.ledger_hash"
    ).run(SCHEMA_VERSION, sequence, hash);
  }

  private recoverInternal(): AiCalibrationDurableSnapshot {
    const rows = this.db.connection.prepare(
      "SELECT sequence,event_type,identity_id,payload_json,payload_hash,previous_hash,hash FROM ai_calibration_events ORDER BY sequence ASC"
    ).all() as EventRow[];
    const state = this.db.connection.prepare("SELECT schema_version, sequence, ledger_hash FROM ai_calibration_state WHERE id = 1").get() as StateRow | undefined;
    if (state != null && Number(state.schema_version) !== SCHEMA_VERSION) throw new Error("unsupported calibration durable state version");
    if (rows.length === 0) {
      if (state != null && (Number(state.sequence) !== 0 || state.ledger_hash !== ZERO_HASH)) throw new Error("calibration durable state exists without events");
      return Object.freeze({ predictions: Object.freeze([]), outcomes: Object.freeze([]), pending: Object.freeze([]) });
    }
    if (state == null) throw new Error("calibration durable state head is missing");

    const predictions = new Map<string, AiCalibrationPrediction>();
    const outcomes = new Map<string, AiCalibrationOutcome>();
    const pending = new Map<string, AiCalibrationPendingRecord>();
    let previousHash = ZERO_HASH;

    rows.forEach((row, index) => {
      const sequence = Number(row.sequence);
      const eventType = parseEventType(row.event_type);
      if (sequence !== index + 1 || row.previous_hash !== previousHash) throw new Error("calibration durable sequence integrity violation");
      let raw: unknown;
      try { raw = JSON.parse(row.payload_json); }
      catch { throw new Error("calibration durable payload is not valid JSON"); }
      const payloadHash = aiSha256(raw);
      if (payloadHash !== row.payload_hash) throw new Error("calibration durable payload hash mismatch");
      const expectedHash = eventHash(sequence, eventType, row.identity_id, payloadHash, previousHash);
      if (expectedHash !== row.hash) throw new Error("calibration durable event hash mismatch");

      if (eventType === "PREDICTION") {
        const value = parsePrediction(raw);
        if (value.predictionId !== row.identity_id) throw new Error("calibration durable prediction identity mismatch");
        const prior = predictions.get(value.predictionId);
        if (prior != null && prior.contentHash !== value.contentHash) throw new Error("conflicting durable calibration prediction replay");
        predictions.set(value.predictionId, value);
      } else if (eventType === "OUTCOME") {
        const value = parseOutcome(raw);
        if (value.predictionId !== row.identity_id) throw new Error("calibration durable outcome identity mismatch");
        const prediction = predictions.get(value.predictionId);
        if (prediction == null || prediction.contentHash !== value.predictionContentHash) throw new Error("calibration durable outcome linkage mismatch");
        const prior = outcomes.get(value.predictionId);
        if (prior != null && prior.contentHash !== value.contentHash) throw new Error("conflicting durable calibration outcome replay");
        outcomes.set(value.predictionId, value);
      } else if (eventType === "PENDING_ADD") {
        const value = parsePending(raw);
        if (value.predictionId !== row.identity_id) throw new Error("calibration durable pending identity mismatch");
        const prediction = predictions.get(value.predictionId);
        if (prediction == null || prediction.contentHash !== value.predictionContentHash || outcomes.has(value.predictionId) || pending.has(value.predictionId)) {
          throw new Error("invalid durable calibration pending add");
        }
        pending.set(value.predictionId, value);
      } else {
        const value = parseRemoval(raw);
        if (value.predictionId !== row.identity_id) throw new Error("calibration durable removal identity mismatch");
        const current = pending.get(value.predictionId);
        if (current == null || current.predictionContentHash !== value.predictionContentHash) throw new Error("invalid durable calibration pending removal");
        if (value.reason === "RESOLVED" && !outcomes.has(value.predictionId)) throw new Error("resolved calibration removal is missing outcome");
        if (value.reason === "EXPIRED" && outcomes.has(value.predictionId)) throw new Error("expired calibration removal conflicts with outcome");
        pending.delete(value.predictionId);
      }
      previousHash = row.hash;
    });

    if (Number(state.sequence) !== rows.length || state.ledger_hash !== previousHash) throw new Error("calibration durable state head mismatch");
    return Object.freeze({
      predictions: Object.freeze([...predictions.values()]),
      outcomes: Object.freeze([...outcomes.values()]),
      pending: Object.freeze([...pending.values()].sort((left, right) => left.predictionId.localeCompare(right.predictionId)))
    });
  }
}
