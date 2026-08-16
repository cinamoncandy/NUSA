import { VersionedJsonStore, type VersionedStorage } from "./mobilePersistence";
import { normalizeSettings, type AppSettings, type SettingsRepository } from "./settings";
import { parseOrderHistory, type OrderHistoryEntry } from "./orderHistory";
import type { PortfolioRepository, PortfolioSummary } from "./portfolioDomain";

export class JsonPortfolioRepository implements PortfolioRepository {
  private readonly store: VersionedJsonStore<PortfolioSummary>;
  public constructor(storage: VersionedStorage, key = "nusa:portfolio:v1") { this.store = new VersionedJsonStore(storage, key, 1, (value) => { if (value === null || typeof value !== "object") throw new Error("portfolio is invalid"); return value as PortfolioSummary; }); }
  public load(): Promise<PortfolioSummary | null> { return this.store.load(); }
  public save(value: PortfolioSummary): Promise<void> { return this.store.save(value); }
}

export class JsonOrderHistoryRepository {
  private readonly store: VersionedJsonStore<readonly OrderHistoryEntry[]>;
  public constructor(storage: VersionedStorage, key = "nusa:order-history:v1") { this.store = new VersionedJsonStore(storage, key, 1, (value) => parseOrderHistory(value)); }
  public load(): Promise<readonly OrderHistoryEntry[] | null> { return this.store.load(); }
  public save(value: readonly OrderHistoryEntry[]): Promise<void> { return this.store.save(value); }
}

export class VersionedSettingsRepository implements SettingsRepository {
  private readonly store: VersionedJsonStore<AppSettings>;
  public constructor(storage: VersionedStorage, key = "nusa:app-settings:v1") { this.store = new VersionedJsonStore(storage, key, 1, (value) => normalizeSettings(value as Partial<AppSettings>), (value, version) => { if (version !== 0 || value === null || typeof value !== "object") throw new Error("unsupported settings migration"); return normalizeSettings(value as Partial<AppSettings>); }); }
  public load(): Promise<AppSettings | null> { return this.store.load(); }
  public async save(value: AppSettings): Promise<void> { await this.store.save(normalizeSettings(value)); }
}
