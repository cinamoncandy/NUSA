import { createHash } from "node:crypto";
export interface ArtifactManifestEntry { readonly path:string;readonly sha256:string;readonly sizeBytes:number; }
export interface ArtifactManifest { readonly manifestId:string;readonly entries:readonly ArtifactManifestEntry[];readonly manifestHash:string; }

// Shared by create and verify so verification can never drift from how the hash is actually
// derived. `manifestHash` is a FIELD on the object, not a property of reality -- trusting it
// without recomputing from `entries` means a manifest whose entries were edited but whose
// stored hash was left untouched (or copied from a different, valid manifest) verifies clean.
function canonicalManifestHash(entries: readonly ArtifactManifestEntry[]): string {
 const canonical=[...entries].sort((a,b)=>a.path.localeCompare(b.path)).map(e=>`${e.path}\0${e.sha256}\0${e.sizeBytes}`).join("\n");
 return createHash("sha256").update(canonical).digest("hex");
}

export function createArtifactManifest(manifestId:string,entries:readonly ArtifactManifestEntry[]):ArtifactManifest{
 if(!manifestId.trim()||entries.length===0)throw new Error("manifest identity and entries are required");const paths=new Set<string>();
 const ordered=[...entries].sort((a,b)=>a.path.localeCompare(b.path)).map(e=>{if(!e.path.trim()||paths.has(e.path)||!/^[a-f0-9]{64}$/.test(e.sha256)||!Number.isSafeInteger(e.sizeBytes)||e.sizeBytes<0)throw new Error("invalid artifact manifest entry");paths.add(e.path);return Object.freeze({...e});});
 return Object.freeze({manifestId,entries:Object.freeze(ordered),manifestHash:canonicalManifestHash(ordered)});
}

export function verifyArtifactManifest(expected:ArtifactManifest,actual:ArtifactManifest):readonly string[]{
 const blockers:string[]=[];
 if(expected.manifestId!==actual.manifestId)blockers.push("MANIFEST_ID_MISMATCH");
 // Recomputed from entries on BOTH sides, not the stored manifestHash fields. Comparing two
 // pre-computed strings only proves they were typed the same; it proves nothing about
 // whether either one actually matches the entries it is supposed to describe.
 if(expected.manifestHash!==canonicalManifestHash(expected.entries))blockers.push("EXPECTED_MANIFEST_HASH_INVALID");
 if(actual.manifestHash!==canonicalManifestHash(actual.entries))blockers.push("ACTUAL_MANIFEST_HASH_INVALID");
 if(canonicalManifestHash(expected.entries)!==canonicalManifestHash(actual.entries))blockers.push("MANIFEST_HASH_MISMATCH");
 return Object.freeze(blockers);
}
