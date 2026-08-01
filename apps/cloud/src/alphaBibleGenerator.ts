import { createHash } from "node:crypto";
import type { AlphaEvidenceRegistrySnapshot, AlphaRecord, EvidenceRelation } from "./alphaEvidenceRegistry";

export interface AlphaBibleEvidenceSummary {
  readonly evidenceId: string;
  readonly relation: EvidenceRelation;
  readonly confidence: number;
  readonly source: string;
  readonly experimentId: string;
  readonly summary: string;
}

export interface AlphaBibleEntry {
  readonly alphaId: string;
  readonly version: number;
  readonly name: string;
  readonly category: string;
  readonly status: string;
  readonly owner: string;
  readonly markets: readonly string[];
  readonly horizon: string;
  readonly capacityUsd: number | null;
  readonly halfLifeDays: number | null;
  readonly evidenceGrade: string;
  readonly riskClass: string;
  readonly dependencyAlphaIds: readonly string[];
  readonly versionHistory: readonly number[];
  readonly supports: number;
  readonly rejects: number;
  readonly neutral: number;
  readonly evidence: readonly AlphaBibleEvidenceSummary[];
}

export interface AlphaBibleDocument {
  readonly sourceSnapshotHash: string;
  readonly generatedAt: string;
  readonly entries: readonly AlphaBibleEntry[];
  readonly markdown: string;
  readonly contentHash: string;
}

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
};
const hash = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");
const parseTime = (value: string, label: string): number => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be a valid ISO timestamp`);
  return timestamp;
};
const latestById = (alphas: readonly AlphaRecord[]): readonly AlphaRecord[] => {
  const latest = new Map<string, AlphaRecord>();
  for (const alpha of alphas) {
    const current = latest.get(alpha.alphaId);
    if (!current || alpha.version > current.version) latest.set(alpha.alphaId, alpha);
  }
  return [...latest.values()].sort((a, b) => a.alphaId.localeCompare(b.alphaId));
};
const money = (value: number | null): string => value === null ? "Unknown" : `$${Math.round(value).toLocaleString("en-US")}`;
const days = (value: number | null): string => value === null ? "Unknown" : `${value} days`;

export const generateAlphaBible = (registry: AlphaEvidenceRegistrySnapshot, generatedAt: string): AlphaBibleDocument => {
  if (!/^[a-f0-9]{64}$/.test(registry.snapshotHash)) throw new Error("registry snapshotHash must be lowercase SHA-256");
  if (parseTime(generatedAt, "generatedAt") < parseTime(registry.generatedAt, "registry.generatedAt")) {
    throw new Error("Alpha Bible cannot be generated before its registry snapshot");
  }
  const evidenceById = new Map(registry.evidence.map((item) => [item.evidenceId, item]));
  const versionsByAlpha = new Map<string, number[]>();
  for (const alpha of registry.alphas) versionsByAlpha.set(alpha.alphaId, [...(versionsByAlpha.get(alpha.alphaId) ?? []), alpha.version]);

  const entries = latestById(registry.alphas).map((alpha): AlphaBibleEntry => {
    const linked = registry.links
      .filter((link) => link.alphaId === alpha.alphaId && link.alphaVersion === alpha.version)
      .map((link) => {
        const item = evidenceById.get(link.evidenceId);
        if (!item) throw new Error(`missing evidence ${link.evidenceId}`);
        return Object.freeze({
          evidenceId: item.evidenceId,
          relation: link.relation,
          confidence: item.confidence,
          source: item.source,
          experimentId: item.experimentId,
          summary: item.summary
        });
      })
      .sort((a, b) => a.relation.localeCompare(b.relation) || b.confidence - a.confidence || a.evidenceId.localeCompare(b.evidenceId));
    const count = (relation: EvidenceRelation): number => linked.filter((item) => item.relation === relation).length;
    return Object.freeze({
      alphaId: alpha.alphaId,
      version: alpha.version,
      name: alpha.name,
      category: alpha.category,
      status: alpha.status,
      owner: alpha.owner,
      markets: Object.freeze([...alpha.markets]),
      horizon: alpha.horizon,
      capacityUsd: alpha.capacityUsd,
      halfLifeDays: alpha.halfLifeDays,
      evidenceGrade: alpha.evidenceGrade,
      riskClass: alpha.riskClass,
      dependencyAlphaIds: Object.freeze([...alpha.dependencyAlphaIds]),
      versionHistory: Object.freeze([...(versionsByAlpha.get(alpha.alphaId) ?? [])].sort((a, b) => a - b)),
      supports: count("SUPPORTS"),
      rejects: count("REJECTS"),
      neutral: count("NEUTRAL"),
      evidence: Object.freeze(linked)
    });
  });

  const sections = entries.map((entry) => {
    const evidenceLines = entry.evidence.length === 0
      ? "- No linked evidence"
      : entry.evidence.map((item) => `- ${item.relation} | ${item.evidenceId} | confidence ${item.confidence.toFixed(2)} | ${item.summary}`).join("\n");
    return `## ${entry.alphaId} — ${entry.name}\n\n- Version: ${entry.version}\n- Status: ${entry.status}\n- Category: ${entry.category}\n- Owner: ${entry.owner}\n- Markets: ${entry.markets.join(", ") || "None"}\n- Horizon: ${entry.horizon}\n- Capacity: ${money(entry.capacityUsd)}\n- Half-life: ${days(entry.halfLifeDays)}\n- Evidence grade: ${entry.evidenceGrade}\n- Risk class: ${entry.riskClass}\n- Evidence count: ${entry.supports} support / ${entry.rejects} reject / ${entry.neutral} neutral\n\n### Evidence\n${evidenceLines}`;
  });
  const markdown = `# NUSA Alpha Bible\n\nGenerated: ${generatedAt}\nSource snapshot: ${registry.snapshotHash}\nAlpha count: ${entries.length}\n\n${sections.join("\n\n")}`;
  const payload = { sourceSnapshotHash: registry.snapshotHash, generatedAt, entries: Object.freeze(entries), markdown };
  return Object.freeze({ ...payload, contentHash: hash(payload) });
};
