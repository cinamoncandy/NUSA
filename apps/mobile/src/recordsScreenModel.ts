import type { MoreDestination } from "./navigationContract";

/**
 * "기록" (Records) tab for the calm redesign: the former More menu, regrouped records-first.
 * Every More destination appears exactly once; LIVE never appears here.
 */
export interface RecordsEntry { readonly destination: MoreDestination; readonly title: string; readonly hint: string }
export interface RecordsGroup { readonly title: string; readonly items: readonly RecordsEntry[] }

const e = (destination: MoreDestination, title: string, hint: string): RecordsEntry => Object.freeze({ destination, title, hint });

export const RECORDS_GROUPS: readonly RecordsGroup[] = Object.freeze([
  Object.freeze({ title: "일어난 일", items: Object.freeze([
    e("OrderHistory", "주문 기록", "모의 주문과 체결, 수수료까지"),
    e("PaperEvidence", "판단 기록", "왜 사고, 팔고, 기다렸는지"),
    e("Performance", "성과", "수익과 손실, 시작 대비"),
    e("Portfolio", "자산", "현금과 보유 코인"),
  ]) }),
  Object.freeze({ title: "판단 규칙", items: Object.freeze([
    e("Strategies", "전략", "어떤 규칙으로 판단하는지"),
    e("Risk", "위험 한도", "언제 멈추는지"),
  ]) }),
  Object.freeze({ title: "앱", items: Object.freeze([
    e("Notifications", "알림", "받은 알림"),
    e("SystemStatus", "서버 상태", "연결과 응답"),
    e("Settings", "설정", "연결과 앱 설정"),
    e("Help", "도움말", "용어와 사용법"),
  ]) }),
]);

export function recordsDestinations(): readonly MoreDestination[] {
  return RECORDS_GROUPS.flatMap((group) => group.items.map((item) => item.destination));
}
