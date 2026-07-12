export type DashboardStatus = "HEALTHY" | "CAUTION" | "BLOCKED";

export interface DashboardSection {
  readonly status: DashboardStatus;
  readonly generatedAt: number;
  readonly reasons: readonly string[];
}

export interface PortfolioDashboardSection extends DashboardSection {
  readonly totalEquity: number;
  readonly deployableCapital: number;
  readonly reservedCapital: number;
  readonly grossExposureRatio: number;
  readonly netExposureRatio: number;
}

export interface OpportunityDashboardSection extends DashboardSection {
  readonly activeCount: number;
  readonly totalAllocatedCapital: number;
  readonly reservedCash: number;
  readonly topOpportunityId?: string;
  readonly topOpportunityScore?: number;
}

export interface StrategyDashboardSection extends DashboardSection {
  readonly totalTrades: number;
  readonly totalNetPnl: number;
  readonly portfolioCaptureRatio: number;
  readonly blockedStrategies: number;
  readonly warningStrategies: number;
}

export interface CommitteeDashboardSection extends DashboardSection {
  readonly decision: string;
  readonly confidence: number;
  readonly edge: number;
  readonly risk: number;
  readonly conflictLevel: string;
}

export interface ExecutionDashboardSection extends DashboardSection {
  readonly fillQuality: number;
  readonly slippageBps: number;
  readonly latencyMs: number;
}

export interface ResearchDashboardSection extends DashboardSection {
  readonly walkForwardPassed: boolean;
  readonly monteCarloPassed: boolean;
  readonly costStressPassed: boolean;
  readonly paperPromotionEligible: boolean;
}

export interface RiskDashboardSection extends DashboardSection {
  readonly killSwitchActive: boolean;
  readonly dailyDrawdownRatio: number;
  readonly liquidationBufferRatio: number;
  readonly portfolioHeatRatio: number;
}

export interface AiCioDashboardInput {
  readonly generatedAt: number;
  readonly maximumSectionAgeMs: number;
  readonly portfolio: PortfolioDashboardSection;
  readonly opportunities: OpportunityDashboardSection;
  readonly strategies: StrategyDashboardSection;
  readonly committee: CommitteeDashboardSection;
  readonly execution: ExecutionDashboardSection;
  readonly research: ResearchDashboardSection;
  readonly risk: RiskDashboardSection;
}

export interface AiCioDashboardSnapshot {
  readonly generatedAt: number;
  readonly status: DashboardStatus;
  readonly tradingPermitted: boolean;
  readonly portfolio: PortfolioDashboardSection;
  readonly opportunities: OpportunityDashboardSection;
  readonly strategies: StrategyDashboardSection;
  readonly committee: CommitteeDashboardSection;
  readonly execution: ExecutionDashboardSection;
  readonly research: ResearchDashboardSection;
  readonly risk: RiskDashboardSection;
  readonly warnings: readonly string[];
}

const assertTime = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};

const assertFinite = (value: number, field: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
};

