import { BurnInDecision, type BurnInResult } from "./burn-in-harness";
import { ProductionReadinessDecision, type ProductionReadinessResult } from "./production-readiness";
import { FinalCertificationDecision, type FinalCertificationResult } from "./final-certification";
export enum SyntheticCertificationReportDecision { PASS_SYNTHETIC_BASELINE="PASS_SYNTHETIC_BASELINE", DEFER="DEFER", REJECT="REJECT" }
export interface SyntheticCertificationReport { readonly reportId:string;readonly decision:SyntheticCertificationReportDecision;readonly productionMutationAllowed:false;readonly blockers:readonly string[];readonly limitations:readonly string[];readonly generatedAtMs:number; }
export function createSyntheticCertificationReport(input:{readonly reportId:string;readonly readiness:ProductionReadinessResult;readonly burnIn:BurnInResult;readonly certification:FinalCertificationResult;readonly generatedAtMs:number;}):SyntheticCertificationReport{
 if(!input.reportId.trim()||!Number.isSafeInteger(input.generatedAtMs)||input.generatedAtMs<0)throw new Error("valid report identity and time are required");
 const blockers:string[]=[];const limitations:string[]=[...input.certification.limitations];
 if(input.readiness.decision!==ProductionReadinessDecision.READY)blockers.push(...input.readiness.blockingCheckIds.map(id=>`READINESS:${id}`));
 if(input.burnIn.decision!==BurnInDecision.PASS)blockers.push(...input.burnIn.blockingReasons.map(reason=>`BURN_IN:${reason}`));
 if(input.certification.decision===FinalCertificationDecision.REJECTED||input.certification.decision===FinalCertificationDecision.REVOKED)blockers.push(...input.certification.blockingRequirementIds.map(id=>`CERTIFICATION:${id}`));
 else if(input.certification.decision!==FinalCertificationDecision.AUTHORIZED&&input.certification.decision!==FinalCertificationDecision.AUTHORIZED_WITH_LIMITATIONS)blockers.push(`CERTIFICATION_DECISION:${input.certification.decision}`);
 limitations.push("SYNTHETIC_EVIDENCE_ONLY","NO_PRODUCTION_OBSERVATION_AUTHORITY","PRODUCTION_MUTATION_HARD_BLOCKED");
 const rejected=input.certification.decision===FinalCertificationDecision.REJECTED||input.certification.decision===FinalCertificationDecision.REVOKED;
 return Object.freeze({reportId:input.reportId,decision:rejected?SyntheticCertificationReportDecision.REJECT:blockers.length?SyntheticCertificationReportDecision.DEFER:SyntheticCertificationReportDecision.PASS_SYNTHETIC_BASELINE,productionMutationAllowed:false,blockers:Object.freeze([...new Set(blockers)].sort()),limitations:Object.freeze([...new Set(limitations)].sort()),generatedAtMs:input.generatedAtMs});
}
