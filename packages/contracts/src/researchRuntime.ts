import { createHash } from "node:crypto";
import type { ResearchCostEvidence } from "./researchHardening";

export type ResearchEvaluatorAuthority = "PAPER_ONLY" | "ZERO_AUTHORITY";
export type ResearchComparisonResult = "CHAMPION_BETTER" | "CHALLENGER_BETTER" | "EQUIVALENT" | "INCONCLUSIVE";

export interface ResearchMarketPoint {
  readonly market: string;
  readonly price: number;
  readonly observedAt: number;
}

export interface ResearchInputSnapshot {
  readonly researchRunId: string;
  readonly evaluationId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly marketDataTimestamp: number;
  readonly evaluationTimestamp: number;
  readonly modelVersion: string;
  readonly fillModelVersion: string;
  readonly feeModelVersion: string;
  readonly slippageModelVersion: string;
  readonly strategyState: string;
  readonly staleWindowMs: number;
  readonly marketData: readonly ResearchMarketPoint[];
  readonly startingCash: number;
  readonly startingPositionQuantity: number;
  readonly provenance?: import("./researchHardening").ResearchProvenance;
  readonly costEvidence?: ResearchCostEvidence;
}

export interface ResearchEvaluationContext {
  readonly input: ResearchInputSnapshot;
  readonly canonicalInputHash: string;
  readonly fillModelVersion: string;
  readonly feeModelVersion: string;
  readonly slippageModelVersion: string;
}

export interface ResearchEvaluation {
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly authority: ResearchEvaluatorAuthority;
  readonly evaluatorVersion: string;
  readonly canonicalInputHash: string;
  readonly metrics: Readonly<Record<string, number>>;
  readonly signal: "BUY" | "SELL" | "HOLD";
}

export interface ResearchComparisonEvidence {
  readonly schemaVersion: 1;
  readonly researchRunId: string;
  readonly evaluationId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly marketDataTimestamp: number;
  readonly evaluationTimestamp: number;
  readonly canonicalInputHash: string;
  readonly modelVersion: string;
  readonly fillModelVersion: string;
  readonly feeModelVersion: string;
  readonly slippageModelVersion: string;
  readonly champion: ResearchEvaluation | null;
  readonly challenger: ResearchEvaluation | null;
  readonly result: ResearchComparisonResult;
  readonly reason: string;
  readonly productionMutationAllowed: false;
  readonly promotionAllowed: false;
  readonly provenance?: import("./researchHardening").ResearchProvenance;
  readonly costEvidence?: ResearchCostEvidence;
}

export interface ResearchEvaluationLedger {
  append(record: ResearchComparisonEvidence): void;
  list(): readonly ResearchComparisonEvidence[];
  readonly headHash?: () => string;
}

export function canonicalResearchJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical research json rejects non-finite numbers");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonicalResearchJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalResearchJson(record[key])}`).join(",")}}`;
  }
  throw new Error("unsupported research input value");
}

export function hashResearchInput(input: ResearchInputSnapshot): string {
  return createHash("sha256").update(canonicalResearchJson(input), "utf8").digest("hex");
}
