import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { OpportunitySchedule } from "../../../cloud/src/opportunityScheduler";
import { validateOpportunitySchedule } from "../cloud/opportunityDashboardProjection";

export function appendOpportunitySchedule(db: DatabaseSync, transaction: <T>(operation: () => T) => T, input: Readonly<{ scheduleId: string; source: string; generatedAt: number; schedule: OpportunitySchedule }>): void {
  if (!input.scheduleId.trim() || !input.source.trim() || !Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) throw new Error("opportunity schedule identity is invalid");
  validateOpportunitySchedule(input.schedule);
  const payload = JSON.stringify(input.schedule);
  const payloadChecksum = createHash("sha256").update(payload, "utf8").digest("hex");
  transaction(() => {
    const existing = db.prepare("SELECT source, generated_at, payload, payload_checksum FROM desktop_opportunity_schedules WHERE schedule_id = ?").get(input.scheduleId) as { source: string; generated_at: number; payload: string; payload_checksum: string } | undefined;
    if (existing != null) {
      if (existing.source !== input.source || existing.generated_at !== input.generatedAt || existing.payload !== payload || existing.payload_checksum !== payloadChecksum) throw new Error("opportunity schedule identity conflict");
      return;
    }
    db.prepare("INSERT INTO desktop_opportunity_schedules (schedule_id, source, generated_at, payload, payload_checksum) VALUES (?, ?, ?, ?, ?)").run(input.scheduleId, input.source, input.generatedAt, payload, payloadChecksum);
  });
}

export function loadLatestOpportunitySchedule(db: DatabaseSync): Readonly<{ scheduleId: string; source: string; generatedAt: number; schedule: OpportunitySchedule }> | undefined {
  const row = db.prepare("SELECT schedule_id, source, generated_at, payload, payload_checksum FROM desktop_opportunity_schedules ORDER BY generated_at DESC, schedule_id DESC LIMIT 1").get() as { schedule_id: string; source: string; generated_at: number; payload: string; payload_checksum: string } | undefined;
  if (row == null) return undefined;
  const checksum = createHash("sha256").update(row.payload, "utf8").digest("hex");
  if (checksum !== row.payload_checksum) throw new Error("opportunity schedule checksum mismatch");
  const schedule = JSON.parse(row.payload) as OpportunitySchedule;
  validateOpportunitySchedule(schedule);
  return Object.freeze({ scheduleId: row.schedule_id, source: row.source, generatedAt: Number(row.generated_at), schedule: Object.freeze(schedule) });
}
