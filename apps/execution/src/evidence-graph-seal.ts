import { createHash } from "node:crypto";
import { GENESIS_SEAL_HASH, type EvidenceGraphHashSeal, type EvidenceGraphSealEdge, type EvidenceGraphSealNode } from "../../../packages/contracts/src/evidenceGraph";
export { GENESIS_SEAL_HASH } from "../../../packages/contracts/src/evidenceGraph";
export type { EvidenceGraphHashSeal, EvidenceGraphSealEdge, EvidenceGraphSealNode } from "../../../packages/contracts/src/evidenceGraph";

function canonicalGraph(nodes:readonly EvidenceGraphSealNode[],edges:readonly EvidenceGraphSealEdge[]):string{
 const canonicalNodes=[...nodes].map(n=>({evidenceId:n.evidenceId.trim(),kind:n.kind.trim(),candidateId:n.candidateId.trim()})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 const canonicalEdges=[...edges].map(e=>({fromEvidenceId:e.fromEvidenceId.trim(),toEvidenceId:e.toEvidenceId.trim(),relation:e.relation.trim()})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return JSON.stringify({nodes:canonicalNodes,edges:canonicalEdges});
}

function computeChainHash(input:{readonly sealId:string;readonly candidateId:string;readonly graphHash:string;readonly previousSealHash:string;readonly sealedAtMs:number}):string{
 return createHash("sha256").update(JSON.stringify({sealId:input.sealId,candidateId:input.candidateId,graphHash:input.graphHash,previousSealHash:input.previousSealHash,sealedAtMs:input.sealedAtMs})).digest("hex");
}

/**
 * Seals a candidate's evidence graph into a tamper-evident record. Each seal cryptographically
 * links to the seal that preceded it (previousSealHash / chainHash), so persisted seal history
 * forms a hash chain: altering, reordering, or deleting any past seal breaks every chainHash
 * computed after it. Pass previousSealHash=GENESIS_SEAL_HASH for the first seal in a chain.
 * This function never grants deployment or production authority on its own.
 */
export function sealEvidenceGraph(input:{readonly sealId:string;readonly candidateId:string;readonly nodes:readonly EvidenceGraphSealNode[];readonly edges:readonly EvidenceGraphSealEdge[];readonly previousSealHash?:string;readonly nowMs:number;}):EvidenceGraphHashSeal{
 if(!input.sealId.trim()||!input.candidateId.trim()||!Number.isSafeInteger(input.nowMs)||input.nowMs<0)throw new Error("valid graph seal identity and time are required");
 if(input.nodes.length<1)throw new Error("evidence graph cannot be empty");
 const previousSealHash=input.previousSealHash?.trim()||GENESIS_SEAL_HASH;
 const ids=new Set<string>();
 for(const node of input.nodes){if(!node.evidenceId.trim()||!node.kind.trim()||node.candidateId!==input.candidateId)throw new Error("invalid evidence graph node");if(ids.has(node.evidenceId))throw new Error("duplicate evidence id");ids.add(node.evidenceId);}
 for(const edge of input.edges){if(!edge.fromEvidenceId.trim()||!edge.toEvidenceId.trim()||!edge.relation.trim())throw new Error("invalid evidence graph edge");if(!ids.has(edge.fromEvidenceId)||!ids.has(edge.toEvidenceId))throw new Error("dangling evidence graph edge");if(edge.fromEvidenceId===edge.toEvidenceId)throw new Error("self evidence graph edge");}
 const graphHash=createHash("sha256").update(canonicalGraph(input.nodes,input.edges)).digest("hex");
 const chainHash=computeChainHash({sealId:input.sealId,candidateId:input.candidateId,graphHash,previousSealHash,sealedAtMs:input.nowMs});
 return Object.freeze({sealId:input.sealId,candidateId:input.candidateId,graphHash,previousSealHash,chainHash,nodeCount:input.nodes.length,edgeCount:input.edges.length,sealedAtMs:input.nowMs,deploymentAllowed:false,productionMutationAllowed:false});
}

export function verifyEvidenceGraphSeal(input:{readonly seal:EvidenceGraphHashSeal;readonly nodes:readonly EvidenceGraphSealNode[];readonly edges:readonly EvidenceGraphSealEdge[]}):boolean{
 const resealed=sealEvidenceGraph({sealId:input.seal.sealId,candidateId:input.seal.candidateId,nodes:input.nodes,edges:input.edges,previousSealHash:input.seal.previousSealHash,nowMs:input.seal.sealedAtMs});
 return resealed.graphHash===input.seal.graphHash&&resealed.chainHash===input.seal.chainHash&&resealed.nodeCount===input.seal.nodeCount&&resealed.edgeCount===input.seal.edgeCount&&input.seal.deploymentAllowed===false&&input.seal.productionMutationAllowed===false;
}

export enum SealChainIntegrityDecision { INTACT="INTACT", BROKEN="BROKEN" }
export interface SealChainIntegrityResult { readonly decision:SealChainIntegrityDecision; readonly brokenAtSealId:string|null; readonly reasons:readonly string[]; }

/**
 * Walks a persisted seal history in append order and confirms the hash chain has no gaps,
 * regressions, or recomputation mismatches. Intended to run over everything a repository
 * returns (for one candidate or globally), independent of any single seal's self-consistency.
 */
export function verifySealChainIntegrity(seals:readonly EvidenceGraphHashSeal[]):SealChainIntegrityResult{
 let expectedPrevious=GENESIS_SEAL_HASH;
 let lastSealedAtMs=-1;
 for(const seal of seals){
  if(seal.previousSealHash!==expectedPrevious)return Object.freeze({decision:SealChainIntegrityDecision.BROKEN,brokenAtSealId:seal.sealId,reasons:Object.freeze(["CHAIN_LINK_MISMATCH"])});
  const recomputed=computeChainHash({sealId:seal.sealId,candidateId:seal.candidateId,graphHash:seal.graphHash,previousSealHash:seal.previousSealHash,sealedAtMs:seal.sealedAtMs});
  if(recomputed!==seal.chainHash)return Object.freeze({decision:SealChainIntegrityDecision.BROKEN,brokenAtSealId:seal.sealId,reasons:Object.freeze(["CHAIN_HASH_MISMATCH"])});
  if(seal.sealedAtMs<lastSealedAtMs)return Object.freeze({decision:SealChainIntegrityDecision.BROKEN,brokenAtSealId:seal.sealId,reasons:Object.freeze(["SEAL_TIME_REGRESSION"])});
  if(seal.deploymentAllowed!==false||seal.productionMutationAllowed!==false)return Object.freeze({decision:SealChainIntegrityDecision.BROKEN,brokenAtSealId:seal.sealId,reasons:Object.freeze(["SEAL_AUTHORITY_VIOLATION"])});
  expectedPrevious=seal.chainHash;
  lastSealedAtMs=seal.sealedAtMs;
 }
 return Object.freeze({decision:SealChainIntegrityDecision.INTACT,brokenAtSealId:null,reasons:Object.freeze([])});
}
