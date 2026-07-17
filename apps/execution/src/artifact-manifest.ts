import { createHash } from "node:crypto";
export interface ArtifactManifestEntry { readonly path:string;readonly sha256:string;readonly sizeBytes:number; }
export interface ArtifactManifest { readonly manifestId:string;readonly entries:readonly ArtifactManifestEntry[];readonly manifestHash:string; }
export function createArtifactManifest(manifestId:string,entries:readonly ArtifactManifestEntry[]):ArtifactManifest{
 if(!manifestId.trim()||entries.length===0)throw new Error("manifest identity and entries are required");const paths=new Set<string>();
 const ordered=[...entries].sort((a,b)=>a.path.localeCompare(b.path)).map(e=>{if(!e.path.trim()||paths.has(e.path)||!/^[a-f0-9]{64}$/.test(e.sha256)||!Number.isSafeInteger(e.sizeBytes)||e.sizeBytes<0)throw new Error("invalid artifact manifest entry");paths.add(e.path);return Object.freeze({...e});});
 const canonical=ordered.map(e=>`${e.path}\0${e.sha256}\0${e.sizeBytes}`).join("\n");return Object.freeze({manifestId,entries:Object.freeze(ordered),manifestHash:createHash("sha256").update(canonical).digest("hex")});
}
export function verifyArtifactManifest(expected:ArtifactManifest,actual:ArtifactManifest):readonly string[]{const blockers:string[]=[];if(expected.manifestId!==actual.manifestId)blockers.push("MANIFEST_ID_MISMATCH");if(expected.manifestHash!==actual.manifestHash)blockers.push("MANIFEST_HASH_MISMATCH");return Object.freeze(blockers);}
