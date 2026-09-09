/**
 * Instrument-surface state. Pure functions with no React Native imports, so the rules the
 * design depends on are testable without a renderer.
 *
 * Two ideas carry the design (`.aipos/decisions/ADR-0020`):
 *
 *   1. A refusal is a record, not a status number. Every code resolves to a gate, a human
 *      sentence and a next action, and an unknown code still resolves to all three rather
 *      than falling through to "(403)". A bare status reaching the screen is the failure
 *      this module exists to prevent.
 *   2. A number without an age is a claim without evidence. Freshness is a stage, derived
 *      from the same 15s window the PAPER operations contract enforces, so what the screen
 *      dims is what the server would reject.
 */

export const FRESHNESS_WINDOW_MS = 15_000;

export type FreshnessStage = "FRESH" | "AGING" | "EXPIRING" | "STALE";

/** Lamps on the authority spine. Dark means nominal; only an unhappy gate lights one. */
export type LampId = "DATA" | "LINK" | "GATE";
export type LampLevel = "OFF" | "WARNING" | "DANGER";

export type RefusalSeverity = "HALT" | "REJECT";

export interface RefusalDescriptor {
  /** The machine code, echoed so it can be copied into a support request verbatim. */
  readonly code: string;
  readonly gate: LampId;
  readonly gateLabel: string;
  readonly severity: RefusalSeverity;
  /** One sentence naming what is true, in the operator's language. */
  readonly title: string;
  readonly detail: string;
  /** What happens next. Never empty: when the operator cannot act, it says who can. */
  readonly action: string;
}

interface RefusalSeed {
  readonly gate: LampId;
  readonly severity: RefusalSeverity;
  readonly title: string;
  readonly detail: string;
  readonly action: string;
}

const GATE_LABELS: Readonly<Record<LampId, string>> = Object.freeze({
  DATA: "시세 게이트",
  LINK: "세션 게이트",
  GATE: "리스크 게이트"
});

/**
 * Every refusal code the surfaces can receive. Codes are the server's own, so this table is
 * the translation layer and not a second source of truth about what is enforced.
 */
const REFUSALS: Readonly<Record<string, RefusalSeed>> = Object.freeze({
  NO_CREDENTIAL: {
    gate: "LINK", severity: "REJECT",
    title: "요청에 자격 증명이 없습니다",
    detail: "서버로 보낸 요청에 연결 토큰이 실려 있지 않았습니다.",
    action: "설정에서 1회용 연결 토큰을 입력하세요."
  },
  CREDENTIAL_REJECTED: {
    gate: "LINK", severity: "REJECT",
    title: "연결 토큰이 만료되었거나 이미 사용되었습니다",
    detail: "토큰 자체가 서버에서 거부되었습니다. 1회용 토큰은 한 번만 쓸 수 있습니다.",
    action: "새 토큰을 발급받아 다시 입력하세요."
  },
  USER_NOT_REGISTERED: {
    gate: "LINK", severity: "REJECT",
    title: "서버에 이 소유자 계정이 등록되어 있지 않습니다",
    detail: "토큰은 인증되었지만 그 토큰이 가리키는 계정이 서버에 없습니다.",
    action: "서버의 소유자 설정을 확인하세요."
  },
  USER_NOT_ACTIVE: {
    gate: "LINK", severity: "REJECT",
    title: "소유자 계정이 ACTIVE 상태가 아닙니다",
    detail: "토큰은 정상적으로 인증되었습니다. 계정이 아직 승인되지 않아 세션을 만들 수 없습니다.",
    action: "서버에서 이 계정을 승인하세요."
  },
  USER_IDENTITY_MISMATCH: {
    gate: "LINK", severity: "REJECT",
    title: "토큰의 소유자 정보가 서버에 저장된 계정과 일치하지 않습니다",
    detail: "인증은 통과했지만 토큰이 밝힌 신원과 서버 기록이 일치하지 않습니다.",
    action: "서버의 소유자 이메일 설정을 확인하세요."
  },
  MARKET_DATA_STALE: {
    gate: "DATA", severity: "REJECT",
    title: "시세가 신선도 창을 넘겼습니다",
    detail: "마지막으로 받은 시세가 너무 오래되어 이 값으로는 판단할 수 없습니다.",
    action: "재연결될 때까지 기다리세요."
  },
  PRICE_DEVIATION_LIMIT: {
    gate: "DATA", severity: "REJECT",
    title: "기준가가 시장가에서 너무 멀리 벗어났습니다",
    detail: "주문에 쓰인 가격과 관측된 시장가의 차이가 허용 범위를 넘습니다.",
    action: "가격을 다시 확인하고 주문을 새로 작성하세요."
  },
  MAX_ORDER_NOTIONAL: {
    gate: "GATE", severity: "REJECT",
    title: "주문 금액이 1회 한도를 넘습니다",
    detail: "이 주문 하나의 금액이 정책에 설정된 상한을 초과합니다.",
    action: "수량을 줄여 다시 시도하세요."
  },
  DAILY_LOSS_LIMIT: {
    gate: "GATE", severity: "REJECT",
    title: "오늘의 손실 한도에 도달했습니다",
    detail: "누적 실현 손실이 일일 상한에 닿아 신규 노출이 막혔습니다.",
    action: "오늘은 신규 주문을 만들 수 없습니다. 내일 재개됩니다."
  },
  SESSION_DRAWDOWN_LIMIT: {
    gate: "GATE", severity: "REJECT",
    title: "세션 고점 대비 하락이 한도를 넘었습니다",
    detail: "이번 세션의 최고 자산 대비 하락률이 허용 범위를 벗어났습니다.",
    action: "세션을 종료한 뒤 다시 시작하세요."
  },
  KILL_SWITCH_ACTIVE: {
    gate: "GATE", severity: "HALT",
    title: "킬스위치가 작동 중입니다",
    detail: "모든 주문 경로가 정지되었습니다. 이 상태에서는 어떤 주문도 접수되지 않습니다.",
    action: "운영자만 해제할 수 있습니다."
  }
});

