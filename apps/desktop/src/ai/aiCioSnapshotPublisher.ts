import {
  buildAiCioDashboard,
  type AiCioDashboardInput,
  type AiCioDashboardSnapshot,
  type CommitteeDashboardSection,
  type ExecutionDashboardSection,
  type OpportunityDashboardSection,
  type PortfolioDashboardSection,
  type ResearchDashboardSection,
  type RiskDashboardSection,
  type StrategyDashboardSection
} from "../../../cloud/src/dashboardAggregator";
import {
  buildAiCioCommandCenterEnvelope,
  type AiCioCommandCenterEnvelopeV1
} from "./aiCioCommandCenterAdapter";

export interface AiCioSnapshotSink {
  publish(envelope: AiCioCommandCenterEnvelopeV1): void;
  clear(): void;
}

export interface AiCioSectionSet {
  readonly portfolio?: PortfolioDashboardSection;
  readonly opportunities?: OpportunityDashboardSection;
  readonly strategies?: StrategyDashboardSection;
  readonly committee?: CommitteeDashboardSection;
  readonly execution?: ExecutionDashboardSection;
  readonly research?: ResearchDashboardSection;
  readonly risk?: RiskDashboardSection;
}

export interface AiCioSnapshotPublisherConfig {
  readonly mode: "PAPER" | "DRY_RUN";
  readonly maximumSectionAgeMs: number;
  readonly maximumEnvelopeAgeMs: number;
}

const assertPositiveTime = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} must be a positive safe integer`);
};

const isComplete = (sections: AiCioSectionSet): sections is Required<AiCioSectionSet> =>
  sections.portfolio !== undefined &&
  sections.opportunities !== undefined &&
  sections.strategies !== undefined &&
  sections.committee !== undefined &&
  sections.execution !== undefined &&
  sections.research !== undefined &&
  sections.risk !== undefined;

export class AiCioSnapshotPublisher {
  constructor(
    private readonly sink: AiCioSnapshotSink,
    private readonly config: AiCioSnapshotPublisherConfig
  ) {
    assertPositiveTime(config.maximumSectionAgeMs, "maximumSectionAgeMs");
    assertPositiveTime(config.maximumEnvelopeAgeMs, "maximumEnvelopeAgeMs");
  }

  clear(): void {
    this.sink.clear();
  }

  publishIfComplete(sections: AiCioSectionSet, now: number): AiCioCommandCenterEnvelopeV1 | null {
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("now must be a non-negative safe integer");
    if (!isComplete(sections)) {
      this.sink.clear();
      return null;
    }

    const allSections = [
      sections.portfolio,
      sections.opportunities,
      sections.strategies,
      sections.committee,
      sections.execution,
      sections.research,
      sections.risk
    ] as const;

    if (allSections.some((section) => section.generatedAt > now || now - section.generatedAt > this.config.maximumSectionAgeMs)) {
      this.sink.clear();
      return null;
    }

    try {
      const input: AiCioDashboardInput = {
        generatedAt: now,
        maximumSectionAgeMs: this.config.maximumSectionAgeMs,
        portfolio: sections.portfolio,
        opportunities: sections.opportunities,
        strategies: sections.strategies,
        committee: sections.committee,
        execution: sections.execution,
        research: sections.research,
        risk: sections.risk
      };
      const snapshot: AiCioDashboardSnapshot = buildAiCioDashboard(input, now);
      const envelope = buildAiCioCommandCenterEnvelope({
        mode: this.config.mode,
        snapshot,
        maximumAgeMs: this.config.maximumEnvelopeAgeMs
      }, now);
      this.sink.publish(envelope);
      return envelope;
    } catch (error) {
      this.sink.clear();
      throw error;
    }
  }
}
