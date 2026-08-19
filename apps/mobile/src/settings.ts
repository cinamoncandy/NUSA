import type { SecureStoragePort } from "./mobileSecurity";

export type ThemeSetting = "LIGHT" | "DARK" | "SYSTEM";
export type LocaleSetting = "ko-KR" | "en-US";
export interface NotificationSettings { readonly enabled: boolean; readonly riskAlerts: boolean; readonly orderUpdates: boolean; }
export interface CapitalAllocationSettings { readonly investmentPercent: number; }
export interface AppSettings {
  readonly theme: ThemeSetting;
  readonly locale: LocaleSetting;
  readonly notifications: NotificationSettings;
  readonly capitalAllocation: CapitalAllocationSettings;
  /** Canonical Cloud/PAPER endpoint. Development-only loopback is accepted only outside production mode. */
  readonly paperEndpoint: string;
}
export interface EnvironmentConfiguration { readonly apiBaseUrl: string; readonly authMode: string; readonly monitorUrl: string; }
export interface SettingsRepository { load(): Promise<AppSettings | null>; save(settings: AppSettings): Promise<void>; }
export const CANONICAL_PAPER_ORIGIN = "https://nusa-api.duckdns.org";

export const DEFAULT_SETTINGS: AppSettings = Object.freeze({
  theme: "SYSTEM",
  locale: "ko-KR",
  notifications: Object.freeze({ enabled: true, riskAlerts: true, orderUpdates: true }),
  capitalAllocation: Object.freeze({ investmentPercent: 100 }),
  paperEndpoint: CANONICAL_PAPER_ORIGIN
});
export interface SettingsNormalizationOptions { readonly production?: boolean; }
const text = (value: string, field: string): string => { const normalized = value.trim(); if (!normalized) throw new Error(`${field} must not be empty`); return normalized; };
const normalizeEndpoint = (value: string | undefined, production = false): string => {
  const normalized = value?.trim() ?? "";
  if (!normalized) return CANONICAL_PAPER_ORIGIN;
  let url: URL;
  try { url = new URL(normalized); } catch { throw new Error("paperEndpoint is invalid"); }
  if (url.username || url.password) throw new Error("paperEndpoint must not contain credentials");
  const host = url.hostname.toLowerCase();
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (production && (url.protocol !== "https:" || url.origin !== CANONICAL_PAPER_ORIGIN)) throw new Error("paperEndpoint must use the canonical HTTPS origin in production");
  const secure = url.protocol === "https:" || (!production && url.protocol === "http:" && loopback);
  if (!secure) throw new Error("paperEndpoint must use HTTPS unless loopback-only");
  return normalized.replace(/\/+$/, "");
};

export const normalizeInvestmentPercent = (value: number): number => {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error("capitalAllocation.investmentPercent must be between 0 and 100");
  return Math.round(value * 100) / 100;
};
export const cashReservePercent = (investmentPercent: number): number => Math.round((100 - normalizeInvestmentPercent(investmentPercent)) * 100) / 100;

export const normalizeSettings = (input: Partial<AppSettings>, options: SettingsNormalizationOptions = {}): AppSettings => {
  const theme = input.theme ?? DEFAULT_SETTINGS.theme;
  const locale = input.locale ?? DEFAULT_SETTINGS.locale;
  if (!["LIGHT", "DARK", "SYSTEM"].includes(theme)) throw new Error("theme is invalid");
  if (!["ko-KR", "en-US"].includes(locale)) throw new Error("locale is invalid");
  const notifications = input.notifications ?? DEFAULT_SETTINGS.notifications;
  for (const field of ["enabled", "riskAlerts", "orderUpdates"] as const) if (typeof notifications[field] !== "boolean") throw new Error(`notifications.${field} is invalid`);
  const capitalAllocation = input.capitalAllocation ?? DEFAULT_SETTINGS.capitalAllocation;
  const investmentPercent = normalizeInvestmentPercent(capitalAllocation.investmentPercent);
  return Object.freeze({ theme, locale, notifications: Object.freeze({ ...notifications }), capitalAllocation: Object.freeze({ investmentPercent }), paperEndpoint: normalizeEndpoint(input.paperEndpoint, options.production === true) });
};

/** Environment configuration is fail-closed: endpoint variables must be explicitly supplied by the caller. */
export const readEnvironmentConfiguration = (environment: Record<string, string | undefined> = process.env): EnvironmentConfiguration => Object.freeze({
  apiBaseUrl: text(environment.EXPO_PUBLIC_NUSA_API_BASE_URL ?? "", "apiBaseUrl"),
  authMode: text(environment.EXPO_PUBLIC_NUSA_AUTH_MODE ?? "foundation", "authMode"),
  monitorUrl: text(environment.EXPO_PUBLIC_NUSA_MONITOR_URL ?? "", "monitorUrl")
});

export class MockSettingsRepository implements SettingsRepository {
  private value: AppSettings | null = null;
  public async load(): Promise<AppSettings | null> { return this.value; }
  public async save(settings: AppSettings): Promise<void> { this.value = normalizeSettings(settings); }
}
export class SecureSettingsRepository implements SettingsRepository {
  public constructor(private readonly storage: SecureStoragePort, private readonly key = "nusa:app-settings", private readonly options: SettingsNormalizationOptions = {}) {}
  public async load(): Promise<AppSettings | null> { const raw = await this.storage.getSecret(text(this.key, "key")); if (raw === null) return null; try { return normalizeSettings(JSON.parse(new TextDecoder().decode(raw)) as Partial<AppSettings>, this.options); } catch { throw new Error("stored settings are invalid"); } }
  public async save(settings: AppSettings): Promise<void> { const normalized = normalizeSettings(settings, this.options); await this.storage.setSecret(text(this.key, "key"), new TextEncoder().encode(JSON.stringify(normalized))); }
}
