import type { VersionProvenance } from "./versionProvenance";

export interface EvidenceItem {
  readonly name: string;
  readonly generatedAt: number;
  readonly sha256: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface EvidenceBundle {
  readonly schemaVersion: 1;
  readonly bundleId: string;
  readonly generatedAt: number;
  readonly provenance: VersionProvenance;
  readonly items: readonly EvidenceItem[];
  readonly complete: boolean;
  readonly missing: readonly string[];
}

const REQUIRED = ["runtime", "health", "recorder", "replay", "incident", "snapshot", "audit", "paper-validation"] as const;
const SHA256 = /^[a-f0-9]{64}$/;

const freeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
};

export function buildEvidenceBundle(bundleId: string, generatedAt: number, provenance: VersionProvenance, items: readonly EvidenceItem[]): EvidenceBundle {
  if (!bundleId.trim()) throw new Error("bundleId is required");
  if (!Number.isSafeInteger(generatedAt) || generatedAt < 0) throw new Error("generatedAt must be a non-negative safe integer");
  if (new Set(items.map((item) => item.name)).size !== items.length) throw new Error("evidence item names must be unique");
  for (const item of items) {
    if (!item.name.trim()) throw new Error("evidence item name is required");
    if (!Number.isSafeInteger(item.generatedAt) || item.generatedAt < 0 || item.generatedAt > generatedAt) throw new Error(`${item.name}.generatedAt is invalid`);
    if (!SHA256.test(item.sha256)) throw new Error(`${item.name}.sha256 is invalid`);
  }
  const missing = REQUIRED.filter((name) => !items.some((item) => item.name === name));
  return freeze({
    schemaVersion: 1 as const,
    bundleId: bundleId.trim(),
    generatedAt,
    provenance,
    items: items.map((item) => ({ ...item, payload: { ...item.payload } })),
    complete: missing.length === 0,
    missing
  });
}
