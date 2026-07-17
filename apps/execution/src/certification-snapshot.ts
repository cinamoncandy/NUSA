import { createHash } from "node:crypto";
import { type SyntheticReleaseStatusResult } from "./synthetic-release-status";

export interface CertificationSnapshotComponent { readonly kind:string;readonly evidenceId:string;readonly sha256:string; }
export interface CertificationSnapshot { readonly snapshotId:string;readonly candidateId:string;readonly headSha:string;readonly graphHash:string;readonly statusDecision:string;readonly componentCount:number;readonly snapshotHash:string;readonly deploymentAllowed:false;readonly productionMutationAllowed:false;readonly createdAtMs:number; }
function validHash(v:string):boolean{return /^[a-f0-9]{64}$/.test(v);}
export function createCertificationSnapshot(input:{readonly snapshotId:string;readonly candidateId:string;readonly headSha:string;readonly status:SyntheticReleaseStatusResult;readonly components:readonly CertificationSnapshotComponent[];readonly nowMs:number;}):CertificationSnapshot{
 if(!input.snapshotId.trim()||!input.candidateId.trim()||!input.headSha.trim()||!Number.isSafeInteger(input.nowMs)||input.nowMs<0)throw new Error("valid certification snapshot identity is required");
 if(input.status.candidateId!==input.candidateId)throw new Error("status candidate mismatch");
 if(!input.status.graphHash||!validHash(input.status.graphHash))throw new Error("verified graph hash is required");
 const ids=new Set<string>();const canonical=input.components.map(c=>{if(!c.kind.trim()||!c.evidenceId.trim()||!validHash(c.sha256))throw new Error("valid snapshot component is required");if(ids.has(c.evidenceId))throw new Error("duplicate snapshot evidence id");ids.add(c.evidenceId);return {kind:c.kind,evidenceId:c.evidenceId,sha256:c.sha256};}).sort((a,b)=>a.kind.localeCompare(b.kind)||a.evidenceId.localeCompare(b.evidenceId));
 if(canonical.length===0)throw new Error("snapshot components are required");
 const payload=JSON.stringify({candidateId:input.candidateId,headSha:input.headSha,graphHash:input.status.graphHash,statusDecision:input.status.decision,components:canonical});
 const snapshotHash=createHash("sha256").update(payload).digest("hex");
 return Object.freeze({snapshotId:input.snapshotId,candidateId:input.candidateId,headSha:input.headSha,graphHash:input.status.graphHash,statusDecision:input.status.decision,componentCount:canonical.length,snapshotHash,deploymentAllowed:false,productionMutationAllowed:false,createdAtMs:input.nowMs});
}
