export enum ProductionAdapterAttestationDecision { ATTESTED="ATTESTED", FAILED="FAILED" }
export interface ProductionAdapterInventory { readonly productionExchangeAdapter:boolean; readonly liveTradingExecutor:boolean; readonly realOrderSubmitter:boolean; readonly capitalMovementAdapter:boolean; }
export interface ProductionAdapterAttestation { readonly attestationId:string; readonly decision:ProductionAdapterAttestationDecision; readonly productionMutationAllowed:false; readonly blockers:readonly string[]; readonly evaluatedAtMs:number; }
export function attestProductionAdapterAbsence(input:{readonly attestationId:string;readonly inventory:ProductionAdapterInventory;readonly nowMs:number;}):ProductionAdapterAttestation {
 if(!input.attestationId.trim()||!Number.isSafeInteger(input.nowMs)||input.nowMs<0) throw new Error("valid attestation identity and time are required");
 const blockers:string[]=[];
 if(input.inventory.productionExchangeAdapter) blockers.push("PRODUCTION_EXCHANGE_ADAPTER_PRESENT");
 if(input.inventory.liveTradingExecutor) blockers.push("LIVE_TRADING_EXECUTOR_PRESENT");
 if(input.inventory.realOrderSubmitter) blockers.push("REAL_ORDER_SUBMITTER_PRESENT");
 if(input.inventory.capitalMovementAdapter) blockers.push("CAPITAL_MOVEMENT_ADAPTER_PRESENT");
 return Object.freeze({attestationId:input.attestationId,decision:blockers.length?ProductionAdapterAttestationDecision.FAILED:ProductionAdapterAttestationDecision.ATTESTED,productionMutationAllowed:false,blockers:Object.freeze(blockers.sort()),evaluatedAtMs:input.nowMs});
}
