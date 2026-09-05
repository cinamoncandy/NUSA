import React from "react";
import type { InMemoryDashboardCredentialSession } from "./dashboardCredentialSession";
import { PaperLearningMonitorView } from "./paperLearningMonitorView";
import { TradingView as LegacyTradingView } from "./tradingViewLegacy";

type TradingViewProps = React.ComponentProps<typeof LegacyTradingView>;

/**
 * PAPER is a supervision surface, not a manual order ticket.
 *
 * The cloud/server runtime owns autonomous PAPER orchestration. Mobile only renders
 * verified PAPER learning evidence and never exposes manual BUY/SELL, price, quantity,
 * or submit controls on the production PAPER route. The legacy ticket remains isolated
 * from this route for internal regression/debug use only.
 *
 * Safety contract remains unchanged: PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY.
 */
export function TradingView(
  props: TradingViewProps & { readonly credentialSession?: InMemoryDashboardCredentialSession },
) {
  const paperLearning = props.paperLearning;

  if (paperLearning == null) {
    return (
      <PaperLearningMonitorView
        state={{
          status: "PAUSED",
          dataSource: "PROJECTION_ABSENT",
          currentCycle: null,
          latestMarket: null,
          latestStrategy: { strategyId: null, candidateId: null, championId: null },
          latestSignal: null,
          latestDecision: null,
          latestGates: [],
          latestRisk: null,
          latestFill: null,
          latestAccount: null,
          latestEvidence: null,
          performance: {
            realizedPnL: null,
            unrealizedPnL: null,
            closedTrades: null,
            winRate: null,
            maxDrawdownPct: null,
          },
          timeline: [],
        }}
        refreshing={props.refreshing}
        onRefresh={props.onRefresh}
      />
    );
  }

  return (
    <PaperLearningMonitorView
      state={paperLearning}
      refreshing={props.refreshing}
      onRefresh={props.onRefresh}
    />
  );
}
