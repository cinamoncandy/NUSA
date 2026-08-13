import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "../../../packages/storage/src/index";

export type NusaUserRole = "OWNER" | "USER";
export type NusaUserStatus = "PENDING" | "ACTIVE" | "REJECTED" | "SUSPENDED";
export type NusaUserAccessAction = "APPROVE" | "REJECT" | "SUSPEND" | "RESTORE";

export interface NusaUserRecord {
  readonly id: string;
  readonly email: string;
  readonly displayName?: string;
  readonly role: NusaUserRole;
  readonly status: NusaUserStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastLoginAt?: number;
  readonly lastSeenAt?: number;
}

export interface NusaUserAccessAuditRecord {
  readonly id: string;
  readonly actorUserId: string;
  readonly targetUserId: string;
  readonly action: NusaUserAccessAction;
  readonly previousStatus: NusaUserStatus;
  readonly newStatus: NusaUserStatus;
  readonly reason?: string;
  readonly createdAt: number;
}

export interface NusaUserAccessRepository {
  ensureOwner(user: Readonly<{ id: string; email: string; displayName?: string }>, now?: number): NusaUserRecord;
  registerUser(user: Readonly<{ id: string; email: string; displayName?: string }>, now?: number): NusaUserRecord;
  markLogin(userId: string, now?: number): NusaUserRecord;
  markSeen(userId: string, now?: number): NusaUserRecord;
  get(userId: string): NusaUserRecord | undefined;
  list(): readonly NusaUserRecord[];
  changeStatus(input: Readonly<{ actorUserId: string; targetUserId: string; action: NusaUserAccessAction; reason?: string; now?: number }>): NusaUserRecord;
  listAudit(limit?: number): readonly NusaUserAccessAuditRecord[];
}

const normalizeEmail = (value: string): string => value.trim().toLowerCase();
const cleanName = (value: string | undefined): string | undefined => value?.trim() || undefined;

function validateIdentity(id: string, email: string): void {
  if (!id.trim()) throw new Error("user id is required");
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes("@")) throw new Error("valid email is required");
}

function nextStatus(_current: NusaUserStatus, action: NusaUserAccessAction): NusaUserStatus {
  switch (action) {
    case "APPROVE":
    case "RESTORE": return "ACTIVE";
    case "REJECT": return "REJECTED";
    case "SUSPEND": return "SUSPENDED";
  }
}

abstract class BaseRepository {
  protected assertActor(actor: NusaUserRecord | undefined): asserts actor is NusaUserRecord {
    if (actor?.role !== "OWNER" || actor.status !== "ACTIVE") throw new Error("operator authority required");
  }
  protected assertTarget(target: NusaUserRecord | undefined): asserts target is NusaUserRecord {
    if (target == null) throw new Error("target user not found");
    if (target.role === "OWNER") throw new Error("owner access cannot be changed through user approval");
  }
  protected assertOwnerBootstrapSafe(existing: NusaUserRecord | undefined): void {
    if (existing == null) return;
    if (existing.role !== "OWNER" || existing.status !== "ACTIVE") throw new Error("owner bootstrap identity collision");
  }
}

export class InMemoryNusaUserAccessRepository extends BaseRepository implements NusaUserAccessRepository {
  private readonly users = new Map<string, NusaUserRecord>();
  private readonly audit: NusaUserAccessAuditRecord[] = [];

  public ensureOwner(user: Readonly<{ id: string; email: string; displayName?: string }>, now = Date.now()): NusaUserRecord {
    validateIdentity(user.id, user.email);
    const id = user.id.trim();
    const existing = this.users.get(id);
    this.assertOwnerBootstrapSafe(existing);
    if (existing != null) return existing;
    const record = Object.freeze({ id, email: normalizeEmail(user.email), ...(cleanName(user.displayName) ? { displayName: cleanName(user.displayName) } : {}), role: "OWNER" as const, status: "ACTIVE" as const, createdAt: now, updatedAt: now, lastSeenAt: now });
    this.users.set(record.id, record);
    return record;
  }

