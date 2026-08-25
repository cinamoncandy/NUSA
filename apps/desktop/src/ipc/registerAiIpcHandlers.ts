import { answerSignalFollowUp, explainStrategySignal, type SignalExplanationRequest, type AiSignalExplanation, type AiSignalFollowUpAnswer } from "../ai/aiSignalExplainer";
import { explainChallengerDisagreement } from "../ai/aiChallengerDisagreementExplainer";
import { summarizeSession, type SessionSummaryRequest, type AiSessionSummary } from "../ai/aiSessionSummary";
import { explainRegime, type RegimeExplanationRequest, type AiRegimeExplanation } from "../ai/aiRegimeExplainer";
import { evaluateStrategyRegime } from "../strategy/regimePolicy";
import { explainRiskCommentary, type RiskCommentaryRequest, type AiRiskCommentary } from "../ai/aiRiskCommentary";
import type { RuntimeContext } from "./runtimeContext";

/** The five research-assistant IPC channels: signal explainer (+ follow-up), challenger status/
 * history/disagreement, session summary, regime, and risk commentary. All read-only, all
 * dark-by-default when their AI client is unconfigured (see governedAiAssistantCall). */
export function registerAiIpcHandlers(ctx: RuntimeContext): void {
  ctx.ipcMain.handle("ai:explain-latest-signal", async () => {
    const signal = ctx.strategy.getLatestSignal();
    const request: SignalExplanationRequest | undefined = signal === undefined
      ? undefined
      : { market: ctx.MARKET, signal, recentPrices: ctx.strategy.getHistory(), signalHistory: ctx.strategy.getSignalHistory() };
    const result = await ctx.governedAiAssistantCall<AiSignalExplanation>(
      "SIGNAL_EXPLAINER",
      { handler: "explain-latest-signal", request },
      () => Object.freeze({ status: "UNAVAILABLE" as const, explanation: "AI 리서치 호출 한도에 도달했습니다. 잠시 후 다시 시도하세요.", generatedAt: Date.now() }),
      () => explainStrategySignal({ request, client: ctx.aiSignalExplainerClient, nowMs: Date.now() })
    );
    ctx.lastAiSignalExplanation = request !== undefined && result.status === "OK" ? Object.freeze({ request, explanation: result.explanation }) : undefined;
    return result;
  });
  ctx.ipcMain.handle("ai:ask-followup-question", async (_event, question: unknown) => {
    if (typeof question !== "string") throw new Error("invalid follow-up question");
    return ctx.governedAiAssistantCall<AiSignalFollowUpAnswer>(
      "SIGNAL_EXPLAINER",
      { handler: "ask-followup-question", request: ctx.lastAiSignalExplanation?.request, priorExplanation: ctx.lastAiSignalExplanation?.explanation, question },
      () => Object.freeze({ status: "UNAVAILABLE" as const, answer: "AI 리서치 호출 한도에 도달했습니다. 잠시 후 다시 시도하세요.", generatedAt: Date.now() }),
      () => answerSignalFollowUp({
        request: ctx.lastAiSignalExplanation?.request,
        priorExplanation: ctx.lastAiSignalExplanation?.explanation,
        question,
        client: ctx.aiSignalExplainerClient,
        nowMs: Date.now()
      })
    );
  });
  ctx.ipcMain.handle("ai:challenger-status", () => ({
    configured: ctx.aiChallengerClient !== undefined,
    latest: ctx.aiChallengerObserver.getLatestObservation() ?? null,
    stats: ctx.aiChallengerObserver.getStats()
  }));
  ctx.ipcMain.handle("ai:explain-challenger-disagreement", async () => explainChallengerDisagreement({
    observation: ctx.aiChallengerObserver.getLatestObservation(),
    client: ctx.aiDisagreementExplainerClient,
    nowMs: Date.now()
  }));
  ctx.ipcMain.handle("ai:challenger-history", () => ctx.aiChallengerObserver.getHistory());
  ctx.ipcMain.handle("ai:summarize-session", async () => {
    const request: SessionSummaryRequest | undefined = ctx.latestTicker === undefined ? undefined : {
      market: ctx.MARKET,
      account: (() => {
        const account = ctx.broker.snapshot(ctx.latestTicker!.trade_price);
        return { cash: account.cash, equity: account.equity, unrealizedPnl: account.unrealizedPnl, realizedPnl: account.position.realizedPnl };
      })(),
      latestSignal: ctx.strategy.getLatestSignal(),
      signalHistory: ctx.strategy.getSignalHistory(),
      challengerStats: ctx.aiChallengerObserver.getStats()
    };
    return ctx.governedAiAssistantCall<AiSessionSummary>(
      "SESSION_SUMMARY",
      request,
      () => Object.freeze({ status: "UNAVAILABLE" as const, summary: "AI 리서치 호출 한도에 도달했습니다. 잠시 후 다시 시도하세요.", generatedAt: Date.now() }),
      () => summarizeSession({ request, client: ctx.aiSessionSummaryClient, nowMs: Date.now() })
    );
  });
  ctx.ipcMain.handle("ai:explain-regime", async () => {
    const signal = ctx.strategy.getLatestSignal();
    const request: RegimeExplanationRequest | undefined = signal?.regime === undefined ? undefined : {
      market: ctx.MARKET,
      regime: signal.regime,
      recentPrices: ctx.strategy.getHistory(),
      decision: evaluateStrategyRegime(ctx.smaStrategy.id, signal.regime)
    };
    return ctx.governedAiAssistantCall<AiRegimeExplanation>(
      "REGIME_EXPLAINER",
      request,
      () => Object.freeze({ status: "UNAVAILABLE" as const, explanation: "AI 리서치 호출 한도에 도달했습니다. 잠시 후 다시 시도하세요.", generatedAt: Date.now() }),
      () => explainRegime({ request, client: ctx.aiRegimeExplainerClient, nowMs: Date.now() })
    );
  });
  ctx.ipcMain.handle("ai:explain-risk", async () => {
    const envelope = ctx.aiCioEnvelopeSource.current();
    const request: RiskCommentaryRequest | undefined = envelope === null ? undefined : {
      market: ctx.MARKET,
      dashboardStatus: envelope.snapshot.status,
      risk: envelope.snapshot.risk,
      warnings: envelope.snapshot.warnings
    };
    return ctx.governedAiAssistantCall<AiRiskCommentary>(
      "RISK_COMMENTARY",
      request,
      () => Object.freeze({ status: "UNAVAILABLE" as const, commentary: "AI 리서치 호출 한도에 도달했습니다. 잠시 후 다시 시도하세요.", generatedAt: Date.now() }),
      () => explainRiskCommentary({ request, client: ctx.aiRiskCommentaryClient, nowMs: Date.now() })
    );
  });
}
