export enum CredentialBoundaryDecision { ALLOW_SYNTHETIC="ALLOW_SYNTHETIC", BLOCK="BLOCK" }
export interface CredentialBoundaryInput { readonly environment:"synthetic"|"production"|"unknown"; readonly endpoint?:string; readonly apiKeyPresent:boolean; readonly apiSecretPresent:boolean; readonly accountIdentifier?:string; }
export interface CredentialBoundaryResult { readonly decision:CredentialBoundaryDecision; readonly productionMutationAllowed:false; readonly blockers:readonly string[]; }
export function evaluateCredentialBoundary(input:CredentialBoundaryInput):CredentialBoundaryResult {
 const blockers:string[]=[];
 const endpoint=(input.endpoint??"").toLowerCase();
 const account=(input.accountIdentifier??"").toLowerCase();
 if(input.environment!=="synthetic") blockers.push(input.environment==="production"?"PRODUCTION_ENVIRONMENT_DETECTED":"ENVIRONMENT_UNKNOWN");
 if(input.apiKeyPresent||input.apiSecretPresent) blockers.push("PRODUCTION_CREDENTIAL_DETECTED");
 if(endpoint && !endpoint.includes("synthetic") && !endpoint.includes("localhost") && !endpoint.includes("127.0.0.1")) blockers.push("PRODUCTION_ENDPOINT_DETECTED");
 if(account && !account.includes("synthetic") && !account.includes("test")) blockers.push("LIVE_ACCOUNT_IDENTIFIER_DETECTED");
 return Object.freeze({decision:blockers.length?CredentialBoundaryDecision.BLOCK:CredentialBoundaryDecision.ALLOW_SYNTHETIC,productionMutationAllowed:false,blockers:Object.freeze([...new Set(blockers)].sort())});
}
