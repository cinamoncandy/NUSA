import { ReleaseCandidatePromotionDecision, type ReleaseCandidatePromotionResult } from "./release-candidate-promotion";
export enum DeploymentDecision { BLOCKED="BLOCKED" }
export interface DeploymentHardBlockResult { readonly candidateId:string;readonly decision:DeploymentDecision;readonly productionMutationAllowed:false;readonly deploymentAllowed:false;readonly blockers:readonly string[];readonly evaluatedAtMs:number; }
export function evaluateDeploymentHardBlock(input:{readonly promotion:ReleaseCandidatePromotionResult;readonly productionAdapterPresent:boolean;readonly productionCredentialsPresent:boolean;readonly productionEndpointPresent:boolean;readonly explicitOperatingAuthorizationPresent:boolean;readonly nowMs:number;}):DeploymentHardBlockResult{
 if(!Number.isSafeInteger(input.nowMs)||input.nowMs<0)throw new Error("deployment evaluation time is invalid");
 const blockers:string[]=["DEPLOYMENT_HARD_BLOCK_ACTIVE"];
 if(input.promotion.decision!==ReleaseCandidatePromotionDecision.PROMOTABLE)blockers.push("CANDIDATE_NOT_PROMOTABLE");
 if(!input.productionAdapterPresent)blockers.push("PRODUCTION_ADAPTER_ABSENT");
 if(!input.productionCredentialsPresent)blockers.push("PRODUCTION_CREDENTIALS_ABSENT");
 if(!input.productionEndpointPresent)blockers.push("PRODUCTION_ENDPOINT_ABSENT");
 if(!input.explicitOperatingAuthorizationPresent)blockers.push("OPERATING_AUTHORIZATION_ABSENT");
 return Object.freeze({candidateId:input.promotion.candidateId,decision:DeploymentDecision.BLOCKED,productionMutationAllowed:false,deploymentAllowed:false,blockers:Object.freeze([...new Set(blockers)].sort()),evaluatedAtMs:input.nowMs});
}
