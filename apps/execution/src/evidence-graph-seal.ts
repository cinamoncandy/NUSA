import { createHash } from "node:crypto";

export interface EvidenceGraphSealNode { readonly evidenceId:string; readonly kind:string; readonly candidateId:string; }
export interface EvidenceGraphSealEdge { readonly fromEvidenceId:string; readonly toEvidenceId:string; readonly relation:string; }
export interface EvidenceGraphHashSeal { readonly sealId:string; readonly candidateId:string; readonly graphHash:string; readonly nodeCount:number; readonly edgeCount:number; readonly sealedAtMs:number; readonly deploymentAllowed:false; readonly productionMutationAllowed:false; }

function canonicalGraph(nodes:readonly EvidenceGraphSealNode[],edges:readonly EvidenceGraphSealEdge[]):string{
 const canonicalNodes=[...nodes].map(n=>({evidenceId:n.evidenceId.trim(),kind:n.kind.trim(),candidateId:n.candidateId.trim()})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 const canonicalEdges=[...edges].map(e=>({fromEvidenceId:e.fromEvidenceId.trim(),toEvidenceId:e.toEvidenceId.trim(),relation:e.relation.trim()})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return JSON.stringify({nodes:canonicalNodes,edges:canonicalEdges});
}

export function sealEvidenceGraph(input:{readonly sealId:string;readonly candidateId:string;readonly nodes:readonly EvidenceGraphSealNode[];readonly edges:readonly EvidenceGraphSealEdge[];readonly nowMs:number;}):EvidenceGraphHashSeal{
 if(!input.sealId.trim()||!input.candidateId.trim()||!Number.isSafeInteger(input.nowMs)||input.nowMs<0)throw new Error("valid graph seal identity and time are required");
 if(input.nodes.length<1)throw new Error("evidence graph cannot be empty");
 const ids=new Set<string>();
 for(const node of input.nodes){if(!node.evidenceId.trim()||!node.kind.trim()||node.candidateId!==input.candidateId)throw new Error("invalid evidence graph node");if(ids.has(node.evidenceId))throw new Error("duplicate evidence id");ids.add(node.evidenceId);}
 for(const edge of input.edges){if(!edge.fromEvidenceId.trim()||!edge.toEvidenceId.trim()||!edge.relation.trim())throw new Error("invalid evidence graph edge");if(!ids.has(edge.fromEvidenceId)||!ids.has(edge.toEvidenceId))throw new Error("dangling evidence graph edge");if(edge.fromEvidenceId===edge.toEvidenceId)throw new Error("self evidence graph edge");}
 const graphHash=createHash("sha256").update(canonicalGraph(input.nodes,input.edges)).digest("hex");
 return Object.freeze({sealId:input.sealId,candidateId:input.candidateId,graphHash,nodeCount:input.nodes.length,edgeCount:input.edges.length,sealedAtMs:input.nowMs,deploymentAllowed:false,productionMutationAllowed:false});
}

export function verifyEvidenceGraphSeal(input:{readonly seal:EvidenceGraphHashSeal;readonly nodes:readonly EvidenceGraphSealNode[];readonly edges:readonly EvidenceGraphSealEdge[]}):boolean{
 const resealed=sealEvidenceGraph({sealId:input.seal.sealId,candidateId:input.seal.candidateId,nodes:input.nodes,edges:input.edges,nowMs:input.seal.sealedAtMs});
 return resealed.graphHash===input.seal.graphHash&&resealed.nodeCount===input.seal.nodeCount&&resealed.edgeCount===input.seal.edgeCount&&input.seal.deploymentAllowed===false&&input.seal.productionMutationAllowed===false;
}
