/**
 * Maps real NUSA state to the Intelligence Field shown on HOME.
 *
 * The field only ever reflects canonical state: which subsystems are lit, which one needs
 * attention, and the one-line reading. It never invents activity, signals or PnL, and it holds
 * no authority -- it is a projection of values the app already receives.
 */
export type FieldSubsystem = "market" | "axiom" | "paper" | "governance" | "risk";
export type FieldTone = "dim" | "amber" | "blue" | "green" | "red";

export interface IntelligenceFieldInput {
  readonly checking: boolean;
  readonly disconnected: boolean;
  readonly recovering: boolean;
  readonly haltActive: boolean;
  readonly feedStale: boolean;
  readonly readyForPaperOperations: boolean;
  readonly decisionCount: number | null;
  readonly paperOrderCount: number | null;
}

export interface IntelligenceFieldModel {
  readonly phase: "LAUNCH" | "AUTHENTICATION" | "RECOVERING" | "CONNECTED" | "ATTENTION" | "HALTED";
  readonly statusWord: string;
  readonly tone: FieldTone;
  readonly headline: string;
  readonly detail: string;
  readonly lit: readonly FieldSubsystem[];
  readonly focus: FieldSubsystem | null;
  readonly states: Readonly<Partial<Record<FieldSubsystem, string>>>;
  readonly coreLevel: number;
}

const ALL: readonly FieldSubsystem[] = ["governance", "market", "risk", "axiom", "paper"];

export function buildIntelligenceField(input: IntelligenceFieldInput): IntelligenceFieldModel {
  if (input.checking) {
    return freeze({ phase: "LAUNCH", statusWord: "STARTING", tone: "dim", headline: "NUSA를 깨우는 중", detail: "로컬 상태를 확인합니다.", lit: [], focus: null, states: {}, coreLevel: 0.25 });
  }
  if (input.disconnected && input.recovering) {
    return freeze({ phase: "RECOVERING", statusWord: "RECOVERING", tone: "amber", headline: "서버 세션 재연결", detail: "기기 인증은 유지됩니다. 조작 없이 자동으로 복구합니다.", lit: ["governance"], focus: null, states: { governance: "VERIFIED", market: "SYNCING" }, coreLevel: 0.55 });
  }
  if (input.disconnected) {
    return freeze({ phase: "AUTHENTICATION", statusWord: "OFFLINE", tone: "amber", headline: "PAPER 서버 연결 필요", detail: "설정에서 서버 연결을 확인해 주세요.", lit: ["governance"], focus: "governance", states: { governance: "REQUIRED" }, coreLevel: 0.35 });
  }
  if (input.haltActive) {
    return freeze({ phase: "HALTED", statusWord: "HALTED", tone: "red", headline: "안전 정지 중", detail: "리스크 경계가 새 판단을 멈췄습니다. 원장은 보존됩니다.", lit: ALL, focus: "risk", states: { governance: "ONLINE", market: "ONLINE", risk: "HALT", axiom: "PAUSED", paper: "PAUSED" }, coreLevel: 0.7 });
  }
  if (input.feedStale) {
    return freeze({ phase: "ATTENTION", statusWord: "ONLINE", tone: "green", headline: "시장 데이터가 늦습니다", detail: "신선한 시세가 들어올 때까지 판단을 보류합니다.", lit: ALL, focus: "market", states: { governance: "ONLINE", market: "STALE", risk: "MONITORING", axiom: "WAITING", paper: "IDLE" }, coreLevel: 0.85 });
  }
  const deciding = (input.decisionCount ?? 0) > 0;
  const noOrders = input.paperOrderCount === 0;
  if (input.readyForPaperOperations && deciding && noOrders) {
    return freeze({ phase: "ATTENTION", statusWord: "ONLINE", tone: "green", headline: "판단은 돌지만\n실행이 없습니다", detail: "AXIOM이 실행할 승인 전략을 찾지 못했습니다.", lit: ALL, focus: "axiom", states: { governance: "ONLINE", market: "ONLINE", risk: "MONITORING", axiom: "NO STRATEGY", paper: "IDLE" }, coreLevel: 1 });
  }
  return freeze({ phase: "CONNECTED", statusWord: "ONLINE", tone: "green", headline: "시스템이 정상 작동 중", detail: "모든 서브시스템이 연결됐습니다.", lit: ALL, focus: null, states: { governance: "ONLINE", market: "ONLINE", risk: "MONITORING", axiom: "ONLINE", paper: input.readyForPaperOperations ? "ACTIVE" : "OBSERVING" }, coreLevel: 1 });
}

function freeze(model: IntelligenceFieldModel): IntelligenceFieldModel {
  return Object.freeze({ ...model, lit: Object.freeze([...model.lit]), states: Object.freeze({ ...model.states }) });
}
