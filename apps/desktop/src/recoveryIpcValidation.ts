/**
 * Exact-allowlist payload validators for the `recovery:*` IPC channels (WO-0034-A4H).
 *
 * Same posture as the `shadow:*` validators: every parser rejects extra fields, arrays,
 * null, and malformed values rather than coercing them, so a renderer cannot smuggle an
 * approval object, a fingerprint, or a reviewer identity through these channels.
 *
 * The approval channel deliberately takes NO caller-supplied fingerprint, reviewer, or
 * timestamp. The main process derives all three from state it already holds. A renderer that
 * could name the fingerprint it is approving could approve a comparison that never ran.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function parseEmpty(input: unknown, channel: string): Readonly<Record<string, never>> {
  if (input == null) return Object.freeze({});
  if (!isPlainObject(input) || Object.keys(input).length !== 0) throw new Error(`invalid ${channel} input`);
  return Object.freeze({});
}

export function parseRecoveryStatusIpc(input: unknown): Readonly<Record<string, never>> {
  return parseEmpty(input, "recovery:status");
}

export function parseRecoveryReconcileIpc(input: unknown): Readonly<Record<string, never>> {
  return parseEmpty(input, "recovery:reconcile");
}

/**
 * The owner-review payload carries one thing: that a human clicked. It is validated as the
 * exact literal `true` rather than any truthy value, so a stray string or object cannot read
 * as consent.
 */
export function parseRecoveryOwnerReviewIpc(input: unknown): Readonly<{ confirmed: true }> {
  if (!isPlainObject(input)) throw new Error("invalid recovery:owner-review input");
  if (Object.keys(input).sort().join(",") !== "confirmed") throw new Error("invalid recovery:owner-review input");
  if (input.confirmed !== true) throw new Error("recovery:owner-review requires an explicit owner confirmation");
  return Object.freeze({ confirmed: true });
}

export function parseRecoveryCompleteIpc(input: unknown): Readonly<Record<string, never>> {
  return parseEmpty(input, "recovery:complete");
}
