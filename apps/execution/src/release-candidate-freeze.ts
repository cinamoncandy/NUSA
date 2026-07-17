import { SyntheticCertificationReportDecision, type SyntheticCertificationReport } from "./synthetic-certification-report";

export enum ReleaseCandidateFreezeDecision { FROZEN="FROZEN", BLOCKED="BLOCKED" }
export interface ReleaseCandidateFreezeInput { readonly candidateId:string;readonly frozenHeadSha:string;readonly currentHeadSha:string;readonly report:SyntheticCertificationReport;readonly openCriticalFindings:number;readonly openHighFindings:number;readonly generatedArtifactsClean:boolean;readonly nowMs:number; }
export interface ReleaseCandidateFreezeResult { readonly candidateId:string;readonly decision:ReleaseCandidateFreezeDecision;readonly productionMutationAllowed:false;readonly blockers:readonly string[];readonly frozenHeadSha:string;readonly evaluatedAtMs:number; }
export function evaluateReleaseCandidateFreeze(input:ReleaseCandidateFreezeInput):ReleaseCandidateFreezeResult{
 if(!input.candidateId.trim()||!input.frozenHeadSha.trim()||!input.currentHeadSha.trim()||!Number.isSafeInteger(input.nowMs)||input.nowMs<0)throw new Error("valid release candidate identity and time are required");
 if(!Number.isSafeInteger(input.openCriticalFindings)||input.openCriticalFindings<0||!Number.isSafeInteger(input.openHighFindings)||input.openHighFindings<0)throw new Error("release candidate finding counts are invalid");
 const blockers:string[]=[];
 if(input.frozenHeadSha!==input.currentHeadSha)blockers.push("HEAD_CHANGED_AFTER_FREEZE");
 if(input.report.decision!==SyntheticCertificationReportDecision.PASS_SYNTHETIC_BASELINE)blockers.push("SYNTHETIC_CERTIFICATION_NOT_PASSING");
 if(input.openCriticalFindings>0)blockers.push("OPEN_CRITICAL_FINDINGS");
 if(input.openHighFindings>0)blockers.push("OPEN_HIGH_FINDINGS");
 if(!input.generatedArtifactsClean)blockers.push("GENERATED_ARTIFACTS_DIRTY");
 return Object.freeze({candidateId:input.candidateId,decision:blockers.length?ReleaseCandidateFreezeDecision.BLOCKED:ReleaseCandidateFreezeDecision.FROZEN,productionMutationAllowed:false,blockers:Object.freeze(blockers.sort()),frozenHeadSha:input.frozenHeadSha,evaluatedAtMs:input.nowMs});
}
