export type UniverseMembershipEventType="ADDED"|"REMOVED"|"DELISTED"|"MERGED"|"BANKRUPT"|"SYMBOL_CHANGED";
export interface UniverseMembershipEvent{readonly eventId:string;readonly symbol:string;readonly type:UniverseMembershipEventType;readonly effectiveAt:number;readonly renamedTo?:string;}
export type UniverseMembershipResolution={readonly member:true}|{readonly member:false;readonly reason:"NEVER_ADDED_BY_EFFECTIVE_TIME"|"REMOVED_BEFORE_EFFECTIVE_TIME"|"INVALID_EFFECTIVE_TIME"|"INVALID_EVENT_HISTORY"};
const EVENT_TYPES:readonly UniverseMembershipEventType[]=["ADDED","REMOVED","DELISTED","MERGED","BANKRUPT","SYMBOL_CHANGED"];
const EXIT_TYPES:readonly UniverseMembershipEventType[]=["REMOVED","DELISTED","MERGED","BANKRUPT","SYMBOL_CHANGED"];
const isTimestamp=(v:unknown):v is number=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0;
function validHistory(events:readonly UniverseMembershipEvent[]):boolean{
 if(events.length===0)return false;const ids=new Set<string>();const symbolTimes=new Set<string>();
 for(const e of events){if(!e.eventId?.trim()||!e.symbol?.trim()||!EVENT_TYPES.includes(e.type)||!isTimestamp(e.effectiveAt))return false;if(e.type==="SYMBOL_CHANGED"&&!e.renamedTo?.trim())return false;if(ids.has(e.eventId))return false;ids.add(e.eventId);const key=`${e.symbol}\u0000${e.effectiveAt}`;if(symbolTimes.has(key))return false;symbolTimes.add(key);}
 for(const e of events){if(e.type!=="SYMBOL_CHANGED")continue;const renamed=e.renamedTo!.trim();if(renamed===e.symbol)return false;const paired=events.filter((x)=>x.type==="ADDED"&&x.symbol===renamed&&x.effectiveAt===e.effectiveAt);if(paired.length!==1)return false;}
 return true;
}
export function resolveUniverseMembership(symbol:string,asOf:number,events:readonly UniverseMembershipEvent[]):UniverseMembershipResolution{
 if(!isTimestamp(asOf))return{member:false,reason:"INVALID_EFFECTIVE_TIME"};if(!validHistory(events))return{member:false,reason:"INVALID_EVENT_HISTORY"};
 const relevant=events.filter((e)=>e.symbol===symbol&&e.effectiveAt<=asOf).sort((a,b)=>a.effectiveAt-b.effectiveAt);let lastAdd=-1;for(let i=relevant.length-1;i>=0;i-=1)if(relevant[i].type==="ADDED"){lastAdd=i;break;}
 if(lastAdd<0)return{member:false,reason:"NEVER_ADDED_BY_EFFECTIVE_TIME"};if(relevant.slice(lastAdd+1).some((e)=>EXIT_TYPES.includes(e.type)))return{member:false,reason:"REMOVED_BEFORE_EFFECTIVE_TIME"};return{member:true};
}
export function isUniverseMembershipConsistent(claims:readonly {readonly symbol:string;readonly asOf:number}[],events:readonly UniverseMembershipEvent[]):boolean{return claims.length>0&&claims.every((c)=>resolveUniverseMembership(c.symbol,c.asOf,events).member);}
