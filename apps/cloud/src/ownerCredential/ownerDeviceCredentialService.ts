import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import type { SqliteDatabase } from "../../../../packages/storage/src/index";
import { isUserAllowed, type NusaUserAccessRepository } from "../operatorUserAccess";
import type { MobileSessionService, MobileSessionTokens } from "../mobileSessionService";

export const OWNER_DEVICE_CREDENTIAL_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_ACTIVE_CHALLENGES = 100;
const MAX_ACTIVE_CHALLENGES_PER_CREDENTIAL = 2;
const DOMAIN = "NUSA_OWNER_DEVICE_CREDENTIAL_V1";
const CONTEXT = "nusa-owner-device-credential";
export type OwnerDeviceCredentialPurpose = "REGISTRATION" | "AUTHENTICATION";

export interface OwnerDeviceCredentialChallenge {
  readonly challengeId: string;
  readonly challenge: string;
  readonly purpose: OwnerDeviceCredentialPurpose;
  readonly expiresAt: number;
}

const hash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const base64url = (value: Buffer): string => value.toString("base64url");
const identifier = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(normalized)) throw new Error(`${field} is invalid`);
  return normalized;
};
const deviceId = (value: string): string => {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 256 || /[\r\n]/.test(normalized)) throw new Error("device identifier is invalid");
  return normalized;
};
const publicKey = (value: string): string => {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length < 80 || normalized.length > 2048) throw new Error("public key is invalid");
  const raw = Buffer.from(normalized, "base64");
  if (raw.length < 64 || raw.length > 1024 || raw.toString("base64") !== normalized) throw new Error("public key is invalid");
  try {
    const key = createPublicKey({ key: raw, format: "der", type: "spki" });
    const details = key.asymmetricKeyDetails;
    if (key.asymmetricKeyType !== "ec" || details?.namedCurve !== "prime256v1") throw new Error("public key is not P-256");
  } catch { throw new Error("public key is invalid"); }
  return normalized;
};
const signature = (value: string): Buffer => {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length < 8 || normalized.length > 1024) throw new Error("signature is invalid");
  const raw = Buffer.from(normalized, "base64");
  if (raw.length < 8 || raw.length > 512 || raw.toString("base64") !== normalized) throw new Error("signature is invalid");
  return raw;
};

/** Canonical bytes are purpose-separated and never derived from a client string. */
export function ownerDeviceCredentialChallengeBytes(input: Readonly<{
  challengeId: string; nonce: string; purpose: OwnerDeviceCredentialPurpose; credentialId: string; deviceId: string; serverContext: string; expiresAt: number;
}>): Buffer {
  return Buffer.from([
    DOMAIN,
    `purpose=${input.purpose}`,
    `credential_id=${input.credentialId}`,
    `device_id=${input.deviceId}`,
    `server_context=${input.serverContext}`,
    `challenge_id=${input.challengeId}`,
    `expires_at=${input.expiresAt}`,
    `nonce=${input.nonce}`
  ].join("\n"), "utf8");
}

export class OwnerDeviceCredentialService {
  public constructor(
    private readonly db: SqliteDatabase,
    private readonly users: NusaUserAccessRepository,
    private readonly mobileSessions: MobileSessionService,
    private readonly serverContext = CONTEXT
  ) {
    if (!/^[a-z0-9][a-z0-9._:/-]{3,200}$/i.test(serverContext)) throw new Error("owner device credential server context is invalid");
    db.connection.exec(`
      CREATE TABLE IF NOT EXISTS nusa_owner_device_credentials (
        credential_id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        device_id_hash TEXT NOT NULL,
        public_key_spki TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        activated_at INTEGER NOT NULL,
        revoked_at INTEGER,
        revoke_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_nusa_owner_device_credentials_owner ON nusa_owner_device_credentials(owner_user_id, revoked_at);
      CREATE TABLE IF NOT EXISTS nusa_owner_device_credential_challenges (
        challenge_id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL CHECK(purpose IN ('REGISTRATION','AUTHENTICATION')),
        credential_id TEXT NOT NULL,
        actor_owner_user_id TEXT,
        device_id_hash TEXT NOT NULL,
        public_key_spki TEXT NOT NULL,
        nonce TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_nusa_owner_device_credential_challenges_expiry ON nusa_owner_device_credential_challenges(expires_at, consumed_at);
      CREATE INDEX IF NOT EXISTS idx_nusa_owner_device_credential_challenges_credential ON nusa_owner_device_credential_challenges(credential_id, purpose, consumed_at, expires_at);
    `);
    // Earlier local prototypes did not bind registration activation to its actor.
    // Upgrade their durable challenge table before accepting a new proof.
    const columns = db.connection.prepare("PRAGMA table_info(nusa_owner_device_credential_challenges)").all() as Record<string, unknown>[];
    if (!columns.some((column) => String(column.name) === "actor_owner_user_id")) {
      db.connection.exec("ALTER TABLE nusa_owner_device_credential_challenges ADD COLUMN actor_owner_user_id TEXT");
    }
  }

