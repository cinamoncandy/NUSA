import { DatabaseSync } from "node:sqlite";
import { FinalSyntheticReleaseEnvelopeDecision, type FinalSyntheticReleaseEnvelope } from "./final-synthetic-release-envelope";

export class SqliteFinalEnvelopeEvidenceRepository {
 public constructor(private readonly db:DatabaseSync){this.db.exec(`CREATE TABLE IF NOT EXISTS final_synthetic_release_envelopes(envelope_id TEXT PRIMARY KEY,candidate_id TEXT NOT NULL,decision TEXT NOT NULL,limitations_json TEXT NOT NULL,blockers_json TEXT NOT NULL,sealed_at_ms INTEGER NOT NULL,deployment_allowed INTEGER NOT NULL CHECK(deployment_allowed=0),production_mutation_allowed INTEGER NOT NULL CHECK(production_mutation_allowed=0))`);}
 public append(e:FinalSyntheticReleaseEnvelope):FinalSyntheticReleaseEnvelope{
  if(e.decision!==FinalSyntheticReleaseEnvelopeDecision.SEALED_SYNTHETIC_ONLY)throw new Error("only sealed synthetic envelopes may be persisted");
  if(e.deploymentAllowed!==false||e.productionMutationAllowed!==false)throw new Error("release authority cannot be persisted");
  this.db.prepare("INSERT INTO final_synthetic_release_envelopes VALUES(?,?,?,?,?,?,?,?)").run(e.envelopeId,e.candidateId,e.decision,JSON.stringify([...e.limitations]),JSON.stringify([...e.blockers]),e.sealedAtMs,0,0);
  return this.get(e.envelopeId)!;
 }
 public get(id:string):FinalSyntheticReleaseEnvelope|undefined{
  const r=this.db.prepare("SELECT * FROM final_synthetic_release_envelopes WHERE envelope_id=?").get(id) as Record<string,unknown>|undefined;if(!r)return undefined;
  if(Number(r.deployment_allowed)!==0||Number(r.production_mutation_allowed)!==0)throw new Error("invalid persisted release authority");
  return Object.freeze({envelopeId:String(r.envelope_id),candidateId:String(r.candidate_id),decision:String(r.decision) as FinalSyntheticReleaseEnvelopeDecision,limitations:Object.freeze(JSON.parse(String(r.limitations_json)) as string[]),blockers:Object.freeze(JSON.parse(String(r.blockers_json)) as string[]),sealedAtMs:Number(r.sealed_at_ms),deploymentAllowed:false,productionMutationAllowed:false});
 }
}