const assertRatio = (value: number, field: string): void => {
  assertFinite(value, field);
  if (value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1`);
};

const freezeSection = <T extends DashboardSection>(section: T): T => Object.freeze({
  ...section,
  reasons: Object.freeze([...section.reasons].sort())
}) as T;

export function buildAiCioDashboard(input: AiCioDashboardInput, now: number): AiCioDashboardSnapshot {
  assertTime(now, "now");
  assertTime(input.generatedAt, "generatedAt");
  assertTime(input.maximumSectionAgeMs, "maximumSectionAgeMs");
  if (input.generatedAt > now) throw new Error("dashboard cannot come from the future");

  const sections = [input.portfolio, input.opportunities, input.strategies, input.committee, input.execution, input.research, input.risk] as const;
  const warnings: string[] = [];
  for (const [index, section] of sections.entries()) {
    assertTime(section.generatedAt, `section[${index}].generatedAt`);
    if (section.generatedAt > now) throw new Error("dashboard section cannot come from the future");
    if (now - section.generatedAt > input.maximumSectionAgeMs) warnings.push(`SECTION_${index}_STALE`);
    for (const reason of section.reasons) if (!reason.trim()) throw new Error("dashboard reason must not be blank");
    if (section.status !== "HEALTHY" && section.status !== "CAUTION" && section.status !== "BLOCKED") throw new Error("invalid dashboard status");
  }

  for (const [field, value] of Object.entries({
    totalEquity: input.portfolio.totalEquity,
    deployableCapital: input.portfolio.deployableCapital,
    reservedCapital: input.portfolio.reservedCapital,
    totalAllocatedCapital: input.opportunities.totalAllocatedCapital,
    reservedCash: input.opportunities.reservedCash,
    totalNetPnl: input.strategies.totalNetPnl,
    slippageBps: input.execution.slippageBps,
    latencyMs: input.execution.latencyMs
  })) assertFinite(value, field);

  if (input.portfolio.totalEquity < 0 || input.portfolio.deployableCapital < 0 || input.portfolio.reservedCapital < 0) throw new Error("portfolio capital must be non-negative");
  if (input.opportunities.activeCount < 0 || !Number.isSafeInteger(input.opportunities.activeCount)) throw new Error("activeCount must be a non-negative safe integer");
  if (input.strategies.totalTrades < 0 || !Number.isSafeInteger(input.strategies.totalTrades)) throw new Error("totalTrades must be a non-negative safe integer");
  if (input.strategies.blockedStrategies < 0 || input.strategies.warningStrategies < 0) throw new Error("strategy counts must be non-negative");
  if (input.execution.latencyMs < 0) throw new Error("latencyMs must be non-negative");

  assertRatio(input.portfolio.grossExposureRatio, "grossExposureRatio");
  assertRatio(input.portfolio.netExposureRatio, "netExposureRatio");
  assertRatio(input.strategies.portfolioCaptureRatio, "portfolioCaptureRatio");
  assertRatio(input.committee.confidence, "committee.confidence");
  assertRatio(input.committee.edge, "committee.edge");
  assertRatio(input.committee.risk, "committee.risk");
  assertRatio(input.execution.fillQuality, "execution.fillQuality");
  assertRatio(input.risk.dailyDrawdownRatio, "dailyDrawdownRatio");
  assertRatio(input.risk.liquidationBufferRatio, "liquidationBufferRatio");
  assertRatio(input.risk.portfolioHeatRatio, "portfolioHeatRatio");

  if (input.portfolio.deployableCapital + input.portfolio.reservedCapital > input.portfolio.totalEquity + 1e-8) {
    throw new Error("deployable and reserved capital exceed total equity");
  }

  const blocked = warnings.length > 0 || input.risk.killSwitchActive || sections.some((section) => section.status === "BLOCKED") || !input.research.paperPromotionEligible;
  const caution = sections.some((section) => section.status === "CAUTION") || input.strategies.warningStrategies > 0;
  if (input.risk.killSwitchActive) warnings.push("KILL_SWITCH_ACTIVE");
  if (!input.research.paperPromotionEligible) warnings.push("RESEARCH_GATE_NOT_PASSED");
  if (input.strategies.blockedStrategies > 0) warnings.push("STRATEGY_HEALTH_BLOCKED");

  const status: DashboardStatus = blocked ? "BLOCKED" : caution ? "CAUTION" : "HEALTHY";
  const tradingPermitted = status !== "BLOCKED" && input.committee.decision !== "REJECT" && input.committee.decision !== "EMERGENCY_EXIT";

  return Object.freeze({
    generatedAt: input.generatedAt,
    status,
    tradingPermitted,
    portfolio: freezeSection(input.portfolio),
    opportunities: freezeSection(input.opportunities),
    strategies: freezeSection(input.strategies),
    committee: freezeSection(input.committee),
    execution: freezeSection(input.execution),
    research: freezeSection(input.research),
    risk: freezeSection(input.risk),
    warnings: Object.freeze([...new Set(warnings)].sort())
  });
}
