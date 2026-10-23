/**
 * Display-only models for the three "학습" panels: registered studies, the cost wall and the decision bars.
 * No I/O and no authority. The studies list mirrors the frozen pre-registrations (docs/research-ledger); the cost wall and the decision bars
 * are explanatory shapes, and every one of them says so on screen unless real input is given.
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

export interface CostWallBar { readonly label: string; readonly bp: number }
export interface CostWallModel {
  readonly wallBp: number;
  readonly maxBp: number;
  readonly bars: ReadonlyArray<CostWallBar & { readonly over: boolean; readonly ratio: number }>;
  readonly example: boolean;
}

/** Round trip: 5 bp fee + 5 bp slippage on each side. */
export const COST_WALL_BP = 20;
const EXAMPLE_BARS: ReadonlyArray<CostWallBar> = Object.freeze([
  { label: "후보 A", bp: 6 }, { label: "후보 B", bp: 11 }, { label: "후보 C", bp: 14 }, { label: "후보 D", bp: 9 }, { label: "신호 효과?", bp: 24 },
]);

export function buildCostWall(input?: ReadonlyArray<CostWallBar> | null): CostWallModel {
  const real = input != null && input.length > 0 && input.every((b) => Number.isFinite(b.bp) && b.bp >= 0 && b.label.length > 0);
  const source = real ? input as ReadonlyArray<CostWallBar> : EXAMPLE_BARS;
  const maxBp = Math.max(COST_WALL_BP * 1.5, ...source.map((b) => b.bp));
  return Object.freeze({ wallBp: COST_WALL_BP, maxBp, example: !real, bars: Object.freeze(source.map((b) => Object.freeze({ label: b.label, bp: b.bp, over: b.bp > COST_WALL_BP, ratio: Math.min(1, b.bp / maxBp) }))) });
}

export interface DecisionBarsModel {
  readonly bars: ReadonlyArray<{ readonly ratio: number; readonly recent: boolean }>;
  readonly total: number;
  readonly example: boolean;
}

/** Hourly decision counts (oldest first). Without real input a fixed example shape is shown and labelled as such. */
export function buildDecisionBars(hourly?: ReadonlyArray<number> | null): DecisionBarsModel {
  const real = hourly != null && hourly.length >= 2 && hourly.every((v) => Number.isFinite(v) && v >= 0);
  const values = real ? (hourly as ReadonlyArray<number>).slice(-24) : Array.from({ length: 24 }, (_, i) => 40 + Math.round(Math.abs(Math.sin(i * 1.7 + 0.6)) * 360));
  const max = Math.max(1, ...values);
  return Object.freeze({
    example: !real, total: values.reduce((s, v) => s + v, 0),
    bars: Object.freeze(values.map((v, i) => Object.freeze({ ratio: Math.max(0.04, v / max), recent: i >= values.length - 4 }))),
  });
}
