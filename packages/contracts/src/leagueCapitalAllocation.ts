export interface LeagueCapitalAllocationPolicy {
  readonly maximumCandidateWeight: number;
  readonly minimumEvidenceBreadth: number;
  readonly maximumCandidateCount: number;
  readonly maximumFamilyWeight: number;
}

export interface LeagueCapitalAllocationEntry {
  readonly id: string;
  readonly familyId: string;
  readonly rank: number;
  readonly leagueScore: number;
  readonly evidenceBreadth: number;
  readonly researchWeight: number;
  readonly reasons: readonly string[];
  readonly sourceDatasetIds: readonly string[];
}

export interface LeagueCapitalAllocationAdvisory {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly policy: LeagueCapitalAllocationPolicy;
  readonly entries: readonly LeagueCapitalAllocationEntry[];
  readonly excludedCandidateIds: readonly string[];
  readonly reasons: readonly string[];
  readonly provenance: Readonly<{ sourceDatasetIds: readonly string[] }>;
}
