/**
 * Real learning-loop numbers for the 학습 tab. The server copies measured integers from the closed-learning status
 * (PersonalPaperLearningLoop); this file turns them into drawable rows. Nothing is invented: a value that is missing, not an
 * integer, out of range or inconsistent with its partner is dropped and its panel says the server has not sent it.
 */
export interface WaterfallRow {
  readonly label: string;
  /** Basis points per trade, signed. */
  readonly bp: number;
  readonly kind: "GAIN" | "LOSS" | "COST" | "RESULT";
}

export interface CostWallPanel {
  readonly rows: readonly WaterfallRow[];
  readonly trades: number;
  readonly winRatePercent: number | null;
  /** Largest absolute value, for scaling the bars. */
  readonly scaleBp: number;
  readonly summary: string;
}

export interface PaperResultPanel {
  readonly periods: number | null;
  readonly netBp: number | null;
  readonly excessBp: number | null;
  readonly scaleBp: number;
  readonly summary: string;
}

export interface OverfitPanel {
  readonly discoveryPasses: number;
  readonly holdoutPasses: number;
  readonly configurations: number | null;
  readonly experiments: number | null;
  readonly overfitRatePercent: number | null;
  readonly summary: string;
}

export interface LearningLoopPanels {
  readonly cost: CostWallPanel | null;
  readonly paper: PaperResultPanel | null;
  readonly overfit: OverfitPanel | null;
}

const nonNeg = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
const signed = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && Math.abs(v) <= 10_000_000 ? v : null);
const one = (n: number): string => n.toFixed(1);
const sign = (n: number): string => (n > 0 ? `+${one(n)}` : one(n));

export function buildLearningLoopPanels(raw: unknown): LearningLoopPanels {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return Object.freeze({ cost: null, paper: null, overfit: null });
  const r = raw as Record<string, unknown>;

  let cost: CostWallPanel | null = null;
  const trades = nonNeg(r.shadowTrades); const wins = nonNeg(r.shadowWins); const gain = nonNeg(r.shadowGrossGainBp); const loss = nonNeg(r.shadowGrossLossBp); const fee = nonNeg(r.shadowFeeBp);
  if (trades != null && trades > 0 && gain != null && loss != null && fee != null && (wins == null || wins <= trades)) {
    const perGain = gain / trades; const perLoss = loss / trades; const perFee = fee / trades;
    const result = perGain - perLoss - perFee;
    const scale = Math.max(perGain, perLoss, perFee, Math.abs(result), 1);
    const gross = perGain - perLoss;
    cost = Object.freeze({
      trades, winRatePercent: wins == null ? null : (wins / trades) * 100, scaleBp: scale,
      rows: Object.freeze([
        Object.freeze({ label: "이긴 거래 평균 이익", bp: perGain, kind: "GAIN" as const }),
        Object.freeze({ label: "진 거래 평균 손실", bp: -perLoss, kind: "LOSS" as const }),
        Object.freeze({ label: "수수료", bp: -perFee, kind: "COST" as const }),
        Object.freeze({ label: "거래당 순결과", bp: result, kind: "RESULT" as const }),
      ]),
      summary: gross <= 0 ? `수수료를 빼기 전에도 거래당 ${sign(gross)}bp예요. 수수료까지 내면 ${sign(result)}bp예요.` : `수수료 전 거래당 ${sign(gross)}bp, 수수료 ${one(perFee)}bp를 내면 ${sign(result)}bp예요.`,
    });
  }

  let paper: PaperResultPanel | null = null;
  const net = signed(r.paperNetBp); const excess = signed(r.paperExcessBp); const periods = nonNeg(r.paperPeriodsConsumed);
  if (net != null || excess != null) {
    const scale = Math.max(Math.abs(net ?? 0), Math.abs(excess ?? 0), 1);
    const parts: string[] = [];
    if (net != null) parts.push(`모의투자 순결과 ${net > 0 ? "+" : ""}${net}bp`);
    if (excess != null) parts.push(`전부 사기 대비 ${excess > 0 ? "+" : ""}${excess}bp`);
    paper = Object.freeze({ periods, netBp: net, excessBp: excess, scaleBp: scale, summary: `${periods != null ? `${periods}구간 동안 ` : ""}${parts.join(", ")}예요.` });
  }

  let overfit: OverfitPanel | null = null;
  const disc = nonNeg(r.discoveryPasses); const hold = nonNeg(r.holdoutPasses); const cfg = nonNeg(r.configurations); const exp = nonNeg(r.experiments);
  const rate = nonNeg(r.overfitRatePercent);
  if (disc != null && hold != null && hold <= disc && (cfg == null || disc <= cfg) && (rate == null || rate <= 100)) {
    overfit = Object.freeze({
      discoveryPasses: disc, holdoutPasses: hold, configurations: cfg, experiments: exp, overfitRatePercent: rate,
      summary: disc === 0 ? "1차를 통과한 전략이 아직 없어요." : hold === 0 ? `1차를 통과한 ${disc}개가 모두 새 데이터에서 탈락했어요.` : `1차 통과 ${disc}개 중 ${hold}개가 새 데이터에서도 통과했어요.`,
    });
  }
  return Object.freeze({ cost, paper, overfit });
}