  public startRegistration(input: Readonly<{ actorUserId: string; actorScopes: readonly string[]; credentialId: string; deviceId: string; publicKeySpki: string; now?: number }>): OwnerDeviceCredentialChallenge {
    const actor = this.users.get(input.actorUserId.trim());
    if (actor?.role !== "OWNER" || !isUserAllowed(actor) || !input.actorScopes.includes("users:manage")) throw new Error("active owner users:manage authority required");
    const credential = identifier(input.credentialId, "credential id");
    const device = deviceId(input.deviceId);
    const key = publicKey(input.publicKeySpki);
    if (this.db.connection.prepare("SELECT 1 FROM nusa_owner_device_credentials WHERE credential_id=?").get(credential) != null) throw new Error("credential already registered");
    return this.createChallenge("REGISTRATION", credential, device, key, input.now, actor.id);
  }

  public activateRegistration(input: Readonly<{ actorUserId: string; actorScopes: readonly string[]; challengeId: string; credentialId: string; deviceId: string; signature: string; now?: number }>): boolean {
    const now = input.now ?? Date.now();
    const actor = this.users.get(input.actorUserId.trim());
    if (actor?.role !== "OWNER" || !isUserAllowed(actor) || !input.actorScopes.includes("users:manage")) throw new Error("active owner users:manage authority required");
    const row = this.consumeVerifiedChallenge("REGISTRATION", input.challengeId, input.credentialId, input.deviceId, input.signature, now, actor.id);
    if (row == null) return false;
    if (row.actor_owner_user_id !== actor.id) return false;
    return this.db.transaction(() => {
      const inserted = this.db.connection.prepare("INSERT OR IGNORE INTO nusa_owner_device_credentials(credential_id,owner_user_id,device_id_hash,public_key_spki,created_at,activated_at) VALUES(?,?,?,?,?,?)")
        .run(row.credential_id, actor.id, row.device_id_hash, row.public_key_spki, now, now);
      return Number(inserted.changes) === 1;
    });
  }

  public startAuthentication(input: Readonly<{ credentialId: string; deviceId: string; now?: number }>): OwnerDeviceCredentialChallenge | undefined {
    const credential = identifier(input.credentialId, "credential id");
    const device = deviceId(input.deviceId);
    const row = this.db.connection.prepare("SELECT credential_id,device_id_hash,public_key_spki FROM nusa_owner_device_credentials WHERE credential_id=? AND revoked_at IS NULL").get(credential) as Record<string, unknown> | undefined;
    if (row == null || String(row.device_id_hash) !== hash(device)) return undefined;
    return this.createChallenge("AUTHENTICATION", credential, device, String(row.public_key_spki), input.now);
  }

  public authenticate(input: Readonly<{ challengeId: string; credentialId: string; deviceId: string; signature: string; now?: number }>): MobileSessionTokens | undefined {
    const now = input.now ?? Date.now();
    const row = this.consumeVerifiedChallenge("AUTHENTICATION", input.challengeId, input.credentialId, input.deviceId, input.signature, now);
    if (row == null) return undefined;
    const credential = this.db.connection.prepare("SELECT owner_user_id,device_id_hash FROM nusa_owner_device_credentials WHERE credential_id=? AND revoked_at IS NULL").get(row.credential_id) as Record<string, unknown> | undefined;
    if (credential == null || String(credential.device_id_hash) !== row.device_id_hash) return undefined;
    const owner = this.users.get(String(credential.owner_user_id));
    if (owner?.role !== "OWNER" || !isUserAllowed(owner)) return undefined;
    return this.mobileSessions.issueOwnerDeviceCredentialSession({ userId: owner.id, deviceId: input.deviceId, now });
  }

  public revoke(input: Readonly<{ actorUserId: string; actorScopes: readonly string[]; credentialId: string; now?: number }>): boolean {
    const actor = this.users.get(input.actorUserId.trim());
    if (actor?.role !== "OWNER" || !isUserAllowed(actor) || !input.actorScopes.includes("users:manage")) throw new Error("active owner users:manage authority required");
    const updated = this.db.connection.prepare("UPDATE nusa_owner_device_credentials SET revoked_at=?,revoke_reason='OWNER_REVOKED' WHERE credential_id=? AND owner_user_id=? AND revoked_at IS NULL")
      .run(input.now ?? Date.now(), identifier(input.credentialId, "credential id"), actor.id);
    return Number(updated.changes) === 1;
  }

