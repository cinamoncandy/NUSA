import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  appendResearchTrialIdempotent,
  canonicalSerializeResearchTrial,
  parseResearchTrialLedger,
  verifyResearchTrialLedger,
  type ResearchTrialInput,
  type ResearchTrialRecord,
} from "./researchTrialLedger";
import { qualifyResearchFactoryRun, type ResearchFactoryQualificationResult } from "./researchFactoryQualification";
import type { ResearchRunLeagueResult } from "./researchRunLeagueBridge";

const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);
const GENESIS_HASH = "0".repeat(64);

export type ResearchQualificationFn = (run: ResearchRunLeagueResult) => ResearchFactoryQualificationResult;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value != null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Stable search identity: dataset content, source commit, cost model, hypothesis, and the exact
 * candidate specifications/parameter grid. Deliberately excludes the run timestamp so a retry of
 * the same canonical search on unchanged data replays instead of appending a new search.
 */
function stableSearchIdentity(run: ResearchRunLeagueResult): string {
  const provenance = run.provenance;
  return createHash("sha256").update(canonicalJson({
    sourceCommitSha: provenance.sourceCommitSha,
    costModelVersion: provenance.costModelVersion,
    hypothesisHash: provenance.hypothesisHash ?? null,
    dataset: provenance.dataset,
    candidateBindings: [...provenance.candidateBindings].sort((left, right) => left.candidateId.localeCompare(right.candidateId)),
    evidenceIdentity: provenance.evidenceIdentity,
  })).digest("hex");
}

/** The supplied qualification must equal the canonical qualification recomputed from this run. */
function bindQualificationToRun(
  run: ResearchRunLeagueResult,
  qualification: ResearchFactoryQualificationResult,
  qualify: ResearchQualificationFn,
): void {
  const project = (result: ResearchFactoryQualificationResult) => canonicalJson([...result.candidates]
    .map((candidate) => ({ candidateId: candidate.candidateId, outcome: candidate.outcome, reasons: [...candidate.reasons] }))
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId)));
  let recomputed: ResearchFactoryQualificationResult;
  try {
    recomputed = qualify(run);
  } catch {
    throw new ResearchInvestmentLearningLedgerError("QUALIFICATION_RECOMPUTE_FAILED", "investment learning could not recompute qualification for this run");
  }
  if (project(recomputed) !== project(qualification)) {
    throw new ResearchInvestmentLearningLedgerError("QUALIFICATION_RUN_MISMATCH", "investment learning qualification does not belong to the supplied run");
  }
}

export class ResearchInvestmentLearningLedgerError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ResearchInvestmentLearningLedgerError";
  }
}

