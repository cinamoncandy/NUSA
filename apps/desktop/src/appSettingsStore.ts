import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isContainedIn, protectedPaths, resettablePaths, type UserDataLayout } from "./userDataLayout";

/**
 * User-facing application settings (WO-0034-A4O req 3 and 7).
 *
 * What is deliberately NOT here: any API key field, any live-trading toggle, any private-API
 * switch. Not "disabled" -- absent. A disabled toggle is a feature waiting for someone to
 * enable it; a setting that does not exist cannot be turned on by editing a JSON file either.
 *
 * Every value is presentation or diagnostics. Nothing in this file can change what the
 * trading runtime is permitted to do, which is why a reset can be offered at all.
 */

export type LogLevel = "ERROR" | "WARN" | "INFO" | "DEBUG";
export type ThemePreference = "SYSTEM" | "DARK" | "LIGHT";
export type LanguagePreference = "ko";

export interface AppSettings {
  readonly schemaVersion: 1;
  /** Only Korean ships today; the field exists so adding one is not a schema migration. */
  readonly language: LanguagePreference;
  readonly theme: ThemePreference;
  readonly logLevel: LogLevel;
  /** How long log files are kept. Evidence retention is NOT configurable here. */
  readonly logRetentionDays: number;
  readonly showDiagnostics: boolean;
  readonly showNotifications: boolean;
}

export const LOG_LEVELS: readonly LogLevel[] = Object.freeze(["ERROR", "WARN", "INFO", "DEBUG"]);
const THEMES: readonly ThemePreference[] = Object.freeze(["SYSTEM", "DARK", "LIGHT"]);
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 90;

/**
 * INFO, not DEBUG. A default-verbose build writes the user's activity to disk in volume for
 * no one's benefit, and A4O req 10 asks for verbose logging off by default in production.
 */
export const DEFAULT_APP_SETTINGS: AppSettings = Object.freeze({
  schemaVersion: 1,
  language: "ko",
  theme: "SYSTEM",
  logLevel: "INFO",
  logRetentionDays: 14,
  showDiagnostics: true,
  showNotifications: true
});

/**
 * Coerces stored or incoming settings to something usable.
 *
 * Field-by-field rather than all-or-nothing: one corrupted key should cost the user that one
 * preference, not every preference they have ever set. Unknown keys are dropped, so a value
 * written by a newer build (or by hand) can never reach the rest of the app.
 */
export function normalizeAppSettings(value: unknown): AppSettings {
  const input = (value !== null && typeof value === "object" ? value : {}) as Partial<Record<keyof AppSettings, unknown>>;
  const retention = Number(input.logRetentionDays);
  return Object.freeze({
    schemaVersion: 1,
    language: "ko",
    theme: THEMES.includes(input.theme as ThemePreference) ? (input.theme as ThemePreference) : DEFAULT_APP_SETTINGS.theme,
    logLevel: LOG_LEVELS.includes(input.logLevel as LogLevel) ? (input.logLevel as LogLevel) : DEFAULT_APP_SETTINGS.logLevel,
    logRetentionDays: Number.isSafeInteger(retention) && retention >= MIN_RETENTION_DAYS && retention <= MAX_RETENTION_DAYS
      ? retention
      : DEFAULT_APP_SETTINGS.logRetentionDays,
    showDiagnostics: typeof input.showDiagnostics === "boolean" ? input.showDiagnostics : DEFAULT_APP_SETTINGS.showDiagnostics,
    showNotifications: typeof input.showNotifications === "boolean" ? input.showNotifications : DEFAULT_APP_SETTINGS.showNotifications
  });
}

export interface SettingsResetResult {
  readonly removed: readonly string[];
  /** Locations a reset is forbidden to touch, listed so the caller can show them. */
  readonly preserved: readonly string[];
  readonly settings: AppSettings;
}

export class AppSettingsStore {
  private cached: AppSettings = DEFAULT_APP_SETTINGS;

  constructor(private readonly layout: UserDataLayout) {}

  /** Never throws. An unreadable settings file yields defaults, not a failed startup. */
  load(): AppSettings {
    try {
      this.cached = normalizeAppSettings(JSON.parse(readFileSync(this.layout.settingsFile, "utf8")));
    } catch {
      this.cached = DEFAULT_APP_SETTINGS;
    }
    return this.cached;
  }

  current(): AppSettings {
    return this.cached;
  }

  save(value: unknown): AppSettings {
    const settings = normalizeAppSettings(value);
    mkdirSync(path.dirname(this.layout.settingsFile), { recursive: true });
    writeFileSync(this.layout.settingsFile, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    this.cached = settings;
    return settings;
  }

  /**
   * Deletes preferences and the first-run acknowledgement. Nothing else.
   *
   * The protected locations are re-checked here rather than trusted from the list: a reset
   * that walked into the evidence directory would destroy the record an observation exists to
   * produce, and that is not a mistake worth leaving to a code review. A target that resolves
   * inside a protected directory throws instead of being skipped, because a reset that
   * quietly does less than it says is its own kind of failure.
   */
  reset(): SettingsResetResult {
    const guarded = protectedPaths(this.layout);
    const removed: string[] = [];
    for (const target of resettablePaths(this.layout)) {
      for (const guard of guarded) {
        if (isContainedIn(guard, target)) throw new Error(`settings reset refused: ${target} is inside protected ${guard}`);
      }
      try {
        rmSync(target, { force: true });
        removed.push(target);
      } catch {
        // A file that will not delete is reported by its absence from `removed`, not by
        // aborting: the remaining preferences should still be cleared.
      }
    }
    this.cached = DEFAULT_APP_SETTINGS;
    return Object.freeze({ removed: Object.freeze(removed), preserved: guarded, settings: DEFAULT_APP_SETTINGS });
  }
}
