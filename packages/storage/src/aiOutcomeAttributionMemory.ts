import { DatabaseSync } from "node:sqlite";
import { aiSha256, canonicalAiJson, isAiSha256 } from "../../contracts/src/aiInference";
import type {
  AiAttributionEpisode,
  AiLearningMemoryReplay,
  AiLearningMemoryStore,
  AiLessonProjection
} from "../../contracts/src/aiOutcomeAttribution";

const SCHEMA_VERSION = 1 as const;
const GENESIS_HASH = "0".repeat(64);
type SqlRow = Record<string, string | number | bigint | null>;

interface EventRow extends SqlRow {
  sequence: number | bigint;
  episode_id: string;
  content_hash: string;
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
CREATE TABLE IF NOT EXISTS ai_outcome_attribution_memory_meta (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  schema_version INTEGER NOT NULL,
  event_count INTEGER NOT NULL CHECK(event_count >= 0),
  ledger_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_outcome_attribution_memory_events (
  sequence INTEGER PRIMARY KEY,
  episode_id TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  previous_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL UNIQUE
);
`;

const forbiddenMemoryText = /(authorization|bearer\s|api[_-]?key|credential|private[_-]?key|access[_-]?key|secret[_-]?key)/i;

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value.trim();
}

function safeInteger(value: unknown, field: string): number {
  const converted = typeof value === "bigint" ? Number(value) : value;
  if (typeof converted !== "number" || !Number.isSafeInteger(converted) || converted < 0) throw new Error(`${field} must be a non-negative safe integer`);
  return converted;
}

function hash(value: unknown, field: string): string {
  if (!isAiSha256(value)) throw new Error(`${field} must be sha256`);
  return value.toLowerCase();
}

function parseCanonicalJson(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "string") throw new Error("learning memory payload must be text");
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new Error("learning memory payload JSON is invalid"); }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("learning memory payload must be an object");
  if (canonicalAiJson(parsed) !== value) throw new Error("learning memory payload is not canonical");
  return parsed as Readonly<Record<string, unknown>>;
}

function verifyEpisode(episode: AiAttributionEpisode): AiAttributionEpisode {
  const episodeId = requiredText(episode.episodeId, "episodeId");
  const contentHash = hash(episode.contentHash, "contentHash");
  if (forbiddenMemoryText.test(JSON.stringify(episode))) throw new Error("learning memory contains forbidden secret-like material");
  const { contentHash: _stored, ...withoutHash } = episode;
  if (aiSha256(withoutHash) !== contentHash) throw new Error("learning memory episode content hash mismatch");
  if (episode.liveAuthority !== "NONE" || episode.productionMutationAllowed !== false || episode.realOrderAuthority !== false || episode.realTransferAuthority !== false) {
    throw new Error("learning memory authority invariant violated");
  }
  if (!Number.isSafeInteger(episode.createdAt) || !Number.isSafeInteger(episode.expiresAt) || episode.createdAt < 0 || episode.expiresAt <= episode.createdAt) {
    throw new Error("learning memory chronology is invalid");
  }
  if (episode.supersedesEpisodeId != null && requiredText(episode.supersedesEpisodeId, "supersedesEpisodeId") === episodeId) {
    throw new Error("learning memory episode cannot supersede itself");
  }
  return Object.freeze({ ...episode, episodeId, contentHash });
}

function eventIdentity(sequence: number, episode: AiAttributionEpisode, previousHash: string): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    sequence,
    episodeId: episode.episodeId,
    contentHash: episode.contentHash,
    payload: episode,
    recordedAt: episode.createdAt,
    previousHash
  });
}

export class SqliteAiOutcomeAttributionMemory implements AiLearningMemoryStore {
  private readonly connection: DatabaseSync;
  private closed = false;

  public constructor(filename = ":memory:") {
    this.connection = new DatabaseSync(filename);
    try {
      this.connection.exec("PRAGMA foreign_keys = ON");
      this.connection.exec("PRAGMA busy_timeout = 5000");
      if (filename !== ":memory:") this.connection.exec("PRAGMA journal_mode = WAL");
      this.connection.exec("PRAGMA synchronous = FULL");
      this.connection.exec(SCHEMA_SQL);
      this.connection.prepare(
        "INSERT OR IGNORE INTO ai_outcome_attribution_memory_meta (id, schema_version, event_count, ledger_hash) VALUES (1, ?, 0, ?)"
      ).run(SCHEMA_VERSION, GENESIS_HASH);
      const check = this.connection.prepare("PRAGMA quick_check").get() as Record<string, unknown> | undefined;
      if (check == null || !Object.values(check).includes("ok")) throw new Error("learning memory sqlite quick_check failed");
      this.replay();
    } catch (error) {
      this.connection.close();
      this.closed = true;
      throw error;
    }
  }

  public replay(): AiLearningMemoryReplay {
    this.assertOpen();
    const meta = this.readMeta();
    const rows = this.connection.prepare(
      "SELECT sequence, episode_id, content_hash, payload_json, recorded_at, previous_hash, event_hash FROM ai_outcome_attribution_memory_events ORDER BY sequence ASC"
    ).all() as unknown as EventRow[];
    if (rows.length !== meta.eventCount) throw new Error("learning memory event count mismatch");
    const episodes: AiAttributionEpisode[] = [];
    const seen = new Set<string>();
    let previousHash = GENESIS_HASH;
    rows.forEach((row, index) => {
      const sequence = safeInteger(row.sequence, "sequence");
      if (sequence !== index + 1) throw new Error("learning memory sequence is not contiguous");
      const episodeId = requiredText(row.episode_id, "episodeId");
      if (seen.has(episodeId)) throw new Error("duplicate learning memory episode");
      const contentHash = hash(row.content_hash, "contentHash");
      const recordedAt = safeInteger(row.recorded_at, "recordedAt");
      const storedPreviousHash = hash(row.previous_hash, "previousHash");
      const storedEventHash = hash(row.event_hash, "eventHash");
      if (storedPreviousHash !== previousHash) throw new Error("learning memory hash chain mismatch");
      const payload = parseCanonicalJson(row.payload_json) as unknown as AiAttributionEpisode;
      const episode = verifyEpisode(payload);
      if (episode.episodeId !== episodeId || episode.contentHash !== contentHash || episode.createdAt !== recordedAt) throw new Error("learning memory row identity mismatch");
      if (episode.supersedesEpisodeId != null && !seen.has(episode.supersedesEpisodeId)) throw new Error("learning memory supersession target must precede replacement");
      const expectedEventHash = aiSha256(eventIdentity(sequence, episode, storedPreviousHash));
      if (expectedEventHash !== storedEventHash) throw new Error("learning memory event hash mismatch");
      episodes.push(episode);
      seen.add(episodeId);
      previousHash = storedEventHash;
    });
    if (previousHash !== meta.ledgerHash) throw new Error("learning memory ledger head mismatch");
    return Object.freeze({ schemaVersion: 1, episodes: Object.freeze(episodes), eventCount: episodes.length, headHash: previousHash });
  }

  public appendEpisode(value: AiAttributionEpisode): void {
    this.assertOpen();
    const episode = verifyEpisode(value);
    const replay = this.replay();
    const prior = replay.episodes.find((item) => item.episodeId === episode.episodeId);
    if (prior != null) {
      if (prior.contentHash !== episode.contentHash) throw new Error("conflicting learning memory replay");
      return;
    }
    if (episode.supersedesEpisodeId != null) {
      const target = replay.episodes.find((item) => item.episodeId === episode.supersedesEpisodeId);
      if (target == null) throw new Error("learning memory supersession target is missing");
      if (target.scope !== episode.scope) throw new Error("learning memory supersession scope mismatch");
      if (episode.createdAt <= target.createdAt) throw new Error("learning memory supersession chronology is invalid");
    }
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const meta = this.readMeta();
      const sequence = meta.eventCount + 1;
      const eventHash = aiSha256(eventIdentity(sequence, episode, meta.ledgerHash));
      this.connection.prepare(
        "INSERT INTO ai_outcome_attribution_memory_events (sequence, episode_id, content_hash, payload_json, recorded_at, previous_hash, event_hash) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(sequence, episode.episodeId, episode.contentHash, canonicalAiJson(episode), episode.createdAt, meta.ledgerHash, eventHash);
      this.connection.prepare(
        "UPDATE ai_outcome_attribution_memory_meta SET event_count = ?, ledger_hash = ? WHERE id = 1"
      ).run(sequence, eventHash);
      this.connection.exec("COMMIT");
    } catch (error) {
      try { this.connection.exec("ROLLBACK"); } catch { /* ignore rollback failure */ }
      throw error;
    }
  }

  public applicableLessons(scopeValue: string, nowValue: number): readonly AiLessonProjection[] {
    const scope = requiredText(scopeValue, "scope");
    const now = safeInteger(nowValue, "now");
    const replay = this.replay();
    const superseded = new Set(replay.episodes.flatMap((episode) => episode.supersedesEpisodeId == null ? [] : [episode.supersedesEpisodeId]));
    return Object.freeze(replay.episodes
      .filter((episode) => episode.scope === scope && episode.createdAt <= now && now < episode.expiresAt && !superseded.has(episode.episodeId))
      .map((episode): AiLessonProjection => Object.freeze({
        episodeId: episode.episodeId,
        strength: episode.strength,
        primaryCause: episode.primaryCause,
        reasonCodes: episode.reasonCodes,
        scope: episode.scope,
        createdAt: episode.createdAt,
        expiresAt: episode.expiresAt,
        realizedLearningCreditAllowed: episode.realizedLearningCreditAllowed,
        advisoryOnly: true,
        liveAuthority: "NONE",
        productionMutationAllowed: false
      })));
  }

  public close(): void {
    if (this.closed) return;
    this.connection.close();
    this.closed = true;
  }

  private readMeta(): { readonly eventCount: number; readonly ledgerHash: string } {
    const row = this.connection.prepare(
      "SELECT schema_version, event_count, ledger_hash FROM ai_outcome_attribution_memory_meta WHERE id = 1"
    ).get() as unknown as MetaRow | undefined;
    if (row == null) throw new Error("learning memory metadata is missing");
    if (safeInteger(row.schema_version, "schemaVersion") !== SCHEMA_VERSION) throw new Error("learning memory schema version mismatch");
    return Object.freeze({ eventCount: safeInteger(row.event_count, "eventCount"), ledgerHash: hash(row.ledger_hash, "ledgerHash") });
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("learning memory store is closed");
  }
}
