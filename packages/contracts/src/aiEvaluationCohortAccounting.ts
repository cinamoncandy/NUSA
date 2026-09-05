/** Immutable eligible-cohort accounting for WO-AI-011. */
export type CohortRecordStatus = "RESOLVED" | "UNRESOLVED" | "CENSORED" | "ABSTAINED" | "DELISTED" | "BANKRUPT" | "STALE" | "PROVIDER_MISSING";
export interface CohortRecord { readonly predictionId: string; readonly status: CohortRecordStatus; }
export type CohortAccountingResult = { readonly resolved: true; readonly totalCohortSize: number; readonly resolvedCount: number; readonly statusCounts: Readonly<Record<CohortRecordStatus, number>>; readonly coverageRatio: number } | { readonly resolved: false; readonly reason: "EMPTY_COHORT" | "DUPLICATE_PREDICTION_ID" };
const ALL_STATUSES: readonly CohortRecordStatus[] = ["RESOLVED","UNRESOLVED","CENSORED","ABSTAINED","DELISTED","BANKRUPT","STALE","PROVIDER_MISSING"];
export function computeCohortAccounting(records: readonly CohortRecord[]): CohortAccountingResult {
  if (records.length===0) return {resolved:false,reason:"EMPTY_COHORT"};
  const seen=new Set<string>(); for(const r of records){ if(seen.has(r.predictionId)) return {resolved:false,reason:"DUPLICATE_PREDICTION_ID"}; seen.add(r.predictionId); }
  const statusCounts=Object.fromEntries(ALL_STATUSES.map((s)=>[s,0])) as Record<CohortRecordStatus,number>;
  for(const r of records) statusCounts[r.status]+=1;
  return {resolved:true,totalCohortSize:records.length,resolvedCount:statusCounts.RESOLVED,statusCounts:Object.freeze(statusCounts),coverageRatio:statusCounts.RESOLVED/records.length};
}
export function isFullCohortAccountedFor(fullCohortIds: readonly string[], records: readonly CohortRecord[]): boolean {
  if(fullCohortIds.length===0) return false;
  const counts=new Map<string,number>(); for(const r of records) counts.set(r.predictionId,(counts.get(r.predictionId)??0)+1);
  return fullCohortIds.every((id)=>counts.get(id)===1);
}
