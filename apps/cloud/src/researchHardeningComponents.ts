import { researchHardeningHash, type ResearchProvenance } from "../../../packages/contracts/src/researchHardening";
import type { ResearchComparisonEvidence } from "../../../packages/contracts/src/researchRuntime";
import type { ResearchHealth } from "../../../packages/contracts/src/researchAutomation";
import type { ResearchAutomationRuntime, ResearchRuntimeMarketDataInput } from "./researchAutomationRuntime";

export class ResearchProvenanceBuilder {
  public build(input: ResearchProvenance): ResearchProvenance {
    return Object.freeze({ ...input, canonicalInputHash: input.canonicalInputHash || researchHardeningHash({ ...input, canonicalInputHash: undefined }) });
  }
}

export class ResearchMetricsAggregator {
  public aggregate(records: readonly ResearchComparisonEvidence[]): Readonly<Record<string, number>> {
    const values = records.flatMap((record) => record.challenger?.metrics.netReturn == null ? [] : [record.challenger.metrics.netReturn]);
    return Object.freeze({ experimentCount: records.length, challengerBetterCount: records.filter((record) => record.result === "CHALLENGER_BETTER").length, championBetterCount: records.filter((record) => record.result === "CHAMPION_BETTER").length, inconclusiveCount: records.filter((record) => record.result === "INCONCLUSIVE").length, cumulativeNetReturn: values.reduce((sum, value) => sum + value, 0), averageNetReturn: values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length });
  }
}

export class ResearchHealthProjection {
  public project(input: { readonly recoveryReady: boolean; readonly evidenceAgeMs?: number; readonly maxEvidenceAgeMs: number; readonly inconclusiveRate: number; readonly integrity: boolean }): ResearchHealth {
    if (!input.recoveryReady || !input.integrity) return "FAIL_CLOSED";
    if (input.evidenceAgeMs == null || input.inconclusiveRate > 0.5) return "DEGRADED";
    return input.evidenceAgeMs > input.maxEvidenceAgeMs ? "STALE" : "HEALTHY";
  }
}

export class ResearchExperimentOrchestrator {
  public constructor(private readonly runtime: ResearchAutomationRuntime) {}
  public run(input: Parameters<ResearchAutomationRuntime["runExperiment"]>[0]): ResearchComparisonEvidence { return this.runtime.runExperiment(input); }
  public onMarketData(input: ResearchRuntimeMarketDataInput): ResearchComparisonEvidence | undefined { return this.runtime.onMarketData(input); }
}

export class ResearchSessionCoordinator {
  public constructor(private readonly runtime: ResearchAutomationRuntime) {}
  public start(input: Parameters<ResearchAutomationRuntime["startSession"]>[0]) { return this.runtime.startSession(input); }
  public pause(sessionId: string) { return this.runtime.pause(sessionId); }
  public resume(sessionId: string) { return this.runtime.resume(sessionId); }
  public halt(sessionId: string) { return this.runtime.halt(sessionId); }
}

export class ResearchMemoryAdapter {
  public append<T extends { readonly id: string }>(writer: { appendExperiment(record: T): T }, record: T): T { return writer.appendExperiment(record); }
}
