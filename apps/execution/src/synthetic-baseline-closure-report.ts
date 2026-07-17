import { SyntheticReleaseStatusDecision, type SyntheticReleaseStatusResult } from "./synthetic-release-status";
import { type CertificationSnapshot } from "./certification-snapshot";

export enum SyntheticBaselineClosureDecision { CLOSED_SYNTHETIC_BASELINE="CLOSED_SYNTHETIC_BASELINE", OPEN_FINDINGS="OPEN_FINDINGS" }
export interface SyntheticBaselineClosureReport { readonly reportId:string;readonly candidateId:string;readonly decision:SyntheticBaselineClosureDecision;readonly snapshotHash:string|null;readonly limitations:readonly string[];readonly blockers:readonly string[];readonly deploymentAllowed:false;readonly productionMutationAllowed:false;readonly generatedAtMs:number; }
export function createSyntheticBaselineClosureReport(input:{readonly reportId:string;readonly candidateId:string;readonly status:SyntheticReleaseStatusResult;readonly snapshot?:CertificationSnapshot;readonly ciEvidencePresent:boolean;readonly unresolvedCriticalOrHighFindings:number;readonly nowMs:number;}):SyntheticBaselineClosureReport{
 if(!input.reportId.trim()||!input.candidateId.trim()||!Number.isSafeInteger(input.nowMs)||input.nowMs<0||!Number.isSafeInteger(input.unresolvedCriticalOrHighFindings)||input.unresolvedCriticalOrHighFindings<0)throw new Error("valid closure report context is required");
 const blockers:string[]=[];
 if(input.status.candidateId!==input.candidateId)blockers.push("STATUS_CANDIDATE_MISMATCH");
 if(input.status.decision!==SyntheticReleaseStatusDecision.ACTIVE_SYNTHETIC_ONLY)blockers.push("SYNTHETIC_RELEASE_NOT_ACTIVE");
 if(!input.snapshot)blockers.push("CERTIFICATION_SNAPSHOT_MISSING");
 if(input.snapshot&&input.snapshot.candidateId!==input.candidateId)blockers.push("SNAPSHOT_CANDIDATE_MISMATCH");
 if(input.unresolvedCriticalOrHighFindings>0)blockers.push("CRITICAL_OR_HIGH_FINDINGS_OPEN");
 if(!input.ciEvidencePresent)blockers.push("CI_EVIDENCE_MISSING");
 const limitations=["SYNTHETIC_ONLY","DETERMINISTIC_CERTIFICATION_BASELINE","NO_PRODUCTION_ENDPOINT_ATTESTED","NO_PRODUCTION_CREDENTIALS_ATTESTED","PRODUCTION_MUTATION_HARD_BLOCKED"];
 return Object.freeze({reportId:input.reportId,candidateId:input.candidateId,decision:blockers.length?SyntheticBaselineClosureDecision.OPEN_FINDINGS:SyntheticBaselineClosureDecision.CLOSED_SYNTHETIC_BASELINE,snapshotHash:input.snapshot?.snapshotHash??null,limitations:Object.freeze(limitations),blockers:Object.freeze([...new Set(blockers)].sort()),deploymentAllowed:false,productionMutationAllowed:false,generatedAtMs:input.nowMs});
}
