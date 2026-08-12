import type { SqliteDatabase } from "../../../packages/storage/src/index";

export interface CloudInvestmentAllocationSetting {
  readonly userId: string;
  readonly investmentPercent: number;
  readonly revision: number;
  readonly updatedAt: number;
  readonly source: "USER_SETTING";
}

export interface InvestmentAllocationSettingsRepository {
  get(userId: string): CloudInvestmentAllocationSetting | undefined;
  save(userId: string, investmentPercent: number, expectedRevision?: number): CloudInvestmentAllocationSetting;
}

export function normalizeInvestmentPercent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) throw new Error("investmentPercent must be between 0 and 100");
  return Math.round(value * 100) / 100;
}

const normalizeUserId = (value: string): string => {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 200) throw new Error("userId is invalid");
  return value.trim();
};

export class InMemoryInvestmentAllocationSettingsRepository implements InvestmentAllocationSettingsRepository {
  private readonly values = new Map<string, CloudInvestmentAllocationSetting>();
  public get(userId: string): CloudInvestmentAllocationSetting | undefined { return this.values.get(normalizeUserId(userId)); }
  public save(userId: string, investmentPercent: number, expectedRevision?: number): CloudInvestmentAllocationSetting {
    const id = normalizeUserId(userId);
    const value = normalizeInvestmentPercent(investmentPercent);
    const current = this.values.get(id);
    if (current?.investmentPercent === value) return current;
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision !== (current?.revision ?? 0))) throw new Error("stale investment allocation revision");
    const next = Object.freeze({ userId: id, investmentPercent: value, revision: (current?.revision ?? 0) + 1, updatedAt: Date.now(), source: "USER_SETTING" as const });
    this.values.set(id, next);
    return next;
  }
}

export class SqliteInvestmentAllocationSettingsRepository implements InvestmentAllocationSettingsRepository {
  public constructor(private readonly db: SqliteDatabase) {
    db.connection.exec("CREATE TABLE IF NOT EXISTS cloud_investment_allocation_settings (user_id TEXT PRIMARY KEY, investment_percent REAL NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, CHECK(investment_percent >= 0 AND investment_percent <= 100), CHECK(revision > 0))");
  }
  public get(userId: string): CloudInvestmentAllocationSetting | undefined {
    const row = this.db.connection.prepare("SELECT user_id, investment_percent, revision, updated_at FROM cloud_investment_allocation_settings WHERE user_id=?").get(normalizeUserId(userId)) as Record<string, string | number> | undefined;
    return row == null ? undefined : Object.freeze({ userId: String(row.user_id), investmentPercent: normalizeInvestmentPercent(Number(row.investment_percent)), revision: Number(row.revision), updatedAt: Number(row.updated_at), source: "USER_SETTING" as const });
  }
  public save(userId: string, investmentPercent: number, expectedRevision?: number): CloudInvestmentAllocationSetting {
    const id = normalizeUserId(userId);
    const value = normalizeInvestmentPercent(investmentPercent);
    const current = this.get(id);
    if (current?.investmentPercent === value) return current;
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision !== (current?.revision ?? 0))) throw new Error("stale investment allocation revision");
    const revision = (current?.revision ?? 0) + 1;
    const updatedAt = Date.now();
    this.db.transaction(() => this.db.connection.prepare("INSERT INTO cloud_investment_allocation_settings(user_id,investment_percent,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET investment_percent=excluded.investment_percent, revision=excluded.revision, updated_at=excluded.updated_at").run(id, value, revision, updatedAt));
    return Object.freeze({ userId: id, investmentPercent: value, revision, updatedAt, source: "USER_SETTING" as const });
  }
}