  public registerUser(user: Readonly<{ id: string; email: string; displayName?: string }>, now = Date.now()): NusaUserRecord {
    validateIdentity(user.id, user.email);
    const existing = this.users.get(user.id);
    if (existing != null) return existing;
    const record = Object.freeze({ id: user.id.trim(), email: normalizeEmail(user.email), ...(cleanName(user.displayName) ? { displayName: cleanName(user.displayName) } : {}), role: "USER" as const, status: "PENDING" as const, createdAt: now, updatedAt: now });
    this.users.set(record.id, record);
    return record;
  }

  public markLogin(userId: string, now = Date.now()): NusaUserRecord { return this.touch(userId, now, true); }
  public markSeen(userId: string, now = Date.now()): NusaUserRecord { return this.touch(userId, now, false); }
  private touch(userId: string, now: number, login: boolean): NusaUserRecord {
    const current = this.users.get(userId); if (current == null) throw new Error("user not found");
    const next = Object.freeze({ ...current, updatedAt: now, lastSeenAt: now, ...(login ? { lastLoginAt: now } : {}) }); this.users.set(userId, next); return next;
  }
  public get(userId: string): NusaUserRecord | undefined { return this.users.get(userId); }
  public list(): readonly NusaUserRecord[] { return Object.freeze([...this.users.values()].sort((a, b) => b.createdAt - a.createdAt)); }
  public changeStatus(input: Readonly<{ actorUserId: string; targetUserId: string; action: NusaUserAccessAction; reason?: string; now?: number }>): NusaUserRecord {
    this.assertActor(this.users.get(input.actorUserId));
    const target = this.users.get(input.targetUserId); this.assertTarget(target);
    const now = input.now ?? Date.now(); const status = nextStatus(target.status, input.action);
    const next = Object.freeze({ ...target, status, updatedAt: now }); this.users.set(target.id, next);
    this.audit.unshift(Object.freeze({ id: randomUUID(), actorUserId: input.actorUserId, targetUserId: target.id, action: input.action, previousStatus: target.status, newStatus: status, ...(input.reason?.trim() ? { reason: input.reason.trim().slice(0, 500) } : {}), createdAt: now }));
    return next;
  }
  public listAudit(limit = 100): readonly NusaUserAccessAuditRecord[] { return Object.freeze(this.audit.slice(0, Math.max(0, Math.min(limit, 500)))); }
}

