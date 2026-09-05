import { decideCio, type CioDecision, type PaperCandidateExecutionBinding } from "./cioDecisionEngine";
import { fuseMarketIntelligence } from "./marketIntelligenceFusion";
import { buildPortfolioPlan } from "./portfolioOrchestrator";
import type { MobileDashboardApiInput } from "./mobileDashboardApi";
import type { CloudDashboardStateProvider } from "./cloudDashboardStateProvider";
import type { IntelligenceObservation } from "./marketIntelligenceFusion";
import { evaluatePaperCandidateStrategy } from "./paperCandidateStrategy";

export interface PaperCandidateBindingProvider {
  read(market: string, decisionAt: number): PaperCandidateExecutionBinding | undefined;
}

export interface CloudRuntimeDashboardHydratorOptions {
  readonly now?: () => number;
  readonly maxPaperAllocation?: number;
  readonly paperCandidateBindingProvider?: PaperCandidateBindingProvider;
}

const DEFAULT_MAX_PAPER_ALLOCATION = 0.1;
const operatorPrincipal = Object.freeze({ userId: "operator", scopes: Object.freeze(["dashboard:read"]) });
const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Composes the safe Cloud PAPER runtime state. Market-scoped evidence produces a
 * market-scoped CIO decision; evidence without a market remains advisory only.
 *
 * A challenger binding is read-only provenance supplied by the closed-learning
 * composition root. `decideCio` validates it again at the decision timestamp and
 * keeps it `BOUND_UNVERIFIED`; this hydrator never creates candidate identity and
 * never grants LIVE or production-mutation authority.
 */
export class CloudRuntimeDashboardHydrator {
  private readonly now: () => number;
  private readonly maxPaperAllocation: number;
  private readonly paperCandidateBindingProvider?: PaperCandidateBindingProvider;

  public constructor(options: CloudRuntimeDashboardHydratorOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.maxPaperAllocation = options.maxPaperAllocation ?? DEFAULT_MAX_PAPER_ALLOCATION;
    this.paperCandidateBindingProvider = options.paperCandidateBindingProvider;
    if (!Number.isFinite(this.maxPaperAllocation) || this.maxPaperAllocation <= 0 || this.maxPaperAllocation > 1) {
      throw new Error("maxPaperAllocation must be in (0, 1]");
    }
  }

  public hydrate(provider: CloudDashboardStateProvider, observations: readonly IntelligenceObservation[] = []): void {
    try {
      const now = this.now();
      if (!Number.isSafeInteger(now) || now < 0) throw new Error("runtime clock is invalid");
      const validObservations = observations.filter((observation) => observation.expiresAt >= now && observation.observedAt <= now);
      const intelligence = validObservations.length > 0
        ? fuseMarketIntelligence(now, validObservations)
        : fuseMarketIntelligence(now, [{
          id: "runtime-no-market-data",
          source: "RISK",
          sentiment: 0,
          confidence: 0,
          observedAt: now,
          expiresAt: now,
          summary: "No market data available"
        }]);

      const previous = provider.read(operatorPrincipal);
      const marketGroups = new Map<string, IntelligenceObservation[]>();
      const globalObservations = validObservations.filter((observation) => observation.market === undefined);
      for (const observation of validObservations) {
        if (observation.market === undefined) continue;
        const market = observation.market.trim().toUpperCase();
        const group = marketGroups.get(market) ?? [];
        group.push(observation);
        marketGroups.set(market, group);
      }

      const decisions: CioDecision[] = [];
      for (const market of [...marketGroups.keys()].sort()) {
        const marketIntelligence = fuseMarketIntelligence(now, [...globalObservations, ...marketGroups.get(market)!]);
        if (marketIntelligence.signals.length === 0) continue;
        const currentAllocation = clampUnit(previous?.portfolio.allocations
          .filter((allocation) => allocation.symbol === market && allocation.instrument === "SPOT")
          .reduce((sum, allocation) => sum + allocation.share, 0) ?? 0);
        const paperCandidateBinding = this.paperCandidateBindingProvider?.read(market, now);
        const paperCandidateStrategyDecision = paperCandidateBinding?.candidateStrategy == null
          ? undefined
          : evaluatePaperCandidateStrategy(paperCandidateBinding.candidateStrategy, marketGroups.get(market) ?? [], now, market);
        decisions.push(decideCio({
          symbol: market,
          now,
          signals: marketIntelligence.signals,
          currentAllocation,
          maxAllocation: Math.max(this.maxPaperAllocation, currentAllocation),
          maxLeverage: 1,
          risk: "MEDIUM",
          tradingEnabled: true,
          ...(paperCandidateBinding == null ? {} : { paperCandidateBinding }),
          ...(paperCandidateStrategyDecision == null ? {} : { paperCandidateStrategyDecision })
        }));
      }

      const hasExecutableMarketData = decisions.length > 0;
      if (!hasExecutableMarketData) {
        decisions.push(decideCio({
          symbol: "NO_MARKET_DATA",
          now,
          signals: intelligence.signals,
          currentAllocation: 0,
          maxAllocation: 0,
          maxLeverage: 1,
          risk: "CRITICAL",
          tradingEnabled: false
        }));
      }

      const deployableCapital = previous == null ? 0 : previous.portfolio.deployedCapital + previous.portfolio.cashCapital;
      const reservedCapital = previous?.portfolio.reservedCapital ?? 0;
      const portfolio = buildPortfolioPlan({
        now,
        deployableCapital,
        reservedCapital,
        candidates: decisions.map((decision) => ({ decision, instrument: "SPOT" as const })),
        maxFuturesShare: 0,
        maxGrossShare: 1
      });
      const state: MobileDashboardApiInput = Object.freeze({
        now,
        mode: "PAPER",
        killSwitchActive: !hasExecutableMarketData,
        overallHealth: hasExecutableMarketData ? "HEALTHY" : "DOWN",
        headline: hasExecutableMarketData ? "Paper runtime evaluating live public market data" : "Paper runtime awaiting market data",
        issues: Object.freeze(hasExecutableMarketData
          ? []
          : ["Market data unavailable", "Trading is blocked by the kill switch"]),
        portfolio,
        decisions: Object.freeze(decisions),
        intelligence
      });
      provider.set(state);
    } catch {
      provider.clear();
    }
  }
}
