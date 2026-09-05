import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { bindPaperCandidateForExecution } from "../../../packages/contracts/src/paperCandidateExecutionBinding";
import type { QualifiedPaperChallengerArtifact, QualifiedPaperChallengerArtifactReader } from "./paperChallengerDeploymentRuntime";
import { validatePaperResearchLineage } from "./paperResearchLineage";

interface StoredArtifact {
  readonly payload: QualifiedPaperChallengerArtifact;
  readonly sha256: string;
}

interface ArtifactFile {
  readonly schemaVersion: 1;
  readonly artifacts: readonly StoredArtifact[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const MARKET = /^KRW-[A-Z0-9-]+$/;
const safeText = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > 240) throw new Error(`${field} is invalid`);
  return normalized;
};
const digest = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
const keyOf = (artifact: QualifiedPaperChallengerArtifact): string => `${artifact.candidateId}\n${artifact.candidateVersion}`;

function normalizedPayload(artifact: QualifiedPaperChallengerArtifact): QualifiedPaperChallengerArtifact {
  const candidateId = safeText(artifact.candidateId, "candidateId");
  const candidateVersion = safeText(artifact.candidateVersion, "candidateVersion");
  const market = artifact.market.trim().toUpperCase();
  if (artifact.schemaVersion !== 1 || !MARKET.test(market)) throw new Error("qualified PAPER challenger artifact schema or market is invalid");
  if (artifact.liveAuthority !== "NONE" || artifact.productionMutationAllowed !== false || artifact.aiAuthority !== "ZERO_AUTHORITY") throw new Error("qualified PAPER challenger artifact authority is invalid");
  const researchDecisionReference = safeText(artifact.researchDecisionReference, "researchDecisionReference");
  const advisoryGeneratedAt = Date.parse(artifact.advisory.generatedAt);
  if (!Number.isSafeInteger(advisoryGeneratedAt) || advisoryGeneratedAt < 0 || advisoryGeneratedAt >= Number.MAX_SAFE_INTEGER) throw new Error("qualified PAPER challenger advisory timestamp is invalid");
  // Reuse the canonical candidate binding validator as the artifact provenance admission boundary.
  bindPaperCandidateForExecution(artifact.advisory, artifact.candidateProvenance, candidateId, advisoryGeneratedAt + 1);
  const researchLineage = artifact.researchLineage == null ? undefined : validatePaperResearchLineage(artifact.researchLineage);
  if (researchLineage != null && (
    researchLineage.candidateId !== candidateId
    || researchLineage.candidateVersion !== candidateVersion
    || researchLineage.researchDecisionReference !== researchDecisionReference
  )) throw new Error("qualified PAPER challenger Research lineage conflict");
  return Object.freeze({
    ...artifact,
    candidateId,
    candidateVersion,
    market,
    researchDecisionReference,
    candidateProvenance: Object.freeze([...artifact.candidateProvenance]),
    ...(researchLineage == null ? {} : { researchLineage }),
  });
}

function encode(artifact: QualifiedPaperChallengerArtifact): StoredArtifact {
  const payload = normalizedPayload(artifact);
  const serialized = JSON.stringify(payload);
  return Object.freeze({ payload, sha256: digest(serialized) });
}

function decode(value: StoredArtifact): QualifiedPaperChallengerArtifact {
  if (value == null || typeof value !== "object" || !SHA256.test(value.sha256)) throw new Error("qualified PAPER challenger artifact envelope is corrupted");
  const payload = normalizedPayload(value.payload);
  if (digest(JSON.stringify(payload)) !== value.sha256) throw new Error("qualified PAPER challenger artifact checksum mismatch");
  return payload;
}

export interface QualifiedPaperChallengerArtifactWriter {
  save(artifact: QualifiedPaperChallengerArtifact): QualifiedPaperChallengerArtifact;
}

/**
 * Durable immutable artifact store used between Research qualification and canonical PAPER
 * deployment. The file is owner-only and replaced atomically; candidate/version identity is
 * append-only. A replay with identical content is idempotent, while identity mutation fails closed.
 */
export class FileQualifiedPaperChallengerArtifactStore implements QualifiedPaperChallengerArtifactReader, QualifiedPaperChallengerArtifactWriter {
  public constructor(private readonly filename: string) {
    if (!filename.trim() || filename === ":memory:") throw new Error("qualified PAPER challenger artifact path must be durable");
  }

  private readFile(): ArtifactFile {
    if (!fs.existsSync(this.filename)) return Object.freeze({ schemaVersion: 1, artifacts: Object.freeze([]) });
    const stat = fs.statSync(this.filename);
    if (!stat.isFile()) throw new Error("qualified PAPER challenger artifact path is not a file");
    let parsed: ArtifactFile;
    try { parsed = JSON.parse(fs.readFileSync(this.filename, "utf8")) as ArtifactFile; }
    catch { throw new Error("qualified PAPER challenger artifact file is corrupted"); }
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.artifacts)) throw new Error("qualified PAPER challenger artifact file schema is invalid");
    const identities = new Set<string>();
    const artifacts = parsed.artifacts.map((entry) => {
      const payload = decode(entry);
      const key = keyOf(payload);
      if (identities.has(key)) throw new Error("qualified PAPER challenger artifact identity is duplicated");
      identities.add(key);
      return encode(payload);
    });
    return Object.freeze({ schemaVersion: 1, artifacts: Object.freeze(artifacts) });
  }

  public read(candidateId: string, candidateVersion: string): QualifiedPaperChallengerArtifact | undefined {
    const id = safeText(candidateId, "candidateId");
    const version = safeText(candidateVersion, "candidateVersion");
    const stored = this.readFile().artifacts.find((entry) => entry.payload.candidateId === id && entry.payload.candidateVersion === version);
    return stored == null ? undefined : decode(stored);
  }

  public save(artifact: QualifiedPaperChallengerArtifact): QualifiedPaperChallengerArtifact {
    const next = encode(artifact);
    const current = this.readFile();
    const key = keyOf(next.payload);
    const existing = current.artifacts.find((entry) => keyOf(entry.payload) === key);
    if (existing != null) {
      if (existing.sha256 !== next.sha256) throw new Error("qualified PAPER challenger artifact identity conflict");
      return decode(existing);
    }
    const directory = path.dirname(path.resolve(this.filename));
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const payload: ArtifactFile = Object.freeze({ schemaVersion: 1, artifacts: Object.freeze([...current.artifacts, next].sort((left, right) => keyOf(left.payload).localeCompare(keyOf(right.payload)))) });
    const temporary = `${this.filename}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600, flag: "w" });
    fs.renameSync(temporary, this.filename);
    try { fs.chmodSync(this.filename, 0o600); } catch { /* platform may not support POSIX mode; integrity remains checksum-bound */ }
    return next.payload;
  }
}
