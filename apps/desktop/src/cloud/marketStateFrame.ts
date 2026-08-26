import type { HistoricalDatasetManifest, ResearchCandle } from "./researchDataset";
import { verifyHistoricalDatasetManifest } from "./researchDataset";

export interface MarketStateInput { readonly manifest: HistoricalDatasetManifest; readonly candles: readonly ResearchCandle[]; }
export interface MarketStateObservation { readonly market: string; readonly interval: HistoricalDatasetManifest["interval"]; readonly datasetId: string; readonly asOf: number; readonly lastClose: number; readonly onePeriodReturn: number; readonly lookbackReturn: number; readonly realizedVolatility: number; readonly maxDrawdown: number; readonly averageVolume: number; readonly averageQuoteVolume?: number; }
export interface MarketStateFrame { readonly schemaVersion: 1; readonly generatedAt: string; readonly lookbackPeriods: number; readonly markets: readonly MarketStateObservation[]; readonly aggregate: Readonly<{ marketCount: number; positiveBreadth: number; medianLookbackReturn: number; medianRealizedVolatility: number; crossSectionalDispersion: number; }>; readonly sourceDatasetIds: readonly string[]; }
export class MarketStateFrameError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = "MarketStateFrameError"; } }
const freeze=<T>(v:T):Readonly<T>=>Object.freeze(v);
function assertFinite(v:number,c:string,m:string){if(!Number.isFinite(v))throw new MarketStateFrameError(c,m);}
function mean(v:readonly number[]){return v.reduce((s,x)=>s+x,0)/v.length;}
function median(v:readonly number[]){const o=[...v].sort((a,b)=>a-b),m=Math.floor(o.length/2);return o.length%2===0?(o[m-1]!+o[m]!)/2:o[m]!;}
function standardDeviation(v:readonly number[]){if(v.length<=1)return 0;const a=mean(v);return Math.sqrt(v.reduce((s,x)=>s+(x-a)**2,0)/v.length);}
function maxDrawdown(c:readonly number[]){let p=c[0]!,w=0;for(const x of c){p=Math.max(p,x);w=Math.min(w,x/p-1);}return w;}
function buildObservation(input:MarketStateInput,lookbackPeriods:number,asOf?:number):MarketStateObservation{
  const validated=verifyHistoricalDatasetManifest(input.manifest,input.candles);
  const eligible=asOf==null?validated.candles:validated.candles.filter(c=>c.closeTime<=asOf);
  if(eligible.length<lookbackPeriods+1)throw new MarketStateFrameError("INSUFFICIENT_LOOKBACK",`${input.manifest.datasetId} requires at least ${lookbackPeriods+1} candles available by asOf`);
  const window=eligible.slice(-(lookbackPeriods+1)),closes=window.map(c=>c.close),returns=closes.slice(1).map((c,i)=>Math.log(c/closes[i]!));
  const last=window.at(-1)!,prior=window.at(-2)!,quoteVolumes=window.slice(1).map(c=>c.quoteVolume).filter((v):v is number=>v!=null);
  const observation:MarketStateObservation={market:input.manifest.market,interval:input.manifest.interval,datasetId:input.manifest.datasetId,asOf:last.closeTime,lastClose:last.close,onePeriodReturn:last.close/prior.close-1,lookbackReturn:last.close/window[0]!.close-1,realizedVolatility:standardDeviation(returns),maxDrawdown:maxDrawdown(closes),averageVolume:mean(window.slice(1).map(c=>c.volume)),averageQuoteVolume:quoteVolumes.length===lookbackPeriods?mean(quoteVolumes):undefined};
  for(const [name,value] of Object.entries(observation))if(typeof value==="number")assertFinite(value,"NON_FINITE_METRIC",`${input.manifest.datasetId} produced non-finite ${name}`);
  return freeze(observation) as MarketStateObservation;
}
export function buildMarketStateFrame(inputs:readonly MarketStateInput[],options:{readonly lookbackPeriods?:number;readonly generatedAt?:string;readonly asOf?:number}={}):MarketStateFrame{
  if(inputs.length===0)throw new MarketStateFrameError("EMPTY_INPUT","market state frame requires at least one dataset");
  const lookbackPeriods=options.lookbackPeriods??20;if(!Number.isInteger(lookbackPeriods)||lookbackPeriods<2)throw new MarketStateFrameError("INVALID_LOOKBACK","lookbackPeriods must be an integer >= 2");
  const generatedAt=options.generatedAt??"1970-01-01T00:00:00.000Z";if(!Number.isFinite(Date.parse(generatedAt)))throw new MarketStateFrameError("INVALID_GENERATED_AT","generatedAt must be a valid timestamp");
  if(options.asOf!=null&&!Number.isFinite(options.asOf))throw new MarketStateFrameError("INVALID_AS_OF","asOf must be finite when provided");
  const seen=new Set<string>();const markets=inputs.map(input=>{const identity=`${input.manifest.market}::${input.manifest.interval}`;if(seen.has(identity))throw new MarketStateFrameError("DUPLICATE_MARKET_INTERVAL",`duplicate market/interval ${identity}`);seen.add(identity);return buildObservation(input,lookbackPeriods,options.asOf);}).sort((a,b)=>a.market.localeCompare(b.market)||a.interval.localeCompare(b.interval));
  const lookbackReturns=markets.map(m=>m.lookbackReturn),volatilities=markets.map(m=>m.realizedVolatility),averageReturn=mean(lookbackReturns),crossSectionalDispersion=Math.sqrt(mean(lookbackReturns.map(v=>(v-averageReturn)**2)));
  return freeze({schemaVersion:1,generatedAt,lookbackPeriods,markets:Object.freeze(markets),aggregate:freeze({marketCount:markets.length,positiveBreadth:markets.filter(m=>m.lookbackReturn>0).length/markets.length,medianLookbackReturn:median(lookbackReturns),medianRealizedVolatility:median(volatilities),crossSectionalDispersion}),sourceDatasetIds:Object.freeze(markets.map(m=>m.datasetId))}) as MarketStateFrame;
}
