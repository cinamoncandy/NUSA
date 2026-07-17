import { DatabaseSync } from "node:sqlite";
import { ReleaseCandidatePromotionDecision, type ReleaseCandidatePromotionResult } from "./release-candidate-promotion";
import { IndependentApprovalDecision, type IndependentApprovalResult } from "./independent-approval";

export interface PromotionEvidence { readonly promotionId:string;readonly candidateId:string;readonly approvalId:string;readonly decision:ReleaseCandidatePromotionDecision;readonly blockers:readonly string[];readonly evaluatedAtMs:number;readonly productionMutationAllowed:false; }
export class SqlitePromotionEvidenceRepository {
 public constructor(private readonly db:DatabaseSync){this.db.exec(`CREATE TABLE IF NOT EXISTS promotion_evidence (promotion_id TEXT PRIMARY KEY,candidate_id TEXT NOT NULL,approval_id TEXT NOT NULL,decision TEXT NOT NULL,blockers_json TEXT NOT NULL,evaluated_at_ms INTEGER NOT NULL,production_mutation_allowed INTEGER NOT NULL CHECK (production_mutation_allowed = 0));`);}
 public append(input:{readonly promotionId:string;readonly promotion:ReleaseCandidatePromotionResult;readonly approval:IndependentApprovalResult;}):PromotionEvidence{
  if(!input.promotionId.trim())throw new Error("promotion evidence id is required");
  if(input.approval.candidateId!==input.promotion.candidateId)throw new Error("approval candidate mismatch");
  if(input.approval.decision!==IndependentApprovalDecision.VALID)throw new Error("valid independent approval is required");
  if(this.get(input.promotionId))throw new Error("duplicate promotion evidence id");
  this.db.prepare("INSERT INTO promotion_evidence VALUES (?,?,?,?,?,?,0)").run(input.promotionId,input.promotion.candidateId,input.approval.approvalId,input.promotion.decision,JSON.stringify(input.promotion.blockers),input.promotion.evaluatedAtMs);
  return this.get(input.promotionId)!;
 }
 public get(id:string):PromotionEvidence|undefined{
  const row=this.db.prepare("SELECT * FROM promotion_evidence WHERE promotion_id=?").get(id) as Record<string,unknown>|undefined;if(!row)return undefined;
  if(Number(row.production_mutation_allowed)!==0)throw new Error("persisted Production mutation authorization rejected");
  return Object.freeze({promotionId:String(row.promotion_id),candidateId:String(row.candidate_id),approvalId:String(row.approval_id),decision:String(row.decision) as ReleaseCandidatePromotionDecision,blockers:Object.freeze(JSON.parse(String(row.blockers_json))),evaluatedAtMs:Number(row.evaluated_at_ms),productionMutationAllowed:false});
 }
}
