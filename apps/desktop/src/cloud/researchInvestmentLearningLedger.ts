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
import type { ResearchFactoryQualificationResult } from "./researchFactoryQualification";
import type { ResearchRunLeagueResult } from "./researchRunLeagueBridge";

const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

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
  const fingerprint = run.provenance.runFingerprintSha256;
  return freeze({
    trialId: `qualification:${fingerprint}:${candidateId}`,
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
    search: freeze({ searchId: `qualification:${fingerprint}`, attemptOrdinal }),
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
    ]),
  });
}

/**
 * Extends a sealed cumulative learning ledger with FINAL canonical Research qualification outcomes.
 * A DSR calculation being available is deliberately not treated as success. Only the final
 * QUALIFIED_FOR_LEAGUE disposition maps to COMPLETED; REJECTED and INSUFFICIENT remain in the
 * denominator as REJECTED and ABSTAINED respectively. Exact run replay is idempotent.
 */
export function appendResearchQualificationToLearningLedger(
  existing: readonly ResearchTrialRecord[],
  run: ResearchRunLeagueResult,
  qualification: ResearchFactoryQualificationResult,
): readonly ResearchTrialRecord[] {
  verifyResearchTrialLedger(existing);
  validateRun(run, qualification);
  let next = existing;
  const candidateIds = [...qualification.candidates.map((candidate) => candidate.candidateId)].sort((left, right) => left.localeCompare(right));
  for (const [index, candidateId] of candidateIds.entries()) {
    next = appendResearchTrialIdempotent(next, trialInput(run, qualification, candidateId, index + 1));
  }
  return freeze([...next]);
}

export class FileResearchInvestmentLearningLedgerStore {
  private readonly filename: string;

  public constructor(filename: string) {
    const normalized = filename.trim();
    if (!normalized || normalized === ":memory:" || !path.isAbsolute(normalized)) {
      throw new ResearchInvestmentLearningLedgerError("INVALID_LEDGER_PATH", "investment learning ledger path must be absolute and durable");
    }
    this.filename = path.resolve(normalized);
  }

  public read(): readonly ResearchTrialRecord[] {
    if (!fs.existsSync(this.filename)) return freeze([]);
    const stat = fs.statSync(this.filename);
    if (!stat.isFile()) throw new ResearchInvestmentLearningLedgerError("LEDGER_NOT_FILE", "investment learning ledger path is not a file");
    return parseResearchTrialLedger(fs.readFileSync(this.filename, "utf8"));
  }

  public appendRun(run: ResearchRunLeagueResult, qualification: ResearchFactoryQualificationResult): readonly ResearchTrialRecord[] {
    const beforeSize = fs.existsSync(this.filename) ? fs.statSync(this.filename).size : 0;
    const existing = this.read();
    const target = appendResearchQualificationToLearningLedger(existing, run, qualification);
    if (target.length === existing.length) return existing;
    const additions = target.slice(existing.length);
    const directory = path.dirname(this.filename);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const fd = fs.openSync(this.filename, "a", 0o600);
    try {
      if (fs.fstatSync(fd).size !== beforeSize) {
        throw new ResearchInvestmentLearningLedgerError("CONCURRENT_LEDGER_APPEND", "investment learning ledger changed during append");
      }
      const encoded = additions.map((record) => `${canonicalSerializeResearchTrial(record)}\n`).join("");
      fs.writeFileSync(fd, encoded, { encoding: "utf8" });
      fs.fsyncSync(fd);
      fs.fchmodSync(fd, 0o600);
    } finally {
      fs.closeSync(fd);
    }
    const persisted = this.read();
    if (persisted.length !== target.length || persisted.at(-1)?.recordHash !== target.at(-1)?.recordHash) {
      throw new ResearchInvestmentLearningLedgerError("LEDGER_PERSISTENCE_MISMATCH", "investment learning ledger persistence did not reconcile");
    }
    return persisted;
  }
}
