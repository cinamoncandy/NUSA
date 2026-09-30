import { createHash } from "node:crypto";

export type FamilyMemberRole = "CHAMPION" | "CHALLENGER" | "RESEARCH_CANDIDATE";

export interface FamilyPortfolioMemberEvidence {
  readonly strategyId: string;
  readonly familyId: string;
  readonly role: FamilyMemberRole;
  readonly weight: number;
  readonly riskContribution: number;
  readonly turnover: number;
  readonly feeRate: number;
  readonly slippageRate: number;
  readonly grossExpectedEdge: number;
  readonly regime: string;
  readonly returns: readonly number[];
  readonly drawdowns: readonly boolean[];
}

export interface FamilyPortfolioRiskPolicy {
  readonly maximumStrategyWeight: number;
  readonly maximumFamilyWeight: number;
  readonly maximumAbsoluteFamilyCorrelation: number;
  readonly maximumFamilyDrawdownOverlap: number;
  readonly maximumRegimeConcentration: number;
  readonly maximumFamilyRiskBudgetUsage: number;
}

export interface FamilyPortfolioRiskEvidence {
  readonly schemaVersion: 1;
  readonly status: "VERIFIED" | "INSUFFICIENT";
  readonly strategyExposure: Readonly<Record<string, number>>;
  readonly familyExposure: Readonly<Record<string, number>>;
  readonly strategyConcentration: number;
  readonly familyConcentration: number;
  readonly maximumAbsoluteFamilyCorrelation: number | null;
  readonly maximumFamilyDrawdownOverlap: number | null;
  readonly regimeConcentration: number;
  readonly familyRiskBudgetUsage: Readonly<Record<string, number>>;
  readonly netExpectedEdgeAfterCosts: number;
  readonly championChallengerImpact: Readonly<Record<string, number>>;
  readonly reasons: readonly string[];
  readonly fingerprintSha256: string;
  readonly mode: "PAPER_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const finite = (value: number, label: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
};
const ratio = (value: number, label: string): void => {
  finite(value, label);
  if (value < 0 || value > 1) throw new Error(`${label} must be between 0 and 1`);
};
const canonical = (value: unknown): string => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    finite(value, "canonical number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  throw new Error("unsupported canonical value");
};
const digest = (value: unknown): string => createHash("sha256").update(canonical(value), "utf8").digest("hex");

function correlation(left: readonly number[], right: readonly number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null;
  const lm = left.reduce((a, b) => a + b, 0) / left.length;
  const rm = right.reduce((a, b) => a + b, 0) / right.length;
  let cov = 0, lv = 0, rv = 0;
  for (let i = 0; i < left.length; i += 1) {
    const l = left[i] - lm, r = right[i] - rm;
    cov += l * r; lv += l * l; rv += r * r;
  }
  if (lv <= 0 || rv <= 0) return null;
  return cov / Math.sqrt(lv * rv);
}

function familySeries(members: readonly FamilyPortfolioMemberEvidence[], familyId: string): readonly number[] | null {
  const family = members.filter((m) => m.familyId === familyId);
  const length = family[0]?.returns.length ?? 0;
  if (length < 2 || family.some((m) => m.returns.length !== length)) return null;
  const total = family.reduce((sum, m) => sum + m.weight, 0);
  if (total <= 0) return null;
  return Object.freeze(Array.from({ length }, (_, i) =>
    family.reduce((sum, m) => sum + m.returns[i] * (m.weight / total), 0)));
}

function drawdownOverlap(left: readonly boolean[], right: readonly boolean[]): number | null {
  if (left.length !== right.length || left.length === 0) return null;
  let both = 0, either = 0;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] || right[i]) either += 1;
    if (left[i] && right[i]) both += 1;
  }
  return either === 0 ? 0 : both / either;
}

