import type { DatabaseSync } from "node:sqlite";

export type HypothesisStatus = "DRAFT" | "ACTIVE" | "REJECTED" | "SUPPORTED";

export interface ResearchHypothesis {
  readonly id: string;
  readonly title: string;
  readonly statement: string;
  readonly status: HypothesisStatus;
  readonly createdAt: string;
}

export interface ResearchExperimentRecord {
  readonly id: string;
  readonly datasetId: string;
  readonly contentSha256: string;
  readonly manifestSchemaVersion: number;
  readonly market: string;
  readonly interval: string;
  readonly startOpenTime: number;
  readonly endCloseTime: number;
  readonly walkForwardConfigJson: string;
  readonly resultJson: string;
  readonly createdAt: string;
  readonly hypothesisId?: string;
}

export interface ResearchMemoryDatabase { readonly connection: DatabaseSync; transaction<T>(fn: () => T): T; }
export class ResearchMemoryError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = "ResearchMemoryError"; } }

const statuses = new Set<HypothesisStatus>(["DRAFT", "ACTIVE", "REJECTED", "SUPPORTED"]);
const validId = (value: string): boolean => /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
const nonEmpty = (value: string, field: string): void => { if (!value.trim()) throw new ResearchMemoryError("INVALID_RECORD", `${field} is required`); };
const timestamp = (value: string, field: string): void => { if (!Number.isFinite(Date.parse(value))) throw new ResearchMemoryError("INVALID_RECORD", `${field} must be an ISO timestamp`); };
const json = (value: string, field: string): void => { try { JSON.parse(value); } catch { throw new ResearchMemoryError("INVALID_RECORD", `${field} must be valid JSON`); } };

function assertHypothesis(value: ResearchHypothesis): void {
  if (!validId(value.id)) throw new ResearchMemoryError("INVALID_RECORD", "hypothesis id is invalid");
  nonEmpty(value.title, "hypothesis title"); nonEmpty(value.statement, "hypothesis statement"); timestamp(value.createdAt, "hypothesis createdAt");
  if (!statuses.has(value.status)) throw new ResearchMemoryError("INVALID_RECORD", "hypothesis status is invalid");
}

function assertExperiment(value: ResearchExperimentRecord): void {
  if (!validId(value.id)) throw new ResearchMemoryError("INVALID_RECORD", "experiment id is invalid");
  for (const [field, content] of [["datasetId", value.datasetId], ["contentSha256", value.contentSha256], ["market", value.market], ["interval", value.interval]] as const) nonEmpty(content, field);
  if (!/^[a-f0-9]{64}$/i.test(value.contentSha256)) throw new ResearchMemoryError("INVALID_RECORD", "contentSha256 must be a SHA-256 hex string");
  if (!Number.isInteger(value.manifestSchemaVersion) || value.manifestSchemaVersion <= 0 || !Number.isInteger(value.startOpenTime) || !Number.isInteger(value.endCloseTime) || value.startOpenTime >= value.endCloseTime) throw new ResearchMemoryError("INVALID_RECORD", "experiment manifest range is invalid");
  timestamp(value.createdAt, "experiment createdAt"); json(value.walkForwardConfigJson, "walkForwardConfigJson"); json(value.resultJson, "resultJson");
  if (value.hypothesisId != null && !validId(value.hypothesisId)) throw new ResearchMemoryError("INVALID_RECORD", "hypothesisId is invalid");
}

function sameHypothesis(left: ResearchHypothesis, right: ResearchHypothesis): boolean { return left.id === right.id && left.title === right.title && left.statement === right.statement && left.status === right.status && left.createdAt === right.createdAt; }
function sameExperiment(left: ResearchExperimentRecord, right: ResearchExperimentRecord): boolean { return left.id === right.id && left.datasetId === right.datasetId && left.contentSha256 === right.contentSha256 && left.manifestSchemaVersion === right.manifestSchemaVersion && left.market === right.market && left.interval === right.interval && left.startOpenTime === right.startOpenTime && left.endCloseTime === right.endCloseTime && left.walkForwardConfigJson === right.walkForwardConfigJson && left.resultJson === right.resultJson && left.createdAt === right.createdAt && left.hypothesisId === right.hypothesisId; }

