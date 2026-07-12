export interface VersionProvenanceInput {
  readonly generatedAt: number;
  readonly gitSha: string;
  readonly datasetSha256: string;
  readonly runtimeVersion: string;
  readonly researchVersion: string;
  readonly committeeVersion: string;
}

export interface VersionProvenance extends VersionProvenanceInput {
  readonly schemaVersion: 1;
}

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{7,40}$/;

export function buildVersionProvenance(input: VersionProvenanceInput): VersionProvenance {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) throw new Error("generatedAt must be a non-negative safe integer");
  if (!GIT_SHA.test(input.gitSha)) throw new Error("gitSha is invalid");
  if (!SHA256.test(input.datasetSha256)) throw new Error("datasetSha256 is invalid");
  for (const [field, value] of Object.entries({ runtimeVersion: input.runtimeVersion, researchVersion: input.researchVersion, committeeVersion: input.committeeVersion })) {
    if (!value.trim()) throw new Error(`${field} is required`);
  }
  return Object.freeze({ schemaVersion: 1 as const, ...input });
}