function validateRun(run: ResearchRunLeagueResult, qualification: ResearchFactoryQualificationResult): void {
  if (run.schemaVersion !== 1 || run.evidenceMode !== "RESEARCH_TIER_ONLY") {
    throw new ResearchInvestmentLearningLedgerError("INVALID_RESEARCH_RUN", "investment learning requires a canonical Research-tier run");
  }
  if (qualification.schemaVersion !== 1 || qualification.liveAuthority !== "NONE"
    || qualification.productionMutationAllowed !== false || qualification.aiAuthority !== "ZERO_AUTHORITY") {
    throw new ResearchInvestmentLearningLedgerError("INVALID_QUALIFICATION_AUTHORITY", "investment learning qualification authority is invalid");
  }
  const provenance = run.provenance;
  if (!SHA64.test(provenance.runFingerprintSha256) || !SHA40.test(provenance.sourceCommitSha)
    || !provenance.dataset.datasetId.trim() || !SHA64.test(provenance.dataset.contentSha256)
    || !provenance.dataset.market.trim() || !provenance.dataset.interval.trim()) {
    throw new ResearchInvestmentLearningLedgerError("INVALID_RUN_PROVENANCE", "investment learning run provenance is invalid");
  }
  if (!Number.isFinite(Date.parse(run.standing.generatedAt))) {
    throw new ResearchInvestmentLearningLedgerError("INVALID_RUN_TIME", "investment learning run timestamp is invalid");
  }
  const entries = new Map(run.standing.entries.map((entry) => [entry.id, entry] as const));
  const bindings = new Map(provenance.candidateBindings.map((binding) => [binding.candidateId, binding] as const));
  const qualified = new Map(qualification.candidates.map((candidate) => [candidate.candidateId, candidate] as const));
  if (entries.size !== run.standing.entries.length || bindings.size !== provenance.candidateBindings.length
    || qualified.size !== qualification.candidates.length || entries.size !== bindings.size || entries.size !== qualified.size) {
    throw new ResearchInvestmentLearningLedgerError("CANDIDATE_COVERAGE_MISMATCH", "investment learning candidate coverage does not reconcile");
  }
  for (const [candidateId, entry] of entries) {
    const binding = bindings.get(candidateId);
    const decision = qualified.get(candidateId);
    if (binding == null || decision == null || binding.familyId !== entry.familyId
      || binding.datasetId !== provenance.dataset.datasetId
      || binding.datasetContentSha256.toLowerCase() !== provenance.dataset.contentSha256.toLowerCase()) {
      throw new ResearchInvestmentLearningLedgerError("CANDIDATE_PROVENANCE_MISMATCH", `investment learning provenance mismatch for ${candidateId}`);
    }
  }
  const counted = qualification.candidates.reduce((acc, candidate) => {
    acc[candidate.outcome] += 1;
    return acc;
  }, { REJECTED: 0, INSUFFICIENT: 0, QUALIFIED_FOR_LEAGUE: 0 });
  if (qualification.coverage.candidateCount !== qualification.candidates.length
    || qualification.coverage.rejectedCount !== counted.REJECTED
    || qualification.coverage.insufficientCount !== counted.INSUFFICIENT
    || qualification.coverage.qualifiedCount !== counted.QUALIFIED_FOR_LEAGUE) {
    throw new ResearchInvestmentLearningLedgerError("QUALIFICATION_COVERAGE_MISMATCH", "investment learning qualification coverage does not reconcile");
  }
}

function trialInput(
  run: ResearchRunLeagueResult,
  qualification: ResearchFactoryQualificationResult,
  candidateId: string,
  attemptOrdinal: number,
): ResearchTrialInput {
  const entry = run.standing.entries.find((item) => item.id === candidateId)!;
  const decision = qualification.candidates.find((item) => item.candidateId === candidateId)!;
  const outcome = decision.outcome === "QUALIFIED_FOR_LEAGUE"
    ? "COMPLETED" as const
    : decision.outcome === "REJECTED" ? "REJECTED" as const : "ABSTAINED" as const;
  const reasons = decision.reasons.length > 0
    ? decision.reasons
    : decision.outcome === "REJECTED" ? freeze(["CANONICAL_RESEARCH_REJECTED"])
      : freeze(["INSUFFICIENT_CANONICAL_EVIDENCE"]);
  const hypothesis = run.hypothesis?.thesis?.trim() || "canonical Research qualification outcome";
  const searchIdentity = stableSearchIdentity(run);
  return freeze({
    trialId: `qualification:${searchIdentity}:${candidateId}`,
    familyId: entry.familyId,
    hypothesis,
    createdAt: run.standing.generatedAt,
    dataset: freeze({
      datasetId: run.provenance.dataset.datasetId,
      contentSha256: run.provenance.dataset.contentSha256.toLowerCase(),
      market: run.provenance.dataset.market,
      interval: run.provenance.dataset.interval,
    }),
    candidateIds: freeze([candidateId]),
    search: freeze({ searchId: `qualification:${searchIdentity}`, attemptOrdinal }),
    outcome,
    ...(outcome === "REJECTED" ? { rejectionReasons: freeze([...reasons]) } : {}),
    ...(outcome === "ABSTAINED" ? { abstentionReasons: freeze([...reasons]) } : {}),
    metrics: freeze({
      qualificationOutcome: decision.outcome,
      eligible: entry.eligible,
      evidenceBreadth: entry.evidenceBreadth,
      leagueScore: entry.leagueScore ?? null,
    }),
    tags: freeze([
      "FINAL_RESEARCH_QUALIFICATION",
      "INVESTMENT_LEARNING",
      `source-commit:${run.provenance.sourceCommitSha}`,
      `run-fingerprint:${run.provenance.runFingerprintSha256}`,
    ]),
  });
}

