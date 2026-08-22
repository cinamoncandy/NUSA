import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { OwnerReviewRecord } from "../../../cloud/src/releaseEvidenceDashboard";

export function appendOwnerReview(db: DatabaseSync, transaction: <T>(operation: () => T) => T, record: OwnerReviewRecord, currentBundleStatus: "BLOCKED" | "READY_FOR_OWNER_REVIEW" | "APPROVED"): void {
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(record.reviewerId)) throw new Error("reviewer id must be a local owner alias");
  if (!/^[a-f0-9]{64}$/i.test(record.bundleChecksum) || !/^[a-f0-9]{64}$/i.test(record.recordChecksum)) throw new Error("review checksum is invalid");
  if (!["APPROVE", "REJECT", "REQUEST_MORE_EVIDENCE"].includes(record.decision)) throw new Error("review decision is invalid");
  if (record.decision === "APPROVE" && currentBundleStatus !== "READY_FOR_OWNER_REVIEW") throw new Error("approval requires READY_FOR_OWNER_REVIEW");
  const canonical = JSON.stringify({ reviewId: record.reviewId, bundleChecksum: record.bundleChecksum, reviewerId: record.reviewerId, decision: record.decision, note: record.note ?? null, reviewedAt: record.reviewedAt });
  const expectedChecksum = createHash("sha256").update(canonical, "utf8").digest("hex");
  if (record.recordChecksum !== expectedChecksum) throw new Error("review record checksum mismatch");
  transaction(() => {
    const existing = db.prepare("SELECT review_id, bundle_checksum, reviewer_id, decision, note, reviewed_at, record_checksum FROM desktop_owner_review_records WHERE review_id = ?").get(record.reviewId) as OwnerReviewRecord | undefined;
    if (existing != null) {
      if (JSON.stringify(existing) !== JSON.stringify(record)) throw new Error("review id conflict");
      return;
    }
    db.prepare("INSERT INTO desktop_owner_review_records (review_id, bundle_checksum, reviewer_id, decision, note, reviewed_at, record_checksum) VALUES (?, ?, ?, ?, ?, ?, ?)").run(record.reviewId, record.bundleChecksum, record.reviewerId, record.decision, record.note ?? null, record.reviewedAt, record.recordChecksum);
  });
}

export function loadOwnerReviews(db: DatabaseSync): readonly OwnerReviewRecord[] {
  const rows = db.prepare("SELECT review_id, bundle_checksum, reviewer_id, decision, note, reviewed_at, record_checksum FROM desktop_owner_review_records ORDER BY reviewed_at ASC, review_id ASC").all() as Array<Record<string, unknown>>;
  return Object.freeze(rows.map((row) => Object.freeze({
    reviewId: String(row.review_id),
    bundleChecksum: String(row.bundle_checksum),
    reviewerId: String(row.reviewer_id),
    decision: String(row.decision) as OwnerReviewRecord["decision"],
    note: row.note == null ? undefined : String(row.note),
    reviewedAt: String(row.reviewed_at),
    recordChecksum: String(row.record_checksum)
  })));
}