  private createChallenge(purpose: OwnerDeviceCredentialPurpose, credentialId: string, rawDeviceId: string, key: string, now = Date.now(), actorOwnerUserId?: string): OwnerDeviceCredentialChallenge {
    this.expireChallenges(now);
    const active = Number((this.db.connection.prepare("SELECT COUNT(*) AS count FROM nusa_owner_device_credential_challenges WHERE consumed_at IS NULL AND expires_at>?").get(now) as Record<string, unknown>).count);
    const perCredential = Number((this.db.connection.prepare("SELECT COUNT(*) AS count FROM nusa_owner_device_credential_challenges WHERE credential_id=? AND purpose=? AND consumed_at IS NULL AND expires_at>?").get(credentialId, purpose, now) as Record<string, unknown>).count);
    if (active >= MAX_ACTIVE_CHALLENGES || perCredential >= MAX_ACTIVE_CHALLENGES_PER_CREDENTIAL) throw new Error("owner device credential challenge limit reached");
    const challengeId = base64url(randomBytes(32));
    const nonce = base64url(randomBytes(32));
    const expiresAt = now + OWNER_DEVICE_CREDENTIAL_CHALLENGE_TTL_MS;
    const bytes = ownerDeviceCredentialChallengeBytes({ challengeId, nonce, purpose, credentialId, deviceId: rawDeviceId, serverContext: this.serverContext, expiresAt });
    this.db.connection.prepare("INSERT INTO nusa_owner_device_credential_challenges(challenge_id,purpose,credential_id,actor_owner_user_id,device_id_hash,public_key_spki,nonce,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(challengeId, purpose, credentialId, actorOwnerUserId ?? null, hash(rawDeviceId), key, nonce, now, expiresAt);
    return Object.freeze({ challengeId, challenge: bytes.toString("base64"), purpose, expiresAt });
  }

  private consumeVerifiedChallenge(purpose: OwnerDeviceCredentialPurpose, rawChallengeId: string, rawCredentialId: string, rawDeviceId: string, rawSignature: string, now: number, expectedActorOwnerUserId?: string): Record<string, string> | undefined {
    let challengeId: string; let credentialId: string; let normalizedDevice: string; let suppliedSignature: Buffer;
    try { challengeId = identifier(rawChallengeId, "challenge id"); credentialId = identifier(rawCredentialId, "credential id"); normalizedDevice = deviceId(rawDeviceId); suppliedSignature = signature(rawSignature); }
    catch { return undefined; }
    const row = this.db.connection.prepare("SELECT * FROM nusa_owner_device_credential_challenges WHERE challenge_id=? AND purpose=? AND credential_id=? AND device_id_hash=? AND consumed_at IS NULL AND expires_at>? AND actor_owner_user_id IS ?")
      .get(challengeId, purpose, credentialId, hash(normalizedDevice), now, expectedActorOwnerUserId ?? null) as Record<string, unknown> | undefined;
    if (row == null) return undefined;
    const bytes = ownerDeviceCredentialChallengeBytes({ challengeId, nonce: String(row.nonce), purpose, credentialId, deviceId: normalizedDevice, serverContext: this.serverContext, expiresAt: Number(row.expires_at) });
    let valid = false;
    try { valid = verify("sha256", bytes, createPublicKey({ key: Buffer.from(String(row.public_key_spki), "base64"), format: "der", type: "spki" }), suppliedSignature); } catch { return undefined; }
    if (!valid) return undefined;
    const consumed = this.db.connection.prepare("UPDATE nusa_owner_device_credential_challenges SET consumed_at=? WHERE challenge_id=? AND purpose=? AND credential_id=? AND device_id_hash=? AND consumed_at IS NULL AND expires_at>? AND actor_owner_user_id IS ?")
      .run(now, challengeId, purpose, credentialId, hash(normalizedDevice), now, expectedActorOwnerUserId ?? null);
    if (Number(consumed.changes) !== 1) return undefined;
    return Object.freeze({ credential_id: String(row.credential_id), device_id_hash: String(row.device_id_hash), public_key_spki: String(row.public_key_spki), actor_owner_user_id: row.actor_owner_user_id == null ? "" : String(row.actor_owner_user_id) });
  }

  private expireChallenges(now: number): void { this.db.connection.prepare("DELETE FROM nusa_owner_device_credential_challenges WHERE expires_at<=? OR consumed_at IS NOT NULL").run(now); }
}
