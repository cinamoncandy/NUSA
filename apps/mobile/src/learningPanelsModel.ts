/**
 * Display-only model for the "학습" studies timeline. No I/O and no authority. The list mirrors the frozen pre-registrations
 * (docs/research-ledger): dates are the designs' first verdict print times, nothing here is a measurement.
 */
const DAY = 86_400_000;

export interface RegisteredStudy {
  readonly id: string;
  readonly name: string;
  readonly verdictAtMs: number;
  readonly frozen: boolean;
}

/** Verdict times are the first print times of the registered designs (UTC). */
export const REGISTERED_STUDIES: ReadonlyArray<RegisteredStudy> = Object.freeze([
  Object.freeze({ id: "호가", name: "호가 연구(ML)", verdictAtMs: Date.parse("2026-10-29T02:00:00Z"), frozen: false }),
  Object.freeze({ id: "S2~S4", name: "긴 보유 · 지정가 · 일간 횡단면", verdictAtMs: Date.parse("2026-12-05T02:00:00Z"), frozen: true }),
  Object.freeze({ id: "S5", name: "호가 불균형 15분 신호", verdictAtMs: Date.parse("2026-12-20T02:00:00Z"), frozen: true }),
]);

export interface StudyRow {
  readonly id: string;
  readonly name: string;
  readonly dateLabel: string;
  readonly status: string;
  readonly tone: "ORDER" | "ATTENTION" | "MUTED";
  readonly next: boolean;
}

const pad = (n: number): string => String(n).padStart(2, "0");

export function buildStudyTimeline(nowMs: number, studies: ReadonlyArray<RegisteredStudy> = REGISTERED_STUDIES): ReadonlyArray<StudyRow> {
  const sorted = [...studies].sort((a, b) => a.verdictAtMs - b.verdictAtMs);
  const nextIndex = sorted.findIndex((s) => s.verdictAtMs > nowMs);
  return Object.freeze(sorted.map((s, i) => {
    const d = new Date(s.verdictAtMs);
    const left = Math.ceil((s.verdictAtMs - nowMs) / DAY);
    const dateLabel = `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const past = s.verdictAtMs <= nowMs;
    const status = past ? "판정 시점이 지났어요 · 결과를 확인하세요" : `${s.frozen ? "설계 고정됨" : "결과 대기"} · ${left}일 남음`;
    return Object.freeze({ id: s.id, name: s.name, dateLabel, status, tone: past ? "ATTENTION" as const : s.frozen ? "MUTED" as const : "ATTENTION" as const, next: i === nextIndex });
  }));
}
