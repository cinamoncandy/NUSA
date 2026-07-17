import { DatabaseSync } from "node:sqlite";
import { ReleaseCandidateFreezeDecision, type ReleaseCandidateFreezeResult } from "./release-candidate-freeze";

export interface ReleaseFreezeEvidence { readonly candidateId:string; readonly reportId:string; readonly decision:ReleaseCandidateFreezeDecision; readonly blockers:readonly string[]; readonly frozenHeadSha:string; readonly artifactManifestHash:string; readonly productionMutationAllowed:false; readonly recordedAtMs:number; }
export class SqliteReleaseFreezeEvidenceRepository {
 public constructor(private readonly db:DatabaseSync){this.db.exec(`CREATE TABLE IF NOT EXISTS release_candidate_freeze_evidence(candidate_id TEXT PRIMARY KEY,report_id TEXT NOT NULL,decision TEXT NOT NULL,blockers_json TEXT NOT NULL,frozen_head_sha TEXT NOT NULL,artifact_manifest_hash TEXT NOT NULL,production_mutation_allowed INTEGER NOT NULL CHECK(production_mutation_allowed=0),recorded_at_ms INTEGER NOT NULL);`);}
 public append(input:{readonly result:ReleaseCandidateFreezeResult;readonly reportId:string;readonly artifactManifestHash:string;}):ReleaseFreezeEvidence{
  if(!input.reportId.trim()||!input.artifactManifestHash.trim())throw new Error("report and artifact manifest identities are required");
  const r=input.result;this.db.prepare("INSERT INTO release_candidate_freeze_evidence VALUES(?,?,?,?,?,?,0,?)").run(r.candidateId,input.reportId,r.decision,JSON.stringify(r.blockers),r.frozenHeadSha,input.artifactManifestHash,r.evaluatedAtMs);return this.get(r.candidateId)!;
 }
 public get(candidateId:string):ReleaseFreezeEvidence|undefined{const row=this.db.prepare("SELECT * FROM release_candidate_freeze_evidence WHERE candidate_id=?").get(candidateId) as Record<string,unknown>|undefined;if(!row)return undefined;if(Number(row.production_mutation_allowed)!==0)throw new Error("persisted production mutation authorization rejected");return Object.freeze({candidateId:String(row.candidate_id),reportId:String(row.report_id),decision:String(row.decision) as ReleaseCandidateFreezeDecision,blockers:Object.freeze(JSON.parse(String(row.blockers_json)) as string[]),frozenHeadSha:String(row.frozen_head_sha),artifactManifestHash:String(row.artifact_manifest_hash),productionMutationAllowed:false,recordedAtMs:Number(row.recorded_at_ms)});}
}
