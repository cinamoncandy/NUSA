/**
 * Exact-allowlist payload validators for the `safety:kill-switch-*` IPC channels (WO-0019).
 *
 * `parseKillSwitchReleaseIpc` re-validates the confirmation phrase itself, in the main
 * process, rather than trusting a `confirmed: true` boolean the renderer computed. A renderer
 * that could satisfy this channel with a bare boolean could release the kill switch from a
 * bug or a compromised renderer without anyone having typed anything. Activation (re-arming
 * to the safe state) takes no confirmation phrase -- only deactivation needs the friction.
 */
const RELEASE_CONFIRMATION_PHRASE = "PAPER TRADING ENABLE";
const MAX_REASON_LENGTH = 500;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function requireReason(value: unknown): string {
  if (typeof value !== "string") throw new Error("kill switch reason is required");
  const reason = value.trim();
  if (reason.length === 0 || reason.length > MAX_REASON_LENGTH) throw new Error("kill switch reason is invalid");
  return reason;
}

export function parseKillSwitchReleaseIpc(input: unknown): Readonly<{ confirmationText: string; reason: string }> {
  if (!isPlainObject(input)) throw new Error("invalid safety:kill-switch-release input");
  if (Object.keys(input).sort().join(",") !== "confirmationText,reason") throw new Error("invalid safety:kill-switch-release input");
  if (input.confirmationText !== RELEASE_CONFIRMATION_PHRASE) throw new Error(`kill switch release requires the exact confirmation phrase "${RELEASE_CONFIRMATION_PHRASE}"`);
  const reason = requireReason(input.reason);
  return Object.freeze({ confirmationText: RELEASE_CONFIRMATION_PHRASE, reason });
}

export function parseKillSwitchActivateIpc(input: unknown): Readonly<{ reason: string }> {
  if (!isPlainObject(input)) throw new Error("invalid safety:kill-switch-activate input");
  if (Object.keys(input).sort().join(",") !== "reason") throw new Error("invalid safety:kill-switch-activate input");
  const reason = requireReason(input.reason);
  return Object.freeze({ reason });
}
