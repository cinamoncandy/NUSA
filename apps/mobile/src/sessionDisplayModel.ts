/**
 * What the screen shows for the PAPER session. Import-free so tests can transpile it alone.
 *
 * Every foreground resume re-proves the device session (paperConnectionSession clears the
 * process-local VERIFIED flag on purpose). That usually takes a second or two, so flashing
 * 재연결 중 on every app open made a healthy connection look broken. A session that was verified
 * just before the resume keeps its verified look for a short grace window; past the window, or if
 * the proof fails, the real state shows. App launch counts like a resume (a paired device restores
 * silently on cold start). Presentation only: no credential, transport or trading
 * decision reads this, and the safety line keeps the real state (it only words it 확인 중).
 */
export type SessionState = "NOT_CONFIGURED" | "VERIFIED" | "RECOVERING" | "RECOVERY_REQUIRED";
export const RESUME_GRACE_MS = 5_000;

export function displaySessionState(state: SessionState, verifiedBeforeResume: boolean, recoveringForMs: number): SessionState {
  if (state === "RECOVERING" && verifiedBeforeResume && recoveringForMs < RESUME_GRACE_MS) return "VERIFIED";
  return state;
}

/**
 * The not-configured notice inside the resume grace. While a verified session re-proves, the
 * operations projection reads NOT_CONFIGURED only because the session is momentarily unverified, so
 * "PAPER 서버 연결 필요" would contradict the 확인 중 safety line. It is hidden only during the grace;
 * read failures (UNAVAILABLE) are a different input and are never hidden.
 */
export function graceNotConfigured(notConfigured: string | null, resuming: boolean): string | null {
  return resuming ? null : notConfigured;
}
