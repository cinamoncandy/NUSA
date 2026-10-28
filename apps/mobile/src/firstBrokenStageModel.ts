/**
 * Display-only: where the PAPER trading flow first stops, in plain Korean, from the heartbeat fields the app already receives
 * (market event time, event and decision counts, buy signals, orders, fills). It adds no data and no authority. Counts are since the
 * runtime started, so a stage is only called broken when the evidence is a contradiction (signals but no orders, orders but no fills, a stale feed),
 * never just because a count is still zero. A missing or malformed field makes that stage UNKNOWN and nothing is claimed.
 */
export const FIRST_BROKEN_MARKET_STALE_MS = 5 * 60_000;
/** A silent feed or decision count is only called broken after the runtime has had this long to produce one. */
export const FIRST_BROKEN_WARMUP_MS = 5 * 60_000;

export type BrokenStageId = "MARKET" | "DECISION" | "ORDER" | "FILL";
export interface BrokenStage { readonly stage: BrokenStageId; readonly label: string; readonly text: string }

export interface FirstBrokenInput {
  readonly startedAt?: unknown;
  readonly lastHeartbeatAt?: unknown;
  readonly lastMarketEventAt?: unknown;
  readonly eventCount?: unknown;
  readonly decisionCount?: unknown;
  readonly buySignalCount?: unknown;
  readonly paperOrderCount?: unknown;
  readonly paperFillCount?: unknown;
}

type Status = "PASS" | "BROKEN" | "UNKNOWN";
const count = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);
const time = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
const n = (value: number): string => value.toLocaleString("en-US");

/** The first stage that is not passing with evidence, or null when everything passes or the evidence is missing. */
export function firstBrokenStage(input: FirstBrokenInput | null | undefined, now: number): BrokenStage | null {
  if (input == null || !Number.isFinite(now)) return null;
  const startedAt = time(input.startedAt);
  const heartbeatAt = time(input.lastHeartbeatAt);
  const warm = startedAt != null && heartbeatAt != null && heartbeatAt - startedAt >= FIRST_BROKEN_WARMUP_MS;
  const events = count(input.eventCount);
  const decisions = count(input.decisionCount);
  const buys = count(input.buySignalCount);
  const orders = count(input.paperOrderCount);
  const fills = count(input.paperFillCount);
  const noMarketYet = input.lastMarketEventAt === null;
  const lastMarket = time(input.lastMarketEventAt);

  const stages: readonly (readonly [BrokenStage, Status])[] = [
    [{ stage: "MARKET", label: "시세", text: "시세가 5분 넘게 들어오지 않아요" },
      noMarketYet ? (warm ? "BROKEN" : "UNKNOWN") : lastMarket == null ? "UNKNOWN" : now - lastMarket > FIRST_BROKEN_MARKET_STALE_MS ? "BROKEN" : "PASS"],
    [{ stage: "DECISION", label: "판단", text: "시세는 들어오는데 판단을 하지 않아요" },
      events == null || decisions == null ? "UNKNOWN" : events > 0 && decisions === 0 ? (warm ? "BROKEN" : "UNKNOWN") : "PASS"],
    [{ stage: "ORDER", label: "주문", text: buys != null && orders != null ? `매수 신호는 ${n(buys)}번 있었는데 주문은 ${n(orders)}번이에요` : "" },
      buys == null || orders == null ? "UNKNOWN" : buys > 0 && orders === 0 ? "BROKEN" : "PASS"],
    [{ stage: "FILL", label: "체결", text: orders != null && fills != null ? `주문 ${n(orders)}번 중 체결이 아직 없어요` : "" },
      orders == null || fills == null ? "UNKNOWN" : orders > 0 && fills === 0 ? "BROKEN" : "PASS"],
  ];
  const first = stages.find(([, status]) => status !== "PASS");
  return first !== undefined && first[1] === "BROKEN" ? first[0] : null;
}
