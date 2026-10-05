/**
 * One-line, read-only progress of the research candle collection: how much 1-minute history exists for the
 * research market versus what the first experiment needs. Display only. It states what the server reported:
 * it never claims an experiment ran, and missing or unusable input reads as "not reported".
 */
export interface ResearchProgressInput {
  readonly market?: unknown;
  readonly candleCount?: unknown;
  readonly requiredCandles?: unknown;
  readonly firstCloseMs?: unknown;
  readonly lastCloseMs?: unknown;
  readonly observedAt?: unknown;
}

export interface ResearchProgressLine {
  readonly value: string;
  readonly detail: string | null;
  readonly tone: "ok" | "warn" | "muted";
}

const DAY_MINUTES = 1_440;
const STALE_COLLECTION_MS = 90 * 60_000;
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
const days = (minutes: number): string => (Math.round((minutes / DAY_MINUTES) * 10) / 10).toString();

function ago(ms: number): string {
  if (ms < 60_000) return "방금";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}분 전`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}시간 전`;
  return `${Math.floor(ms / 86_400_000)}일 전`;
}

/** Why the server sent no collection progress (heartbeat.researchCollectionState); anything else reads as not reported. */
function unavailableLine(state: unknown): ResearchProgressLine {
  if (state === "DISABLED") return { value: "리서치 꺼짐", detail: "서버에서 연속 리서치 실험이 켜져 있지 않아 학습 데이터를 모으지 않습니다", tone: "warn" };
  if (state === "INVALID") return { value: "리서치 설정 오류", detail: "서버의 리서치 설정 값이 올바르지 않아 꺼져 있습니다", tone: "warn" };
  if (state === "UNAVAILABLE") return { value: "수집 현황 읽기 실패", detail: "리서치는 켜져 있으나 수집된 캔들 저장소를 읽지 못했습니다", tone: "warn" };
  return { value: "집계 미수신", detail: null, tone: "muted" };
}

export function buildResearchProgressLine(input: ResearchProgressInput | null | undefined, nowMs: number, unavailableState?: unknown): ResearchProgressLine {
  const market = typeof input?.market === "string" && /^KRW-[A-Z0-9-]{1,16}$/.test(input.market) ? input.market : null;
  const count = int(input?.candleCount);
  const required = int(input?.requiredCandles);
  if (input == null || market == null || count == null || required == null || required < 1) return unavailableLine(input == null ? unavailableState : undefined);
  const pct = Math.min(100, Math.floor((count / required) * 100));
  const head = `${market} ${days(count)}/${days(required)}일치 (${pct}%)`;
  const last = int(input.lastCloseMs);
  const first = int(input.firstCloseMs);
  const lastAgo = last == null || !Number.isFinite(nowMs) ? null : Math.max(0, nowMs - last);
  const parts: string[] = [];
  const stale = lastAgo != null && lastAgo > STALE_COLLECTION_MS;
  if (stale) parts.push("수집이 멈췄을 수 있음");
  if (lastAgo != null) parts.push(`마지막 수집 ${ago(lastAgo)}`);
  else parts.push("수집 시각 미확인");
  if (count >= required) parts.push("필요량 충족");
  else parts.push(`첫 실험까지 약 ${days(required - count)}일`);
  if (first != null && last != null && last > first) {
    const expected = Math.floor((last - first) / 60_000) + 1;
    const missing = expected > 0 ? Math.max(0, Math.round((1 - count / expected) * 100)) : 0;
    if (missing >= 1) parts.push(`빈 구간 ${missing}%`);
  }
  return { value: head, detail: parts.join(" · "), tone: stale ? "warn" : "ok" };
}
