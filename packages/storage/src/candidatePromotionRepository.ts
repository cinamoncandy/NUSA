import { createHash } from "node:crypto";
import type { CandidateLifecycleRecord, PromotionAuditRecord, PromotionCommand, PromotionResult, ResearchCandidateIdentity } from "../../contracts/src/candidatePromotion";
import { canonicalResearchJson } from "../../contracts/src/researchRuntime";

export interface CandidatePromotionDatabase {
  readonly connection: { prepare(sql: string): { get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[]; run(...params: unknown[]): unknown }; };
  transaction<T>(fn: () => T): T;
}

const genesis = "0".repeat(64);
const json = (value: unknown): string => JSON.stringify(value);
const hash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const fingerprint = (value: unknown): string => hash(canonicalResearchJson(value));

function validateIdentity(identity: ResearchCandidateIdentity): void {
  if (!identity.candidateId.trim() || !identity.strategyId.trim() || !identity.strategyVersion.trim() || !identity.originatingEvaluationId.trim()) throw new Error("candidate identity is incomplete");
  for (const value of [identity.artifactHash, identity.configHash, identity.originatingInputHash]) if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("candidate hash is invalid");
  if (!Number.isSafeInteger(identity.createdAt) || identity.createdAt < 0 || identity.authority !== "PAPER_ONLY" || identity.paperOnly !== true) throw new Error("candidate authority invariant failed");
}

export interface PromotionAtomicInput {
  readonly command: PromotionCommand;
  readonly candidate: CandidateLifecycleRecord;
  readonly previousCandidate: CandidateLifecycleRecord | null;
  readonly result: PromotionResult;
  readonly audit: PromotionAuditRecord;
}

export interface PromotionCommandState {
  readonly commandId: string;
  readonly payloadFingerprint: string;
  readonly result: PromotionResult;
}

export class SqliteCandidatePromotionRepository {
  public constructor(private readonly db: CandidatePromotionDatabase) {}

  public saveCandidate(record: CandidateLifecycleRecord): void {
    if (record.lifecycle === "CHAMPION" || record.lifecycle === "CHALLENGER") throw new Error("privileged candidate lifecycle requires atomic promotion boundary");
    this.upsertCandidate(record);
  }

  private upsertCandidate(record: CandidateLifecycleRecord): void {
    validateIdentity(record.identity);
    const stored = this.getCandidate(record.identity.candidateId);
    const payload = json(record);
    if (stored != null) {
      if (fingerprint(stored.identity) !== fingerprint(record.identity)) throw new Error("candidate identity conflict");
      this.db.connection.prepare("UPDATE research_candidates SET payload_json = ?, lifecycle = ?, checksum = ? WHERE candidate_id = ?").run(payload, record.lifecycle, hash(payload), record.identity.candidateId);
      return;
    }
    this.db.connection.prepare("INSERT INTO research_candidates (candidate_id, payload_json, lifecycle, created_at, checksum) VALUES (?, ?, ?, ?, ?)").run(record.identity.candidateId, payload, record.lifecycle, record.identity.createdAt, hash(payload));
  }

  public getCandidate(candidateId: string): CandidateLifecycleRecord | null {
    const row = this.db.connection.prepare("SELECT payload_json, lifecycle, checksum FROM research_candidates WHERE candidate_id = ?").get(candidateId) as { payload_json: string; lifecycle: string; checksum: string } | undefined;
    if (row == null) return null;
    if (hash(row.payload_json) !== row.checksum) throw new Error("candidate lifecycle integrity violation");
    const record = JSON.parse(row.payload_json) as CandidateLifecycleRecord;
    validateIdentity(record.identity);
    if (record.lifecycle !== row.lifecycle) throw new Error("candidate lifecycle integrity violation");
    return Object.freeze(record);
  }

  public listCandidates(): readonly CandidateLifecycleRecord[] {
    return Object.freeze((this.db.connection.prepare("SELECT candidate_id FROM research_candidates ORDER BY candidate_id ASC").all() as Array<{ candidate_id: string }>).map((row) => this.getCandidate(row.candidate_id)!));
  }

  public getChampion(): string | null {
    const row = this.db.connection.prepare("SELECT candidate_id FROM research_champion_pointer WHERE id = 1").get() as { candidate_id: string | null } | undefined;
    return row?.candidate_id ?? null;
  }

  public getCommand(commandId: string): { fingerprint: string; result: PromotionResult } | null {
    const row = this.db.connection.prepare("SELECT payload_fingerprint, result_json FROM research_promotion_commands WHERE command_id = ?").get(commandId) as { payload_fingerprint: string; result_json: string } | undefined;
    return row == null ? null : { fingerprint: row.payload_fingerprint, result: Object.freeze(JSON.parse(row.result_json) as PromotionResult) };
  }