function decodeHypothesis(row: Record<string, unknown>): ResearchHypothesis {
  const value = Object.freeze({ id: String(row.id), title: String(row.title), statement: String(row.statement), status: String(row.status) as HypothesisStatus, createdAt: String(row.created_at) }); assertHypothesis(value); return value;
}
function decodeExperiment(row: Record<string, unknown>): ResearchExperimentRecord {
  const value = Object.freeze({ id: String(row.id), datasetId: String(row.dataset_id), contentSha256: String(row.content_sha256), manifestSchemaVersion: Number(row.manifest_schema_version), market: String(row.market), interval: String(row.interval), startOpenTime: Number(row.start_open_time), endCloseTime: Number(row.end_close_time), walkForwardConfigJson: String(row.walk_forward_config_json), resultJson: String(row.result_json), createdAt: String(row.created_at), hypothesisId: row.hypothesis_id == null ? undefined : String(row.hypothesis_id) }); assertExperiment(value); return value;
}

export class SqliteResearchMemoryRepository {
  constructor(private readonly db: ResearchMemoryDatabase) {}

  appendHypothesis(hypothesis: ResearchHypothesis): ResearchHypothesis {
    assertHypothesis(hypothesis);
    return this.db.transaction(() => {
      this.db.connection.prepare("INSERT INTO research_hypotheses (id, title, statement, status, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING").run(hypothesis.id, hypothesis.title, hypothesis.statement, hypothesis.status, hypothesis.createdAt);
      const stored = this.getHypothesis(hypothesis.id);
      if (!stored) throw new ResearchMemoryError("WRITE_FAILED", "hypothesis append did not persist");
      if (!sameHypothesis(stored, hypothesis)) throw new ResearchMemoryError("ID_CONFLICT", "hypothesis id already exists with different content");
      return stored;
    });
  }

  getHypothesis(id: string): ResearchHypothesis | undefined {
    const row = this.db.connection.prepare("SELECT * FROM research_hypotheses WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row == null ? undefined : decodeHypothesis(row);
  }
  listHypotheses(): readonly ResearchHypothesis[] { return (this.db.connection.prepare("SELECT * FROM research_hypotheses ORDER BY created_at ASC, id ASC").all() as Record<string, unknown>[]).map(decodeHypothesis); }

  appendExperiment(record: ResearchExperimentRecord): ResearchExperimentRecord {
    assertExperiment(record);
    return this.db.transaction(() => {
      if (record.hypothesisId != null && this.getHypothesis(record.hypothesisId) == null) throw new ResearchMemoryError("HYPOTHESIS_NOT_FOUND", "experiment hypothesis does not exist");
      this.db.connection.prepare("INSERT INTO research_experiment_records (id, dataset_id, content_sha256, manifest_schema_version, market, interval, start_open_time, end_close_time, walk_forward_config_json, result_json, created_at, hypothesis_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING").run(record.id, record.datasetId, record.contentSha256, record.manifestSchemaVersion, record.market, record.interval, record.startOpenTime, record.endCloseTime, record.walkForwardConfigJson, record.resultJson, record.createdAt, record.hypothesisId ?? null);
      const stored = this.getExperiment(record.id);
      if (!stored) throw new ResearchMemoryError("WRITE_FAILED", "experiment append did not persist");
      if (!sameExperiment(stored, record)) throw new ResearchMemoryError("ID_CONFLICT", "experiment id already exists with different content");
      return stored;
    });
  }

  getExperiment(id: string): ResearchExperimentRecord | undefined {
    const row = this.db.connection.prepare("SELECT * FROM research_experiment_records WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row == null ? undefined : decodeExperiment(row);
  }
  listExperiments(datasetId?: string): readonly ResearchExperimentRecord[] {
    const statement = datasetId == null ? this.db.connection.prepare("SELECT * FROM research_experiment_records ORDER BY created_at ASC, id ASC") : this.db.connection.prepare("SELECT * FROM research_experiment_records WHERE dataset_id = ? ORDER BY created_at ASC, id ASC");
    const rows = (datasetId == null ? statement.all() : statement.all(datasetId)) as Record<string, unknown>[];
    return rows.map(decodeExperiment);
  }
}

