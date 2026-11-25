import type { PersonalPaperStudyScheduleEntry } from "../../../packages/contracts/src/personalPaperOperations";

/**
 * Display only (docs/NUSA_MOBILE_UIUX_V6_CALM_FIELD.md phase 3): the registered research studies and the first time each prints a verdict
 * (UTC). The host serves this list in the heartbeat so the phone app does not need a build to show a new study. Nothing here is a
 * measurement, an authority or a setting of any study; the dates come from the frozen pre-registrations in docs/. Where a pre-registration
 * gives only the earliest run time (cross-market, third order-book run), the row says so in its name; the first real print can be later.
 */
const at = (iso: string): number => Date.parse(iso);

export const RESEARCH_STUDY_SCHEDULE: readonly PersonalPaperStudyScheduleEntry[] = Object.freeze([
  Object.freeze({ id: "호가", name: "호가 연구(ML)", verdictAtMs: at("2026-10-29T02:00:00Z"), frozen: false, resultStudyId: "ML_ORDERBOOK_60M_20261029" }),
  Object.freeze({ id: "호가2", name: "호가 연구 2차(ML)", verdictAtMs: at("2026-11-18T02:00:00Z"), frozen: true, resultStudyId: "ML_ORDERBOOK_60M_20261111" }),
  Object.freeze({ id: "체결흐름2", name: "체결흐름 연구 2차", verdictAtMs: at("2026-11-29T00:16:00Z"), frozen: true }),
  Object.freeze({ id: "S2~S4", name: "긴 보유 · 지정가 · 일간 횡단면", verdictAtMs: at("2026-12-05T02:00:00Z"), frozen: true }),
  Object.freeze({ id: "교차시장", name: "교차시장 모멘텀 · 12/10 이후 실행", verdictAtMs: at("2026-12-10T00:30:00Z"), frozen: true }),
  Object.freeze({ id: "호가3", name: "호가 연구 3차(ML) · 12/10 이후", verdictAtMs: at("2026-12-10T02:00:00Z"), frozen: true, resultStudyId: "ML_ORDERBOOK_60M_20261126" }),
  Object.freeze({ id: "S5", name: "호가 불균형 15분 신호", verdictAtMs: at("2026-12-20T02:00:00Z"), frozen: true }),
  Object.freeze({ id: "RET48", name: "RET48 전진 확인(최종 판정)", verdictAtMs: at("2028-03-31T00:00:00Z"), frozen: true }),
]);