  public listCommands(): readonly PromotionCommandState[] {
    return Object.freeze((this.db.connection.prepare("SELECT command_id, payload_fingerprint, result_json FROM research_promotion_commands ORDER BY command_id ASC").all() as Array<{ command_id: string; payload_fingerprint: string; result_json: string }>).map((row) => {
      if (!/^[a-f0-9]{64}$/.test(row.payload_fingerprint)) throw new Error("promotion command fingerprint is invalid");
      const result = JSON.parse(row.result_json) as PromotionResult;
      if (!row.command_id.trim() || !["PROMOTED", "REJECTED", "CONFLICT", "DUPLICATE"].includes(result.status) || result.promotionCommandId !== row.command_id || result.productionMutationAllowed !== false || result.liveAuthority !== "NONE") throw new Error("promotion command state is invalid");
      return Object.freeze({ commandId: row.command_id, payloadFingerprint: row.payload_fingerprint, result: Object.freeze(result) });
    }));
  }

  public recordRejected(command: PromotionCommand, result: PromotionResult, audit: PromotionAuditRecord): void {
    this.db.transaction(() => {
      const existing = this.getCommand(command.promotionCommandId);
      if (existing != null) {
        if (existing.fingerprint !== fingerprint(command)) throw new Error("promotion command id conflict");
        return;
      }
      this.db.connection.prepare("INSERT INTO research_promotion_commands (command_id, payload_fingerprint, result_json, created_at) VALUES (?, ?, ?, ?)").run(command.promotionCommandId, fingerprint(command), json(result), command.requestedAt);
      this.appendAuditInTransaction(audit);
    });
  }

  public promoteAtomic(input: PromotionAtomicInput): void {
    validateIdentity(input.candidate.identity);
    if (input.candidate.lifecycle !== "CHAMPION") throw new Error("atomic promotion requires CHAMPION lifecycle");
    if (input.previousCandidate != null && input.previousCandidate.lifecycle !== "CHALLENGER") throw new Error("atomic promotion previous lifecycle must be CHALLENGER");
    this.db.transaction(() => {
      const current = this.getChampion();
      if (current !== input.command.expectedCurrentChampionCandidateId) throw new Error("champion compare-and-set conflict");
      const existing = this.getCommand(input.command.promotionCommandId);
      if (existing != null) {
        if (existing.fingerprint !== fingerprint(input.command)) throw new Error("promotion command id conflict");
        return;
      }
      const candidate = this.getCandidate(input.candidate.identity.candidateId);
      if (candidate == null) throw new Error("candidate not found");
      if (fingerprint(candidate.identity) !== fingerprint(input.candidate.identity)) throw new Error("candidate identity conflict");
      if (input.previousCandidate != null) this.upsertCandidate(input.previousCandidate);
      this.upsertCandidate(input.candidate);
      this.db.connection.prepare("INSERT INTO research_champion_pointer (id, candidate_id, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET candidate_id = excluded.candidate_id, updated_at = excluded.updated_at").run(input.result.resultingChampionCandidateId, input.command.requestedAt);
      this.db.connection.prepare("INSERT INTO research_promotion_commands (command_id, payload_fingerprint, result_json, created_at) VALUES (?, ?, ?, ?)").run(input.command.promotionCommandId, fingerprint(input.command), json(input.result), input.command.requestedAt);
      this.appendAuditInTransaction(input.audit);
    });
  }

  public appendRejectedAudit(audit: PromotionAuditRecord): void { this.db.transaction(() => this.appendAuditInTransaction(audit)); }

  private appendAuditInTransaction(audit: PromotionAuditRecord): void {
    const prior = this.db.connection.prepare("SELECT current_hash FROM research_promotion_audit ORDER BY sequence DESC LIMIT 1").get() as { current_hash: string } | undefined;
    const previousHash = prior?.current_hash ?? genesis;
    if (audit.previousAuditHash !== previousHash) throw new Error("promotion audit chain conflict");
    const record = { ...audit, previousAuditHash: previousHash, currentAuditHash: "" };
    const currentHash = hash(`${previousHash}\n${json(record)}`);
    this.db.connection.prepare("INSERT INTO research_promotion_audit (sequence, command_id, previous_hash, record_json, current_hash) VALUES ((SELECT COALESCE(MAX(sequence), 0) + 1 FROM research_promotion_audit), ?, ?, ?, ?)").run(audit.promotionCommandId, previousHash, json({ ...record, currentAuditHash: currentHash }), currentHash);
  }

  public listAudit(): readonly PromotionAuditRecord[] {
    const rows = this.db.connection.prepare("SELECT sequence, previous_hash, record_json, current_hash FROM research_promotion_audit ORDER BY sequence ASC").all() as Array<{ sequence: number; previous_hash: string; record_json: string; current_hash: string }>;
    let previous = genesis;
    return Object.freeze(rows.map((row) => {
      const record = JSON.parse(row.record_json) as PromotionAuditRecord;
      if (row.previous_hash !== previous || record.previousAuditHash !== previous || record.currentAuditHash !== row.current_hash || hash(`${previous}\n${json({ ...record, currentAuditHash: "" })}`) !== row.current_hash) throw new Error("promotion audit integrity violation");
      previous = row.current_hash;
      return Object.freeze(record);
    }));
  }

  public verifyAudit(): void { this.listAudit(); }
}
