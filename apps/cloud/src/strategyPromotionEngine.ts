import type { CommitteeVote, PaperPerformanceSummary, StrategyGovernanceDecision, StrategyIdentity, StrategyValidationSummary } from "../../../packages/contracts/src/strategyGovernance";
import { evaluateResearchPromotion } from "./researchPromotionGate";

export interface StrategyPromotionInput { readonly now: number; readonly identity: StrategyIdentity; readonly validation?: StrategyValidationSummary; readonly paper?: PaperPerformanceSummary; readonly votes: readonly CommitteeVote[]; }
const finite=(x:number,f:string)=>{if(!Number.isFinite(x))throw new Error(`${f} is invalid`);}; const unit=(x:number,f:string)=>{finite(x,f);if(x<0||x>1)throw new Error(`${f} is invalid`);};
const decision=(input:StrategyPromotionInput, action:StrategyGovernanceDecision["action"], targetLifecycle:StrategyGovernanceDecision["targetLifecycle"], reasons:string[]):StrategyGovernanceDecision=>Object.freeze({action,targetLifecycle,reasons:Object.freeze([...new Set(reasons)].sort()),decidedAt:input.now,strategyId:input.identity.strategyId,version:input.identity.version});
export function evaluateStrategyPromotion(input: StrategyPromotionInput): StrategyGovernanceDecision {
  if(!Number.isSafeInteger(input.now)||input.now<0)throw new Error("now is invalid");
  if(!input.validation)return decision(input,"REJECT","REJECTED",["VALIDATION_MISSING"]);
  const v=input.validation; const p=input.paper;
  for(const [f,x] of Object.entries(v))if(typeof x==="number")finite(x,f);
  if(v.dataFingerprint!==input.identity.featureFingerprint)return decision(input,"REJECT","REJECTED",["FEATURE_FINGERPRINT_MISMATCH"]);
  const gate=evaluateResearchPromotion({strategyId:input.identity.strategyId,dataFingerprint:v.dataFingerprint,currentDataFingerprint:input.identity.featureFingerprint,deflatedSharpeRatio:v.deflatedSharpeRatio,oosIsRatio:v.outOfSampleToInSampleRatio,oosTrades:v.outOfSampleTradeCount,oosProfitFactor:v.profitFactor,positiveWalkForwardShare:v.walkForwardPositiveWindowRatio,monteCarloRuinProbability:v.monteCarloRuinProbability,worstCostStressReturn:v.worstCostStressReturn,paperTradingDays:0});
  if(gate.verdict==="REJECT_STALE_DATA")return decision(input,"REJECT","REJECTED",["FEATURE_FINGERPRINT_MISMATCH"]);
  const veto=input.votes.filter(x=>["RISK","EXECUTION","CIO"].includes(x.member)&&x.decision==="REJECT");
  for(const vote of input.votes){if(!Number.isSafeInteger(vote.decidedAt)||vote.decidedAt>input.now||vote.score<0||vote.score>100)throw new Error("committee vote is invalid");unit(vote.confidence,"confidence");}
  if(veto.length)return decision(input,"REJECT","REJECTED",veto.map(x=>`${x.member}_VETO`));
  if(!p)return decision(input,"NEED_MORE_PAPER","PAPER_CANDIDATE",["PAPER_DATA_MISSING"]);
  for(const [f,x] of Object.entries(p))if(typeof x==="number")finite(x,f);
  const safety:string[]=[]; if(p.unresolvedFaultCount!==0)safety.push("UNRESOLVED_FAULT"); if(p.availabilityRatio<0.99)safety.push("AVAILABILITY_LOW");
  if(safety.length)return decision(input,"REJECT","REJECTED",safety);
  const research=[...gate.failedChecks]; const paper:string[]=[];
  if(p.observationDays<30)paper.push("PAPER_DAYS"); if(p.tradeCount<50)paper.push("PAPER_TRADES"); if(p.profitFactor<1.2)paper.push("PAPER_PROFIT_FACTOR"); if(p.maximumDrawdown>0.10)paper.push("PAPER_DRAWDOWN"); if(p.executionQualityScore<80)paper.push("EXECUTION_QUALITY");
  if(p.killSwitchActivationCount>0)paper.push("KILL_SWITCH_REVIEW_REQUIRED");
  const needMore=input.votes.filter(x=>x.decision==="NEED_MORE_PAPER").length>input.votes.length/2;
  if(research.length||paper.length||needMore)return decision(input,"NEED_MORE_PAPER","PAPER_CANDIDATE",[...research,...paper,...(needMore?["COMMITTEE_NEED_MORE_PAPER"]:[])]);
  return decision(input,"APPROVE_CHALLENGER","CHALLENGER",["ALL_HARD_GATES_PASSED"]);
}
