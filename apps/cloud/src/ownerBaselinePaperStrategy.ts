import { createHash } from "node:crypto";
import type { LeagueCapitalAllocationAdvisory } from "../../../packages/contracts/src/leagueCapitalAllocation";
import { bindPaperCandidateForExecution, type PaperCandidateStrategySpec } from "../../../packages/contracts/src/paperCandidateExecutionBinding";
import type { PaperCandidateExecutionBinding } from "./cioDecisionEngine";
import type { PaperCandidateBindingProvider } from "./cloudRuntimeDashboardHydrator";

/**
 * Owner-approved PAPER baseline strategy (owner decision 2026-09-29, WO-PAPER-20260929-OWNER-BASELINE-STRATEGY).
 *
 * Automatic PAPER execution normally follows only a Research/League challenger that passed
 * qualification. Until one qualifies, PAPER sat idle and produced no fills to learn from. The owner
 * explicitly approved trading PAPER with a fixed, unqualified baseline in that gap. This provider
 * returns the bound challenger whenever one exists and otherwise a deterministic SMA 5/20 baseline
 * binding, so a qualified challenger always takes precedence.
 *
 * The baseline is PAPER-only: it goes through the same canonical decision, portfolio, risk, kill
 * switch and execution boundary as a challenger, and grants no LIVE, credential or production
 * authority. NUSA_PAPER_OWNER_BASELINE_STRATEGY=DISABLED turns it off; any non-PAPER mode never
 * gets it.
 */
export const OWNER_BASELINE_STRATEGY_ENV = "NUSA_PAPER_OWNER_BASELINE_STRATEGY";
export const OWNER_BASELINE_CANDIDATE_ID = "owner-baseline-sma-5-20";
export const OWNER_BASELINE_REASON = "OWNER_BASELINE_PAPER_NOT_QUALIFIED";

const DAY_MS = 24 * 60 * 60 * 1000;
const SHA40 = /^[a-f0-9]{40}$/;
const sha256 = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function ownerBaselineAdvisory(market: string, periodStartAt: number): LeagueCapitalAllocationAdvisory {
  if (!Number.isSafeInteger(periodStartAt) || periodStartAt < DAY_MS) throw new Error("owner baseline period start is invalid");
  const normalizedMarket = market.trim().toUpperCase();
  if (!/^KRW-[A-Z0-9-]+$/.test(normalizedMarket)) throw new Error("owner baseline market is invalid");
  const datasetId = `owner-baseline:upbit-public-ticker:${normalizedMarket}`;
  const generatedAt = periodStartAt - 1;
  return Object.freeze({
    schemaVersion: 1,
    generatedAt: new Date(generatedAt).toISOString(),
    policy: Object.freeze({ maximumCandidateWeight: 1, minimumEvidenceBreadth: 0, maximumCandidateCount: 1, maximumFamilyWeight: 1 }),
    entries: Object.freeze([Object.freeze({
      id: OWNER_BASELINE_CANDIDATE_ID,
      familyId: "sma-crossover",
      rank: 1,
      leagueScore: 0,
      evidenceBreadth: 0,
      researchWeight: 1,
      reasons: Object.freeze([OWNER_BASELINE_REASON]),
      sourceDatasetIds: Object.freeze([datasetId]),
    })]),
    excludedCandidateIds: Object.freeze([]),
    reasons: Object.freeze([OWNER_BASELINE_REASON]),
    provenance: Object.freeze({ sourceDatasetIds: Object.freeze([datasetId]) }),
  });
}

export function ownerBaselineCandidateProvenance(market: string, specificationHash: string): Readonly<{ candidateId: string; datasetId: string; datasetContentSha256: string }> {
  const normalizedMarket = market.trim().toUpperCase();
  const datasetId = `owner-baseline:upbit-public-ticker:${normalizedMarket}`;
  return Object.freeze({
    candidateId: OWNER_BASELINE_CANDIDATE_ID,
    datasetId,
    datasetContentSha256: sha256({ datasetId, specificationHash }),
  });
}

export function ownerBaselineStrategyEnabled(env: NodeJS.ProcessEnv): boolean {
  const mode = env.NUSA_MODE;
  if (mode !== undefined && mode !== "PAPER") return false;
  const value = env[OWNER_BASELINE_STRATEGY_ENV];
  return value === undefined || value === "ENABLED";
}

export function ownerBaselineStrategySpec(sourceCommitSha: string): PaperCandidateStrategySpec {
  const codeSha = sourceCommitSha.trim().toLowerCase();
  if (!SHA40.test(codeSha)) throw new Error("owner baseline strategy requires the exact 40-hex source commit");
  const parameters = Object.freeze({ shortPeriod: 5, longPeriod: 20 });
  const identity = { candidateId: OWNER_BASELINE_CANDIDATE_ID, familyId: "sma-crossover", lineageId: "owner-baseline", parameters, costModelVersion: "nusa-paper-cost-v1" };
  return Object.freeze({ ...identity, specificationHash: sha256(identity), codeSha });
}

/** Deterministic baseline binding for one market and UTC day, so a restart keeps the same binding. */
export function ownerBaselineBinding(market: string, decisionAt: number, sourceCommitSha: string): PaperCandidateExecutionBinding {
  if (!Number.isSafeInteger(decisionAt) || decisionAt < DAY_MS) throw new Error("owner baseline decision time is invalid");
  const normalizedMarket = market.trim().toUpperCase();
  const strategy = ownerBaselineStrategySpec(sourceCommitSha);
  const periodStartAt = Math.floor(decisionAt / DAY_MS) * DAY_MS;
  const datasetId = `owner-baseline:upbit-public-ticker:${normalizedMarket}`;
  const datasetContentSha256 = sha256({ datasetId, specificationHash: strategy.specificationHash });
  const advisory = ownerBaselineAdvisory(normalizedMarket, periodStartAt);
  return bindPaperCandidateForExecution(
    advisory,
    [ownerBaselineCandidateProvenance(normalizedMarket, strategy.specificationHash)],
    OWNER_BASELINE_CANDIDATE_ID,
    periodStartAt,
    strategy,
  ) as PaperCandidateExecutionBinding;
}

export class OwnerBaselinePaperBindingProvider implements PaperCandidateBindingProvider {
  public constructor(private readonly options: Readonly<{
    challenger?: PaperCandidateBindingProvider;
    sourceCommitSha: string;
    enabled: boolean;
  }>) {}

  public read(market: string, decisionAt: number): PaperCandidateExecutionBinding | undefined {
    const challenger = this.options.challenger?.read(market, decisionAt);
    if (challenger != null || !this.options.enabled) return challenger;
    try {
      return ownerBaselineBinding(market, decisionAt, this.options.sourceCommitSha);
    } catch {
      return undefined; // fail closed: no baseline means no automatic PAPER action
    }
  }
}
