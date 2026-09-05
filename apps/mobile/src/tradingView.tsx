import React from "react";
import type { InMemoryDashboardCredentialSession } from "./dashboardCredentialSession";
import { PaperLearningMonitorView } from "./paperLearningMonitorView";
import { buildPaperLearningScreen } from "./paperLearningScreen";
import { TradingView as LegacyTradingView } from "./tradingViewLegacy";

type TradingViewProps = React.ComponentProps<typeof LegacyTradingView>;

/**
 * Production PAPER is a supervision surface, not a manual order ticket.
 *
 * The cloud/server runtime owns autonomous PAPER orchestration. Mobile only renders
 * observed PAPER learning evidence and never exposes manual BUY/SELL, price, quantity,
 * or submit controls on the production PAPER route. The legacy ticket remains isolated
 * from this route for internal regression/debug use only.
 *
 * Safety contract remains unchanged: PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY.
 */
export function TradingView(
  props: TradingViewProps & { readonly credentialSession?: InMemoryDashboardCredentialSession },
) {
  const paperLearning = props.paperLearning
    ?? buildPaperLearningScreen([], "PAUSED", "PROJECTION_ABSENT");

  return (
    <PaperLearningMonitorView
      state={paperLearning}
      refreshing={props.refreshing}
      onRefresh={props.onRefresh}
    />
  );
}