export function buildFamilyPortfolioRiskEvidence(
  rawMembers: readonly FamilyPortfolioMemberEvidence[],
  policy: FamilyPortfolioRiskPolicy,
): FamilyPortfolioRiskEvidence {
  ratio(policy.maximumStrategyWeight, "maximumStrategyWeight");
  ratio(policy.maximumFamilyWeight, "maximumFamilyWeight");
  ratio(policy.maximumAbsoluteFamilyCorrelation, "maximumAbsoluteFamilyCorrelation");
  ratio(policy.maximumFamilyDrawdownOverlap, "maximumFamilyDrawdownOverlap");
  ratio(policy.maximumRegimeConcentration, "maximumRegimeConcentration");
  ratio(policy.maximumFamilyRiskBudgetUsage, "maximumFamilyRiskBudgetUsage");

  const members = [...rawMembers].sort((a, b) => a.familyId.localeCompare(b.familyId) || a.strategyId.localeCompare(b.strategyId));
  const seen = new Set<string>();
  for (const m of members) {
    if (!m.strategyId.trim() || !m.familyId.trim() || !m.regime.trim()) throw new Error("strategy/family/regime identity is required");
    if (seen.has(m.strategyId)) throw new Error(`duplicate strategyId: ${m.strategyId}`);
    seen.add(m.strategyId);
    ratio(m.weight, "weight"); ratio(m.riskContribution, "riskContribution"); ratio(m.turnover, "turnover");
    ratio(m.feeRate, "feeRate"); ratio(m.slippageRate, "slippageRate"); finite(m.grossExpectedEdge, "grossExpectedEdge");
    if (m.returns.some((v) => !Number.isFinite(v))) throw new Error("returns must be finite");
    if (m.drawdowns.length !== m.returns.length) throw new Error("drawdown evidence length mismatch");
  }

  const reasons: string[] = [];
  if (members.length === 0) reasons.push("MEMBERS_MISSING");
  const strategyExposure: Record<string, number> = {};
  const familyExposure: Record<string, number> = {};
  const familyRiskBudgetUsage: Record<string, number> = {};
  const regimeExposure: Record<string, number> = {};
  const championChallengerImpact: Record<string, number> = {};
  let netExpectedEdgeAfterCosts = 0;

  for (const m of members) {
    strategyExposure[m.strategyId] = m.weight;
    familyExposure[m.familyId] = (familyExposure[m.familyId] ?? 0) + m.weight;
    familyRiskBudgetUsage[m.familyId] = (familyRiskBudgetUsage[m.familyId] ?? 0) + m.riskContribution;
    regimeExposure[m.regime] = (regimeExposure[m.regime] ?? 0) + m.weight;
    netExpectedEdgeAfterCosts += m.weight * (m.grossExpectedEdge - m.turnover * (m.feeRate + m.slippageRate));
    if (m.role === "CHALLENGER") championChallengerImpact[m.familyId] = (championChallengerImpact[m.familyId] ?? 0) + m.riskContribution;
    if (m.weight > policy.maximumStrategyWeight) reasons.push(`STRATEGY_CONCENTRATION_EXCEEDED:${m.strategyId}`);
  }

  for (const [familyId, exposure] of Object.entries(familyExposure)) {
    if (exposure > policy.maximumFamilyWeight) reasons.push(`FAMILY_CONCENTRATION_EXCEEDED:${familyId}`);
    if ((familyRiskBudgetUsage[familyId] ?? 0) > policy.maximumFamilyRiskBudgetUsage) reasons.push(`FAMILY_RISK_BUDGET_EXCEEDED:${familyId}`);
  }

  const totalExposure = Object.values(familyExposure).reduce((a, b) => a + b, 0);
  const strategyConcentration = totalExposure > 0 ? Object.values(strategyExposure).reduce((sum, w) => sum + (w / totalExposure) ** 2, 0) : 0;
  const familyConcentration = totalExposure > 0 ? Object.values(familyExposure).reduce((sum, w) => sum + (w / totalExposure) ** 2, 0) : 0;
  const regimeConcentration = totalExposure > 0 ? Math.max(0, ...Object.values(regimeExposure).map((w) => w / totalExposure)) : 0;
  if (regimeConcentration > policy.maximumRegimeConcentration) reasons.push("REGIME_CONCENTRATION_EXCEEDED");

  const families = Object.keys(familyExposure).sort();
  let maximumAbsoluteFamilyCorrelation: number | null = null;
  let maximumFamilyDrawdownOverlap: number | null = null;
  if (families.length < 2) reasons.push("CROSS_FAMILY_EVIDENCE_INSUFFICIENT");
  for (let i = 0; i < families.length; i += 1) {
    for (let j = i + 1; j < families.length; j += 1) {
      const left = familySeries(members, families[i]), right = familySeries(members, families[j]);
      const corr = left && right ? correlation(left, right) : null;
      if (corr == null) reasons.push(`FAMILY_CORRELATION_INSUFFICIENT:${families[i]}|${families[j]}`);
      else maximumAbsoluteFamilyCorrelation = Math.max(maximumAbsoluteFamilyCorrelation ?? 0, Math.abs(corr));

      const lm = members.filter((m) => m.familyId === families[i]);
      const rm = members.filter((m) => m.familyId === families[j]);
      const overlaps = lm.flatMap((l) => rm.map((r) => drawdownOverlap(l.drawdowns, r.drawdowns))).filter((v): v is number => v != null);
      if (overlaps.length === 0) reasons.push(`FAMILY_DRAWDOWN_OVERLAP_INSUFFICIENT:${families[i]}|${families[j]}`);
      else maximumFamilyDrawdownOverlap = Math.max(maximumFamilyDrawdownOverlap ?? 0, ...overlaps);
    }
  }
  if (maximumAbsoluteFamilyCorrelation != null && maximumAbsoluteFamilyCorrelation > policy.maximumAbsoluteFamilyCorrelation) reasons.push("FAMILY_CORRELATION_LIMIT_EXCEEDED");
  if (maximumFamilyDrawdownOverlap != null && maximumFamilyDrawdownOverlap > policy.maximumFamilyDrawdownOverlap) reasons.push("FAMILY_DRAWDOWN_OVERLAP_LIMIT_EXCEEDED");
  if (!Number.isFinite(netExpectedEdgeAfterCosts) || netExpectedEdgeAfterCosts <= 0) reasons.push("NON_POSITIVE_EDGE_AFTER_COSTS");

  const payload = {
    schemaVersion: 1 as const,
    status: (reasons.length === 0 ? "VERIFIED" : "INSUFFICIENT") as "VERIFIED" | "INSUFFICIENT",
    strategyExposure: Object.freeze(strategyExposure),
    familyExposure: Object.freeze(familyExposure),
    strategyConcentration,
    familyConcentration,
    maximumAbsoluteFamilyCorrelation,
    maximumFamilyDrawdownOverlap,
    regimeConcentration,
    familyRiskBudgetUsage: Object.freeze(familyRiskBudgetUsage),
    netExpectedEdgeAfterCosts,
    championChallengerImpact: Object.freeze(championChallengerImpact),
    reasons: Object.freeze([...new Set(reasons)].sort()),
    mode: "PAPER_ONLY" as const,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const,
    aiAuthority: "ZERO_AUTHORITY" as const,
  };
  return Object.freeze({ ...payload, fingerprintSha256: digest(payload) });
}
