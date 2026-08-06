import { decideCio } from "./cioDecisionEngine";
import { fuseMarketIntelligence } from "./marketIntelligenceFusion";
import { buildPortfolioPlan } from "./portfolioOrchestrator";
import type { MobileDashboardApiInput } from "./mobileDashboardApi";
import type { CloudDashboardStateProvider } from "./cloudDashboardStateProvider";

export interface CloudRuntimeDashboardHydratorOptions {
  readonly now?: () => number;
}

/**
 * Composes the first safe runtime dashboard state. It intentionally uses no market
 * observations: the RISK observation is a diagnostic marker, not market data.
 */
export class CloudRuntimeDashboardHydrator {
  private readonly now: () => number;

  public constructor(options: CloudRuntimeDashboardHydratorOptions = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  public hydrate(provider: CloudDashboardStateProvider): void {
    try {
      const now = this.now();
      if (!Number.isSafeInteger(now) || now < 0) throw new Error("runtime clock is invalid");
      const intelligence = fuseMarketIntelligence(now, [{
        id: "runtime-no-market-data",
        source: "RISK",
        sentiment: 0,
        confidence: 0,
        observedAt: now,
        expiresAt: now,
        summary: "No market data available"
      }]);
      const decision = decideCio({
        symbol: "NO_MARKET_DATA",
        now,
        signals: intelligence.signals,
        currentAllocation: 0,
        maxAllocation: 0,
        maxLeverage: 1,
        risk: "CRITICAL",
        tradingEnabled: false
      });
      const portfolio = buildPortfolioPlan({
        now,
        deployableCapital: 0,
        reservedCapital: 0,
        candidates: [{ decision, instrument: "SPOT" }],
        maxFuturesShare: 0,
        maxGrossShare: 0
      });
      const state: MobileDashboardApiInput = Object.freeze({
        now,
        mode: "PAPER",
        killSwitchActive: true,
        overallHealth: "DOWN",
        headline: "Paper runtime awaiting market data",
        issues: Object.freeze(["Market data unavailable", "Trading is blocked by the kill switch"]),
        portfolio,
        decisions: Object.freeze([decision]),
        intelligence
      });
      provider.set(state);
    } catch {
      provider.clear();
    }
  }
}
