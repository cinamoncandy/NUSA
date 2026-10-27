/**
 * Which coin(s) the PAPER runtime trades, shown on HOME. Display only: it states what the server reported and
 * never guesses. The research market is shown only when it differs from what is traded, because then the
 * learning is about another coin and the owner should see that at a glance.
 */
export interface TradedCoinInput {
  readonly tradedMarkets?: unknown;
  readonly researchMarket?: unknown;
  readonly positionMarket?: unknown;
  readonly positionQuantity?: unknown;
}

export interface TradedCoinLine {
  readonly value: string;
  readonly detail: string | null;
  readonly tone: "ok" | "warn" | "muted";
}

const MARKET = /^KRW-[A-Z0-9-]{1,16}$/;
const market = (v: unknown): string | null => (typeof v === "string" && MARKET.test(v) ? v : null);
export const coinOf = (m: string): string => m.slice(4);

export function buildTradedCoinLine(input: TradedCoinInput | null | undefined): TradedCoinLine {
  const raw = input?.tradedMarkets;
  const traded = Array.isArray(raw) && raw.length >= 1 && raw.length <= 5 ? raw.map(market) : null;
  if (traded == null || traded.some((m) => m == null)) return { value: "집계 미수신", detail: null, tone: "muted" };
  const list = traded as string[];
  const parts: string[] = [];
  const position = market(input?.positionMarket);
  const quantity = typeof input?.positionQuantity === "number" && Number.isFinite(input.positionQuantity) ? input.positionQuantity : 0;
  if (position != null && quantity > 0) parts.push(`보유 중: ${coinOf(position)}`);
  const research = market(input?.researchMarket);
  let tone: TradedCoinLine["tone"] = "ok";
  if (research != null && !list.includes(research)) {
    parts.push(`학습 코인은 ${coinOf(research)} (거래 코인과 다름)`);
    tone = "warn";
  }
  return { value: list.map(coinOf).join(" · "), detail: parts.length === 0 ? null : parts.join(" · "), tone };
}
