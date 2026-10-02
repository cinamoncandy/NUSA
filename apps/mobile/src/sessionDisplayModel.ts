/**
 * What the screen shows for the PAPER session. Import-free so tests can transpile it alone.
 *
 * Every foreground resume re-proves the device session (paperConnectionSession clears the
 * process-local VERIFIED flag on purpose). That usually takes a second or two, so flashing
 * 재연결 중 on every app open made a healthy connection look broken. A session that was verified
 * just before the resume keeps its verified look for a short grace window; past the window, or if
 * the proof fails, the real state shows. Presentation only: no credential, transport or trading
 * decision reads this.
 */
export type SessionState = "NOT_CONFIGURED" | "VERIFIED" | "RECOVERING" | "RECOVERY_REQUIRED";
export const RESUME_GRACE_MS = 5_000;

export function displaySessionState(state: SessionState, verifiedBeforeResume: boolean, recoveringForMs: number): SessionState {
  if (state === "RECOVERING" && verifiedBeforeResume && recoveringForMs < RESUME_GRACE_MS) return "VERIFIED";
  return state;
}