/** Accepts only the shape the server actually emits, so a stray string never reaches the UI as a code. */
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Resolves a refusal to something an operator can act on.
 *
 * An unrecognised code still yields a gate, a sentence and an action. That is the whole
 * point: the screen this replaced showed "mobile session request rejected (403)." and the
 * operator spent days suspecting a token that had in fact authenticated -- a wrong token is
 * 401, and 403 means the account state refused it.
 */
export function describeRefusal(code: unknown, status?: number): RefusalDescriptor {
  const normalized = typeof code === "string" && CODE_PATTERN.test(code.trim()) ? code.trim() : undefined;
  const seed = normalized == null ? undefined : REFUSALS[normalized];
  if (seed != null && normalized != null) {
    return Object.freeze({ code: normalized, gate: seed.gate, gateLabel: GATE_LABELS[seed.gate], severity: seed.severity, title: seed.title, detail: seed.detail, action: seed.action });
  }
  // The status alone still separates the two cases the operator most needs told apart: 401 is
  // the credential being refused, 403 is the credential passing and the account state refusing.
  // Collapsing them is what sent the operator back to a token that had already authenticated.
  const credentialRefused = status === 401;
  const accountRefused = status === 403;
  return Object.freeze({
    code: normalized ?? (Number.isInteger(status) ? `HTTP_${status}` : "UNKNOWN"),
    gate: "LINK",
    gateLabel: GATE_LABELS.LINK,
    severity: "REJECT",
    title: accountRefused ? "계정 상태 때문에 요청이 거부되었습니다"
      : credentialRefused ? "연결 토큰이 만료되었거나 이미 사용되었습니다"
      : "서버가 요청을 거부했습니다",
    detail: accountRefused
      ? "자격 증명은 통과했으므로 토큰 문제는 아닙니다. 서버가 이유를 밝히지 않았습니다."
      : credentialRefused
        ? "토큰이 만료되었거나 이미 사용되었을 수 있습니다."
        : "서버가 거부 사유를 밝히지 않았습니다.",
    action: accountRefused ? "아래 기계 근거를 그대로 담아 운영자에게 문의하세요."
      : credentialRefused ? "새 토큰을 발급받아 다시 입력하세요."
      : "아래 기계 근거를 그대로 담아 운영자에게 문의하세요."
  });
}

