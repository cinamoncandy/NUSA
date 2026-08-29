import { createHash } from "node:crypto";
import type { StrategyGovernanceEvent, StrategyLifecycle } from "../../../packages/contracts/src/strategyGovernance";
export interface StrategyGovernanceLedgerRecord { readonly sequence:number;readonly previousHash:string;readonly event:StrategyGovernanceEvent;readonly hash:string; }
export interface StrategyGovernanceState { readonly lifecycles:ReadonlyMap<string,StrategyLifecycle>;readonly champions:ReadonlyMap<string,string>;readonly hash:string; }
const genesis="0".repeat(64);
const approvalReference=/^[A-Za-z0-9_.:/#@-]{1,240}$/;
const sha256=/^[a-f0-9]{64}$/;
const containmentEventTypes=new Set<StrategyGovernanceEvent["type"]>(["STRATEGY_SUSPENDED","STRATEGY_ROLLED_BACK","STRATEGY_RETIRED"]);
const canon=(e:StrategyGovernanceEvent)=>JSON.stringify({family:e.family,lifecycle:e.lifecycle,occurredAt:e.occurredAt,reason:e.reason,strategyId:e.strategyId,type:e.type,version:e.version,...(e.approval?{approval:{actorType:e.approval.actorType,approvalReference:e.approval.approvalReference,approvedAt:e.approval.approvedAt,decisionFingerprint:e.approval.decisionFingerprint}}:{})});
const hash=(n:number,p:string,e:StrategyGovernanceEvent)=>createHash("sha256").update(`${n}\n${p}\n${canon(e)}`).digest("hex");
const key=(e:StrategyGovernanceEvent)=>`${e.strategyId}|${e.version}`;
const terminal=new Set<StrategyLifecycle>(["RETIRED","REJECTED","ROLLED_BACK"]);

function validateApproval(event: StrategyGovernanceEvent): void {
  const approval = event.approval;
  if (approval === undefined) return;
  if (!containmentEventTypes.has(event.type) || event.lifecycle !== (event.type === "STRATEGY_SUSPENDED" ? "SUSPENDED" : event.type === "STRATEGY_ROLLED_BACK" ? "ROLLED_BACK" : "RETIRED")) throw new Error("invalid governance approval event");
  if (approval.actorType !== "HUMAN" || !approvalReference.test(approval.approvalReference) || !sha256.test(approval.decisionFingerprint) || !Number.isSafeInteger(approval.approvedAt) || approval.approvedAt < 0 || approval.approvedAt !== event.occurredAt) throw new Error("invalid governance approval");
}

export function appendStrategyGovernanceEvent(records:readonly StrategyGovernanceLedgerRecord[],event:StrategyGovernanceEvent):readonly StrategyGovernanceLedgerRecord[]{replayStrategyGovernanceLedger(records);if(!event.strategyId.trim()||!event.version.trim()||!event.family.trim()||!event.reason.trim()||!Number.isSafeInteger(event.occurredAt)||event.occurredAt<0)throw new Error("invalid governance event");validateApproval(event);const previousHash=records.at(-1)?.hash??genesis;const record=Object.freeze({sequence:records.length+1,previousHash,event:Object.freeze({...event, ...(event.approval?{approval:Object.freeze({...event.approval})}: {})}),hash:hash(records.length+1,previousHash,event)});return Object.freeze([...records,record]);}
export function replayStrategyGovernanceLedger(records:readonly StrategyGovernanceLedgerRecord[]):StrategyGovernanceState{const life=new Map<string,StrategyLifecycle>(), champions=new Map<string,string>();let previous=genesis,last=-1;for(let i=0;i<records.length;i++){const r=records[i];validateApproval(r.event);if(r.sequence!==i+1||r.previousHash!==previous||r.hash!==hash(r.sequence,r.previousHash,r.event))throw new Error("governance ledger integrity violation");if(r.event.occurredAt<last)throw new Error("governance ledger timestamp regression");const k=key(r.event),old=life.get(k);if(old&&terminal.has(old)&&r.event.lifecycle!==old)throw new Error("terminal lifecycle cannot resume");if(r.event.type==="CHAMPION_PROMOTED"){const incumbent=champions.get(r.event.family);if(incumbent&&incumbent!==k)life.set(incumbent,"CHALLENGER");champions.set(r.event.family,k);}if(r.event.type==="STRATEGY_ROLLED_BACK"||r.event.type==="STRATEGY_RETIRED")if(champions.get(r.event.family)===k)champions.delete(r.event.family);life.set(k,r.event.lifecycle);previous=r.hash;last=r.event.occurredAt;}return Object.freeze({lifecycles:life,champions,hash:previous});}