/**
 * Extends a sealed cumulative learning ledger with FINAL canonical Research qualification outcomes.
 * A DSR calculation being available is deliberately not treated as success. Only the final
 * QUALIFIED_FOR_LEAGUE disposition maps to COMPLETED; REJECTED and INSUFFICIENT remain in the
 * denominator as REJECTED and ABSTAINED respectively. A retry of the same canonical search
 * (same data, specification, and evidence) replays idempotently even when its run timestamp and
 * fingerprint differ; the first sealed evidence, including its timestamp, is retained.
 */
export function appendResearchQualificationToLearningLedger(
  existing: readonly ResearchTrialRecord[],
  run: ResearchRunLeagueResult,
  qualification: ResearchFactoryQualificationResult,
  qualify: ResearchQualificationFn = qualifyResearchFactoryRun,
): readonly ResearchTrialRecord[] {
  verifyResearchTrialLedger(existing);
  validateRun(run, qualification);
  bindQualificationToRun(run, qualification, qualify);
  let next = existing;
  const candidateIds = [...qualification.candidates.map((candidate) => candidate.candidateId)].sort((left, right) => left.localeCompare(right));
  for (const [index, candidateId] of candidateIds.entries()) {
    const input = trialInput(run, qualification, candidateId, index + 1);
    const sealed = next.find((record) => record.trialId === input.trialId);
    next = appendResearchTrialIdempotent(next, sealed == null ? input : freeze({
      ...input,
      createdAt: sealed.createdAt,
      tags: sealed.tags,
    }));
  }
  return freeze([...next]);
}

interface LedgerAnchor {
  readonly schemaVersion: 1;
  readonly recordCount: number;
  readonly terminalHash: string;
}

/**
 * Durable JSONL ledger plus a separately written anchor (record count + terminal hash).
 * Deleting, truncating, or rolling the ledger back behind the anchor fails closed, as does a
 * non-empty ledger with no anchor. Only "no ledger and no anchor" is a first initialization.
 * Appends are serialized by an exclusive lock file; a left-over lock fails closed until an
 * operator confirms no append is running and removes it.
 */
export class FileResearchInvestmentLearningLedgerStore {
  private readonly filename: string;
  private readonly anchorFilename: string;
  private readonly lockFilename: string;

  public constructor(filename: string, private readonly qualify: ResearchQualificationFn = qualifyResearchFactoryRun) {
    const normalized = filename.trim();
    if (!normalized || normalized === ":memory:" || !path.isAbsolute(normalized)) {
      throw new ResearchInvestmentLearningLedgerError("INVALID_LEDGER_PATH", "investment learning ledger path must be absolute and durable");
    }
    this.filename = path.resolve(normalized);
    this.anchorFilename = `${this.filename}.anchor.json`;
    this.lockFilename = `${this.filename}.lock`;
  }

