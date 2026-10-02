/**
 * The one-line safety status shown at the top of every tab. Import-free so tests can transpile it.
 * It never claims more than it knows: only a verified session whose PAPER data loaded healthy reads 안전.
 */
export type SafetyTone = "ok" | "wait" | "act" | "halt";
export interface SafetyLineInput {
  readonly sessionState: "NOT_CONFIGURED" | "VERIFIED" | "RECOVERING" | "RECOVERY_REQUIRED";
  readonly runtimeHalted: boolean;
  /** The verified session could not load PAPER data, or the server reports it is not healthy. */
  readonly dataUnconfirmed?: boolean;
}
export interface SafetyLine { readonly tone: SafetyTone; readonly word: string; readonly detail: string }

const BOUNDARY = "PAPER 전용 · LIVE 잠김";

export function buildSafetyLine(input: SafetyLineInput): SafetyLine {
  if (input.runtimeHalted) return Object.freeze({ tone: "halt", word: "정지됨", detail: BOUNDARY });
  if (input.sessionState === "VERIFIED" && input.dataUnconfirmed === true) return Object.freeze({ tone: "act", word: "확인 필요", detail: BOUNDARY });
  if (input.sessionState === "VERIFIED") return Object.freeze({ tone: "ok", word: "안전", detail: BOUNDARY });
  if (input.sessionState === "RECOVERING") return Object.freeze({ tone: "wait", word: "재연결 중", detail: BOUNDARY });
  if (input.sessionState === "RECOVERY_REQUIRED") return Object.freeze({ tone: "act", word: "연결 필요", detail: BOUNDARY });
  return Object.freeze({ tone: "act", word: "서버 미설정", detail: BOUNDARY });
}
