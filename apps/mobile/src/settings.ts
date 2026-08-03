import type { SecureStoragePort } from "./mobileSecurity";

export type ThemeSetting = "LIGHT" | "DARK" | "SYSTEM";
export type LocaleSetting = "ko-KR" | "en-US";

export interface NotificationSettings {
  readonly enabled: boolean;
  readonly riskAlerts: boolean;
  readonly orderUpdates: boolean;
}

export interface AppSettings {
  readonly theme: ThemeSetting;
  readonly locale: LocaleSetting;
  readonly notifications: NotificationSettings;
}

export interface EnvironmentConfiguration {
  readonly apiBaseUrl: string;
  readonly authMode: string;
  readonly monitorUrl: string;
}

export interface SettingsRepository {
  load(): Promise<AppSettings | null>;
  save(settings: AppSettings): Promise<void>;
}

export const DEFAULT_SETTINGS: AppSettings = Object.freeze({ theme: "SYSTEM", locale: "ko-KR", notifications: Object.freeze({ enabled: true, riskAlerts: true, orderUpdates: true }) });

const text = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be empty`);
  return normalized;
};

export const normalizeSettings = (input: Partial<AppSettings>): AppSettings => {
  const theme = input.theme ?? DEFAULT_SETTINGS.theme;
  const locale = input.locale ?? DEFAULT_SETTINGS.locale;
  if (!["LIGHT", "DARK", "SYSTEM"].includes(theme)) throw new Error("theme is invalid");
  if (!["ko-KR", "en-US"].includes(locale)) throw new Error("locale is invalid");
  const notifications = input.notifications ?? DEFAULT_SETTINGS.notifications;
  for (const field of ["enabled", "riskAlerts", "orderUpdates"] as const) if (typeof notifications[field] !== "boolean") throw new Error(`notifications.${field} is invalid`);
  return Object.freeze({ theme, locale, notifications: Object.freeze({ ...notifications }) });
};

export const readEnvironmentConfiguration = (environment: Record<string, string | undefined> = process.env): EnvironmentConfiguration => Object.freeze({
  apiBaseUrl: text(environment.EXPO_PUBLIC_NUSA_API_BASE_URL ?? "http://127.0.0.1:41731", "apiBaseUrl"),
  authMode: text(environment.EXPO_PUBLIC_NUSA_AUTH_MODE ?? "foundation", "authMode"),
  monitorUrl: text(environment.EXPO_PUBLIC_NUSA_MONITOR_URL ?? "http://127.0.0.1:41731", "monitorUrl"),
});

export class MockSettingsRepository implements SettingsRepository {
  private value: AppSettings | null = null;
  public async load(): Promise<AppSettings | null> { return this.value; }
  public async save(settings: AppSettings): Promise<void> { this.value = normalizeSettings(settings); }
}

export class SecureSettingsRepository implements SettingsRepository {
  public constructor(private readonly storage: SecureStoragePort, private readonly key = "nusa:app-settings") {}

  public async load(): Promise<AppSettings | null> {
    const raw = await this.storage.getSecret(text(this.key, "key"));
    if (raw === null) return null;
    try { return normalizeSettings(JSON.parse(new TextDecoder().decode(raw)) as Partial<AppSettings>); } catch { throw new Error("stored settings are invalid"); }
  }

  public async save(settings: AppSettings): Promise<void> {
    const normalized = normalizeSettings(settings);
    await this.storage.setSecret(text(this.key, "key"), new TextEncoder().encode(JSON.stringify(normalized)));
  }
}