/** Every code this module can translate, so a test can prove the table covers the server's set. */
export function knownRefusalCodes(): readonly string[] {
  return Object.freeze(Object.keys(REFUSALS).sort());
}

function ageOf(generatedAtMs: number, nowMs: number): number {
  if (!Number.isFinite(generatedAtMs) || !Number.isFinite(nowMs)) return Number.POSITIVE_INFINITY;
  return nowMs - generatedAtMs;
}

/**
 * Stages are fractions of the window rather than fixed seconds, so a caller that narrows the
 * window narrows every stage with it instead of silently keeping 15s thresholds.
 *
 * A value from the future is STALE, not FRESH: a negative age means the clocks disagree, and
 * trusting it would hide exactly the condition worth showing.
 */
export function freshnessStage(generatedAtMs: number, nowMs: number, windowMs: number = FRESHNESS_WINDOW_MS): FreshnessStage {
  if (!Number.isFinite(windowMs) || windowMs <= 0) return "STALE";
  const age = ageOf(generatedAtMs, nowMs);
  if (!Number.isFinite(age) || age < 0 || age >= windowMs) return "STALE";
  const ratio = age / windowMs;
  if (ratio < 1 / 3) return "FRESH";
  if (ratio < 0.8) return "AGING";
  return "EXPIRING";
}

/** Fraction of the window consumed, clamped to [0, 1] for a progress indicator. */
export function freshnessProgress(generatedAtMs: number, nowMs: number, windowMs: number = FRESHNESS_WINDOW_MS): number {
  if (!Number.isFinite(windowMs) || windowMs <= 0) return 1;
  const age = ageOf(generatedAtMs, nowMs);
  if (!Number.isFinite(age) || age < 0) return 1;
  return Math.min(1, Math.max(0, age / windowMs));
}

/** Human age, always paired with the value it belongs to so the two are read as one fact. */
export function describeAge(generatedAtMs: number, nowMs: number): string {
  const age = ageOf(generatedAtMs, nowMs);
  if (!Number.isFinite(age)) return "시각 불명";
  if (age < 0) return "기기 시각이 서버보다 앞섭니다";
  if (age < 1_000) return "방금";
  if (age < 60_000) return `${Math.floor(age / 1_000)}초 전`;
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}분 전`;
  return `${Math.floor(age / 3_600_000)}시간 전`;
}

/**
 * A derived value is only as fresh as its oldest input: an evaluation priced off a stale
 * quote is stale however recently it was computed.
 */
export function inheritedStage(stages: readonly FreshnessStage[]): FreshnessStage {
  const order: readonly FreshnessStage[] = ["FRESH", "AGING", "EXPIRING", "STALE"];
  let worst = 0;
  for (const stage of stages) {
    const index = order.indexOf(stage);
    if (index > worst) worst = index;
  }
  return order[worst] ?? "STALE";
}

/**
 * The one refusal the client raises on its own: no secure session has been established yet,
 * so nothing has been sent for a server to refuse. It is kept out of the code table above
 * because that table translates the SERVER's vocabulary, and mixing a client-originated code
 * into it would make the table stop describing what the server enforces.
 */
export function sessionNotLinkedRefusal(detail?: string): RefusalDescriptor {
  return Object.freeze({
    code: "SESSION_NOT_LINKED",
    gate: "LINK",
    gateLabel: GATE_LABELS.LINK,
    severity: "REJECT",
    title: "PAPER 서버와 연결되어 있지 않습니다",
    detail: detail?.trim() ? detail.trim() : "보안 세션이 없어 서버 데이터를 읽을 수 없습니다.",
    action: "설정에서 1회용 연결 토큰으로 연결하세요."
  });
}

/** Lamp levels for the spine. Absent refusals leave every lamp dark, which is the nominal read. */
export function lampLevels(refusals: readonly RefusalDescriptor[]): Readonly<Record<LampId, LampLevel>> {
  const levels: Record<LampId, LampLevel> = { DATA: "OFF", LINK: "OFF", GATE: "OFF" };
  for (const refusal of refusals) {
    const next: LampLevel = refusal.severity === "HALT" ? "DANGER" : levels[refusal.gate] === "DANGER" ? "DANGER" : "WARNING";
    levels[refusal.gate] = next;
  }
  return Object.freeze(levels);
}
