/**
 * Input validation for the productization IPC channels (WO-0034-A4O).
 *
 * The renderer is treated as untrusted here for the same reason every other channel in this
 * app does: it runs remote-ish content under a strict CSP, and a bug there should not become
 * a bug in the main process. Every parser below returns a NEW object built from validated
 * fields, so nothing the renderer sent is ever passed onwards by reference.
 *
 * There is deliberately no parser for an API key, a live-trading toggle, or a private-API
 * switch, because there are no such channels to validate.
 */

/** Channels that take no arguments at all. Anything but an empty object is a bug or an attack. */
export function parseProductIpc(input: unknown): Readonly<Record<string, never>> {
  if (input === undefined || input === null) return Object.freeze({});
  if (typeof input !== "object" || Array.isArray(input) || Object.keys(input).length > 0) {
    throw new Error("this request takes no arguments");
  }
  return Object.freeze({});
}

/**
 * The first-run acknowledgement. `confirmed` must be a literal `true`: no default, no
 * coercion, no truthy string. A user acknowledging a safety notice is the one input in this
 * application that must come from a real click and nothing else.
 */
export function parseFirstRunAcknowledgeIpc(input: unknown): Readonly<{ confirmed: true }> {
  if (input === null || typeof input !== "object") throw new Error("invalid acknowledgement");
  if ((input as { confirmed?: unknown }).confirmed !== true) throw new Error("first-run notice requires an explicit confirmation");
  return Object.freeze({ confirmed: true as const });
}

const LOG_LEVELS = new Set(["ERROR", "WARN", "INFO", "DEBUG"]);
const THEMES = new Set(["SYSTEM", "DARK", "LIGHT"]);

export interface AppSettingsIpc {
  readonly theme: string;
  readonly logLevel: string;
  readonly logRetentionDays: number;
  readonly showDiagnostics: boolean;
  readonly showNotifications: boolean;
}

/**
 * Settings from the renderer. Unknown keys are dropped rather than rejected -- an older
 * renderer sending a field a newer main process removed should still be able to save the
 * fields it does understand.
 */
export function parseAppSettingsIpc(input: unknown): AppSettingsIpc {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid settings payload");
  const value = input as Record<string, unknown>;
  if (!THEMES.has(String(value.theme))) throw new Error("invalid theme");
  if (!LOG_LEVELS.has(String(value.logLevel))) throw new Error("invalid log level");
  const retention = Number(value.logRetentionDays);
  if (!Number.isSafeInteger(retention) || retention < 1 || retention > 90) throw new Error("invalid log retention");
  if (typeof value.showDiagnostics !== "boolean" || typeof value.showNotifications !== "boolean") throw new Error("invalid display toggle");
  return Object.freeze({
    theme: String(value.theme),
    logLevel: String(value.logLevel),
    logRetentionDays: retention,
    showDiagnostics: value.showDiagnostics,
    showNotifications: value.showNotifications
  });
}

export type OpenableFolder = "LOGS" | "EVIDENCE" | "USER_DATA";
const FOLDERS = new Set<OpenableFolder>(["LOGS", "EVIDENCE", "USER_DATA"]);

/**
 * Which folder to reveal. A KEY, never a path.
 *
 * If the renderer could name a directory, "open this folder" would become "open any folder on
 * this machine", and the main process would be running it on the renderer's say-so. Three
 * fixed keys cannot be turned into a fourth.
 */
export function parseOpenFolderIpc(input: unknown): Readonly<{ folder: OpenableFolder }> {
  if (input === null || typeof input !== "object") throw new Error("invalid folder request");
  const folder = (input as { folder?: unknown }).folder;
  if (typeof folder !== "string" || !FOLDERS.has(folder as OpenableFolder)) throw new Error("unknown folder");
  return Object.freeze({ folder: folder as OpenableFolder });
}