  private readAnchor(): LedgerAnchor | null {
    if (!fs.existsSync(this.anchorFilename)) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.anchorFilename, "utf8"));
    } catch {
      throw new ResearchInvestmentLearningLedgerError("LEDGER_ANCHOR_INVALID", "investment learning ledger anchor is unreadable");
    }
    const anchor = parsed as Partial<LedgerAnchor> | null;
    if (anchor == null || anchor.schemaVersion !== 1 || !Number.isInteger(anchor.recordCount) || (anchor.recordCount as number) < 0
      || typeof anchor.terminalHash !== "string" || !SHA64.test(anchor.terminalHash)) {
      throw new ResearchInvestmentLearningLedgerError("LEDGER_ANCHOR_INVALID", "investment learning ledger anchor is invalid");
    }
    return anchor as LedgerAnchor;
  }

  private writeAnchor(records: readonly ResearchTrialRecord[]): void {
    const anchor: LedgerAnchor = { schemaVersion: 1, recordCount: records.length, terminalHash: records.at(-1)?.recordHash ?? GENESIS_HASH };
    const temporary = `${this.anchorFilename}.tmp`;
    const fd = fs.openSync(temporary, "w", 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(anchor)}\n`, { encoding: "utf8" });
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, this.anchorFilename);
  }

  public read(): readonly ResearchTrialRecord[] {
    const anchor = this.readAnchor();
    if (!fs.existsSync(this.filename)) {
      if (anchor != null && anchor.recordCount > 0) {
        throw new ResearchInvestmentLearningLedgerError("LEDGER_HISTORY_LOST", "investment learning ledger is missing but sealed history was anchored");
      }
      return freeze([]);
    }
    const stat = fs.statSync(this.filename);
    if (!stat.isFile()) throw new ResearchInvestmentLearningLedgerError("LEDGER_NOT_FILE", "investment learning ledger path is not a file");
    const records = parseResearchTrialLedger(fs.readFileSync(this.filename, "utf8"));
    if (anchor == null) {
      if (records.length > 0) {
        throw new ResearchInvestmentLearningLedgerError("LEDGER_ANCHOR_MISSING", "investment learning ledger has history but no anchor");
      }
      return records;
    }
    // A crash between the ledger fsync and the anchor rename leaves the ledger ahead of the anchor;
    // that is safe. Anything shorter than, or diverging from, the anchor is lost sealed history.
    const anchoredHash = anchor.recordCount === 0 ? GENESIS_HASH : records[anchor.recordCount - 1]?.recordHash;
    if (records.length < anchor.recordCount || anchoredHash !== anchor.terminalHash) {
      throw new ResearchInvestmentLearningLedgerError("LEDGER_HISTORY_ROLLBACK", "investment learning ledger no longer contains its anchored history");
    }
    return records;
  }

  public appendRun(run: ResearchRunLeagueResult, qualification: ResearchFactoryQualificationResult): readonly ResearchTrialRecord[] {
    const directory = path.dirname(this.filename);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    let lockFd: number;
    try {
      lockFd = fs.openSync(this.lockFilename, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new ResearchInvestmentLearningLedgerError("CONCURRENT_LEDGER_APPEND", "investment learning ledger is locked by another append");
      }
      throw error;
    }
    try {
      return this.appendRunLocked(run, qualification);
    } finally {
      fs.closeSync(lockFd);
      fs.rmSync(this.lockFilename, { force: true });
    }
  }

  private appendRunLocked(run: ResearchRunLeagueResult, qualification: ResearchFactoryQualificationResult): readonly ResearchTrialRecord[] {
    const existing = this.read();
    const target = appendResearchQualificationToLearningLedger(existing, run, qualification, this.qualify);
    if (target.length === existing.length) {
      if (this.readAnchor()?.recordCount !== existing.length) this.writeAnchor(existing);
      return existing;
    }
    const additions = target.slice(existing.length);
    const fd = fs.openSync(this.filename, "a", 0o600);
    try {
      const encoded = additions.map((record) => `${canonicalSerializeResearchTrial(record)}\n`).join("");
      fs.writeFileSync(fd, encoded, { encoding: "utf8" });
      fs.fsyncSync(fd);
      fs.fchmodSync(fd, 0o600);
    } finally {
      fs.closeSync(fd);
    }
    this.writeAnchor(target);
    const persisted = this.read();
    if (persisted.length !== target.length || persisted.at(-1)?.recordHash !== target.at(-1)?.recordHash) {
      throw new ResearchInvestmentLearningLedgerError("LEDGER_PERSISTENCE_MISMATCH", "investment learning ledger persistence did not reconcile");
    }
    return persisted;
  }
}
