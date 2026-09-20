import type { DatabaseSync } from "node:sqlite";
import type { ResearchIntelligenceRecord } from "../../contracts/src/researchIntelligence";
import { canonicalResearchJson } from "../../contracts/src/researchRuntime";
import { researchMemoryArtifactDigestV1 } from "../../contracts/src/researchMemorySemantics";
import { SqliteResearchSemanticMemoryRepository } from "./researchMemorySemantics";

export interface ResearchIntelligenceMemoryDatabase {
  readonly connection: DatabaseSync;
  transaction<T>(fn: () => T): T;
}

const decode = (row: Record<string, unknown>): ResearchIntelligenceRecord =>
  JSON.parse(String(row.payload_json)) as ResearchIntelligenceRecord;

function validateStoredRow(
  row: Record<string, unknown>,
  record: ResearchIntelligenceRecord,
): void {
  if (
    String(row.record_id) !== record.recordId ||
    String(row.source_id) !== record.sourceId ||
    String(row.source_type) !== record.sourceType ||
    String(row.content_fingerprint) !== record.contentFingerprint ||
    String(row.hypothesis_semantic_fingerprint) !== (record.hypothesisSemanticFingerprint ?? "") ||
    String(row.discovered_at) !== record.discoveredAt ||
    record.authority !== "PAPER_ONLY" ||
    record.liveAuthority !== "NONE" ||
    record.productionMutationAllowed !== false ||
    record.aiAuthority !== "ZERO_AUTHORITY"
  ) {
    throw new Error("research intelligence persisted row integrity violation");
  }
}

export class SqliteResearchIntelligenceMemoryRepository {
  private readonly semantic: SqliteResearchSemanticMemoryRepository;

  public constructor(private readonly db: ResearchIntelligenceMemoryDatabase) {
    this.semantic = new SqliteResearchSemanticMemoryRepository(db);
  }

  public list(): readonly ResearchIntelligenceRecord[] {
    const rows = this.db.connection.prepare(
      "SELECT record_id, source_id, source_type, content_fingerprint, hypothesis_semantic_fingerprint, discovered_at, payload_json FROM research_intelligence_records ORDER BY discovered_at ASC, source_id ASC, record_id ASC"
    ).all() as Record<string, unknown>[];
    return Object.freeze(rows.map((row) => {
      const record = decode(row);
      validateStoredRow(row, record);
      return Object.freeze(record);
    }));
  }

  public append(record: ResearchIntelligenceRecord): ResearchIntelligenceRecord {
    return this.db.transaction(() => {
      const existingRow = this.db.connection.prepare(
        "SELECT record_id, source_id, source_type, content_fingerprint, hypothesis_semantic_fingerprint, discovered_at, payload_json FROM research_intelligence_records WHERE record_id = ?"
      ).get(record.recordId) as Record<string, unknown> | undefined;

      if (existingRow != null) {
        const existing = decode(existingRow);
        validateStoredRow(existingRow, existing);
        if (canonicalResearchJson(existing) !== canonicalResearchJson(record)) {
          throw new Error("research intelligence record identity conflict");
        }
        return existing;
      }

      this.db.connection.prepare(
        "INSERT INTO research_intelligence_records (record_id, source_id, source_type, content_fingerprint, hypothesis_semantic_fingerprint, discovered_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(
        record.recordId,
        record.sourceId,
        record.sourceType,
        record.contentFingerprint,
        record.hypothesisSemanticFingerprint ?? "",
        record.discoveredAt,
        JSON.stringify(record),
      );

      this.semantic.appendSemantic({
        artifact: Object.freeze({
          artifactKind: "RESEARCH_INTELLIGENCE_RECORD" as const,
          artifactId: record.recordId,
          artifactContentSha256: researchMemoryArtifactDigestV1(record),
          artifactDigestKind: "CANONICAL_RESEARCH_INTELLIGENCE_SHA256_V1" as const,
        }),
        semanticClass: "OBSERVATION",
        validity: "REVALIDATION_REQUIRED",
        attribution: "MIXED_UNRESOLVED",
        evidenceOrigin:
          record.sourceVerification === "VERIFIED_PRIMARY_SOURCE"
            ? "EXTERNAL_PRIMARY_SOURCE"
            : "UNKNOWN_UNTRUSTED",
        evaluatorSemanticsId: "research-intelligence-scout:v1",
        semanticIdentity: record.hypothesisSemanticFingerprint ?? record.contentFingerprint,
        independenceGroupId: record.sourceType + ":" + record.sourceId,
        actor: "research-intelligence-scout",
        source: record.sourceUrl,
        reason:
          "External research discovery retained for longitudinal deduplication; it is not canonical NUSA empirical evidence.",
        occurredAt: record.discoveredAt,
        authority: "PAPER_ONLY",
        liveAuthority: "NONE",
        productionMutationAllowed: false,
        aiAuthority: "ZERO_AUTHORITY",
      });

      return record;
    });
  }
}
