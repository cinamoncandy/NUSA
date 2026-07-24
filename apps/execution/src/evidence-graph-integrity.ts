export enum EvidenceGraphIntegrityDecision { INTACT="INTACT", BROKEN="BROKEN" }
export interface EvidenceGraphNode { readonly evidenceId:string;readonly candidateId:string;readonly kind:string; }
export interface EvidenceGraphEdge { readonly fromEvidenceId:string;readonly toEvidenceId:string;readonly relation:string; }
export interface EvidenceGraphIntegrityResult { readonly candidateId:string;readonly decision:EvidenceGraphIntegrityDecision;readonly productionMutationAllowed:false;readonly deploymentAllowed:false;readonly blockers:readonly string[];readonly evaluatedAtMs:number; }
export function evaluateEvidenceGraphIntegrity(input:{readonly candidateId:string;readonly nodes:readonly EvidenceGraphNode[];readonly edges:readonly EvidenceGraphEdge[];readonly requiredKinds:readonly string[];readonly nowMs:number;}):EvidenceGraphIntegrityResult{
 if(!input.candidateId.trim()||!Number.isSafeInteger(input.nowMs)||input.nowMs<0)throw new Error("valid graph identity and time are required");
 const blockers:string[]=[];const ids=new Set<string>();const kinds=new Set<string>();
 for(const n of input.nodes){if(!n.evidenceId.trim()||!n.kind.trim())blockers.push("INVALID_EVIDENCE_NODE");if(ids.has(n.evidenceId))blockers.push("DUPLICATE_EVIDENCE_ID");ids.add(n.evidenceId);if(n.candidateId!==input.candidateId)blockers.push("EVIDENCE_CANDIDATE_MISMATCH");kinds.add(n.kind);}
 for(const k of input.requiredKinds){if(!k.trim())blockers.push("INVALID_REQUIRED_KIND");else if(!kinds.has(k))blockers.push(`MISSING_EVIDENCE_KIND:${k}`);}
 for(const e of input.edges){if(!e.relation.trim())blockers.push("INVALID_EVIDENCE_RELATION");if(!ids.has(e.fromEvidenceId)||!ids.has(e.toEvidenceId))blockers.push("DANGLING_EVIDENCE_EDGE");if(e.fromEvidenceId===e.toEvidenceId)blockers.push("SELF_REFERENTIAL_EVIDENCE_EDGE");}
 if(input.nodes.length===0)blockers.push("EVIDENCE_GRAPH_EMPTY");
 return Object.freeze({candidateId:input.candidateId,decision:blockers.length?EvidenceGraphIntegrityDecision.BROKEN:EvidenceGraphIntegrityDecision.INTACT,productionMutationAllowed:false,deploymentAllowed:false,blockers:Object.freeze([...new Set(blockers)].sort()),evaluatedAtMs:input.nowMs});
}
