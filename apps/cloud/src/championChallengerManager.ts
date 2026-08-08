import type { PaperPerformanceSummary, StrategyIdentity } from "../../../packages/contracts/src/strategyGovernance";
export interface StrategyCandidatePerformance { readonly identity: StrategyIdentity; readonly family: string; readonly marketSegment: string; readonly paper: PaperPerformanceSummary; }
export interface ChallengerEvaluation { readonly eligible: boolean; readonly replaceChampion: boolean; readonly reasons: readonly string[]; readonly tieBreaker: "KEEP_EXISTING_CHAMPION" | "LEXICAL_VERSION" | "NONE"; }
const frozen=<T>(v:T):T=>Object.freeze(v);
const valid=(p:StrategyCandidatePerformance):void=>{if(!p.family.trim()||!p.marketSegment.trim()||p.paper.observationDays<0||p.paper.tradeCount<0)throw new Error("candidate is invalid");};
export function evaluateChallenger(champion: StrategyCandidatePerformance, challenger: StrategyCandidatePerformance): ChallengerEvaluation {
  valid(champion);valid(challenger); if(champion.family!==challenger.family||champion.marketSegment!==challenger.marketSegment)throw new Error("comparison period or market segment is not comparable");
  const c=champion.paper,n=challenger.paper; const reasons:string[]=[];
  if(c.observationDays<30||n.observationDays<30)reasons.push("MINIMUM_DAYS"); if(c.tradeCount<50||n.tradeCount<50)reasons.push("MINIMUM_TRADES");
  if(n.unresolvedFaultCount!==0)reasons.push("CHALLENGER_FAULT"); if(n.netReturn<=c.netReturn)reasons.push("RETURN_NOT_SUPERIOR"); if(n.sharpeRatio<=c.sharpeRatio)reasons.push("SHARPE_NOT_SUPERIOR"); if(n.maximumDrawdown>c.maximumDrawdown)reasons.push("DRAWDOWN_WORSE"); if(n.profitFactor<c.profitFactor)reasons.push("PROFIT_FACTOR_WORSE"); if(n.executionQualityScore<c.executionQualityScore)reasons.push("EXECUTION_QUALITY_WORSE"); if(n.availabilityRatio<c.availabilityRatio)reasons.push("AVAILABILITY_WORSE");
  const replace=reasons.length===0; return frozen({eligible:c.observationDays>=30&&n.observationDays>=30&&c.tradeCount>=50&&n.tradeCount>=50,replaceChampion:replace,reasons:frozen(reasons.sort()),tieBreaker:replace?"NONE":"KEEP_EXISTING_CHAMPION"});
}

/** @deprecated Read-only compatibility shell. Champion mutation authority lives exclusively in CandidatePromotionRuntime. */
export class ChampionChallengerManager {
  getCurrentChampion(_family:string):StrategyCandidatePerformance|undefined{return undefined;}
  promoteChampion(_candidate:StrategyCandidatePerformance):never{throw new Error("legacy champion mutation disabled; use CandidatePromotionRuntime");}
}
