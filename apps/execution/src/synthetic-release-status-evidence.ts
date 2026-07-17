import { DatabaseSync } from "node:sqlite";
import { SyntheticReleaseStatusDecision, type SyntheticReleaseStatusResult } from "./synthetic-release-status";

export interface SyntheticReleaseStatusEvidence extends SyntheticReleaseStatusResult { readonly statusEvidenceId:string; }

export class SqliteSyntheticReleaseStatusEvidenceRepository {
 public constructor(private readonly db:DatabaseSync){this.db.exec(`CREATE TABLE IF NOT EXISTS synthetic_release_status_evidence(status_evidence_id TEXT PRIMARY KEY,envelope_id TEXT NOT NULL,candidate_id TEXT NOT NULL,decision TEXT NOT NULL,graph_hash TEXT,blockers_json TEXT NOT NULL,evaluated_at_ms INTEGER NOT NULL,deployment_allowed INTEGER NOT NULL CHECK(deployment_allowed=0),production_mutation_allowed INTEGER NOT NULL CHECK(production_mutation_allowed=0))`);}
 public append(input:{readonly statusEvidenceId:string;readonly status:SyntheticReleaseStatusResult;}):SyntheticReleaseStatusEvidence{
  if(!input.statusEvidenceId.trim())throw new Error("valid status evidence id is required");
  const s=input.status;if(s.deploymentAllowed!==false||s.productionMutationAllowed!==false)throw new Error("release authority cannot be persisted");
  this.db.prepare("INSERT INTO synthetic_release_status_evidence VALUES(?,?,?,?,?,?,?,?,?)").run(input.statusEvidenceId,s.envelopeId,s.candidateId,s.decision,s.graphHash,JSON.stringify([...s.blockers]),s.evaluatedAtMs,0,0);
  return this.get(input.statusEvidenceId)!;
 }
 public get(id:string):SyntheticReleaseStatusEvidence|undefined{const r=this.db.prepare("SELECT * FROM synthetic_release_status_evidence WHERE status_evidence_id=?").get(id) as Record<string,unknown>|undefined;if(!r)return undefined;if(Number(r.deployment_allowed)!==0||Number(r.production_mutation_allowed)!==0)throw new Error("invalid persisted release authority");const decision=String(r.decision) as SyntheticReleaseStatusDecision;if(!Object.values(SyntheticReleaseStatusDecision).includes(decision))throw new Error("invalid persisted status decision");return Object.freeze({statusEvidenceId:String(r.status_evidence_id),envelopeId:String(r.envelope_id),candidateId:String(r.candidate_id),decision,graphHash:r.graph_hash===null?null:String(r.graph_hash),blockers:Object.freeze(JSON.parse(String(r.blockers_json)) as string[]),deploymentAllowed:false,productionMutationAllowed:false,evaluatedAtMs:Number(r.evaluated_at_ms)});}
}