export class SqliteNusaUserAccessRepository extends BaseRepository implements NusaUserAccessRepository {
  public constructor(private readonly db: SqliteDatabase) {
    super();
    db.connection.exec(`
      CREATE TABLE IF NOT EXISTS nusa_users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT, role TEXT NOT NULL CHECK(role IN ('OWNER','USER')),
        status TEXT NOT NULL CHECK(status IN ('PENDING','ACTIVE','REJECTED','SUSPENDED')),
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_login_at INTEGER, last_seen_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_nusa_users_status ON nusa_users(status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS nusa_user_access_audit (
        id TEXT PRIMARY KEY, actor_user_id TEXT NOT NULL, target_user_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('APPROVE','REJECT','SUSPEND','RESTORE')),
        previous_status TEXT NOT NULL, new_status TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_nusa_user_access_audit_created ON nusa_user_access_audit(created_at DESC);
    `);
  }
  private decode(row: Record<string, unknown> | undefined): NusaUserRecord | undefined {
    if (row == null) return undefined;
    return Object.freeze({ id: String(row.id), email: String(row.email), ...(row.display_name == null ? {} : { displayName: String(row.display_name) }), role: String(row.role) as NusaUserRole, status: String(row.status) as NusaUserStatus, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), ...(row.last_login_at == null ? {} : { lastLoginAt: Number(row.last_login_at) }), ...(row.last_seen_at == null ? {} : { lastSeenAt: Number(row.last_seen_at) }) });
  }
  public ensureOwner(user: Readonly<{ id: string; email: string; displayName?: string }>, now = Date.now()): NusaUserRecord {
    validateIdentity(user.id, user.email); const id = user.id.trim(); const existing = this.get(id); this.assertOwnerBootstrapSafe(existing);
    if (existing != null) return existing;
    this.db.connection.prepare(`INSERT INTO nusa_users(id,email,display_name,role,status,created_at,updated_at,last_seen_at) VALUES(?,?,?,'OWNER','ACTIVE',?,?,?)`).run(id,normalizeEmail(user.email),cleanName(user.displayName) ?? null,now,now,now);
    return this.get(id)!;
  }
  public registerUser(user: Readonly<{ id: string; email: string; displayName?: string }>, now = Date.now()): NusaUserRecord {
    validateIdentity(user.id, user.email); const id=user.id.trim(); const existing=this.get(id); if(existing) return existing;
    this.db.connection.prepare(`INSERT INTO nusa_users(id,email,display_name,role,status,created_at,updated_at) VALUES(?,?,?,'USER','PENDING',?,?)`).run(id,normalizeEmail(user.email),cleanName(user.displayName) ?? null,now,now); return this.get(id)!;
  }
  public markLogin(userId: string, now=Date.now()): NusaUserRecord { this.db.connection.prepare("UPDATE nusa_users SET last_login_at=?, last_seen_at=?, updated_at=? WHERE id=?").run(now,now,now,userId); return this.get(userId) ?? (()=>{throw new Error("user not found")})(); }
  public markSeen(userId: string, now=Date.now()): NusaUserRecord { this.db.connection.prepare("UPDATE nusa_users SET last_seen_at=?, updated_at=? WHERE id=?").run(now,now,userId); return this.get(userId) ?? (()=>{throw new Error("user not found")})(); }
  public get(userId: string): NusaUserRecord | undefined { return this.decode(this.db.connection.prepare("SELECT * FROM nusa_users WHERE id=?").get(userId) as Record<string, unknown> | undefined); }
  public list(): readonly NusaUserRecord[] { return Object.freeze((this.db.connection.prepare("SELECT * FROM nusa_users ORDER BY created_at DESC, id ASC").all() as Record<string, unknown>[]).map((row)=>this.decode(row)!)); }
  public changeStatus(input: Readonly<{ actorUserId: string; targetUserId: string; action: NusaUserAccessAction; reason?: string; now?: number }>): NusaUserRecord {
    const actor=this.get(input.actorUserId); this.assertActor(actor); const target=this.get(input.targetUserId); this.assertTarget(target); const now=input.now ?? Date.now(); const status=nextStatus(target.status,input.action); const reason=input.reason?.trim().slice(0,500) || null;
    this.db.transaction(()=>{ this.db.connection.prepare("UPDATE nusa_users SET status=?, updated_at=? WHERE id=?").run(status,now,target.id); this.db.connection.prepare("INSERT INTO nusa_user_access_audit(id,actor_user_id,target_user_id,action,previous_status,new_status,reason,created_at) VALUES(?,?,?,?,?,?,?,?)").run(randomUUID(),input.actorUserId,target.id,input.action,target.status,status,reason,now); }); return this.get(target.id)!;
  }
  public listAudit(limit=100): readonly NusaUserAccessAuditRecord[] { const rows=this.db.connection.prepare("SELECT * FROM nusa_user_access_audit ORDER BY created_at DESC LIMIT ?").all(Math.max(0,Math.min(limit,500))) as Record<string, unknown>[]; return Object.freeze(rows.map((row)=>Object.freeze({id:String(row.id),actorUserId:String(row.actor_user_id),targetUserId:String(row.target_user_id),action:String(row.action) as NusaUserAccessAction,previousStatus:String(row.previous_status) as NusaUserStatus,newStatus:String(row.new_status) as NusaUserStatus,...(row.reason==null?{}:{reason:String(row.reason)}),createdAt:Number(row.created_at)}))); }
}

export function isUserAllowed(record: NusaUserRecord | undefined): boolean { return record?.status === "ACTIVE"; }
