"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const{createHistoricalDatasetManifest}=require("../dist/apps/desktop/src/cloud/researchDataset.js");
const{MarketStateFrameError,buildMarketStateFrame}=require("../dist/apps/desktop/src/cloud/marketStateFrame.js");

function candles(market,closes,{interval="1d",volumes,quoteVolumes}={}){
  const day=86400000;
  return closes.map((close,index)=>{
    const open=index===0?close:closes[index-1];
    const high=Math.max(open,close)*1.01;
    const low=Math.min(open,close)*.99;
    return{market,interval,openTime:index*day,closeTime:(index+1)*day,open,high,low,close,volume:volumes?.[index]??100+index,...(quoteVolumes?{quoteVolume:quoteVolumes[index]}:{})};
  });
}

function dataset(market,closes,options={}){
  const rows=candles(market,closes,options);
  return{candles:rows,manifest:createHistoricalDatasetManifest(rows,{source:"fixture",createdAt:"2026-08-25T00:00:00.000Z"})};
}

test("MarketStateFrame deterministically summarizes multi-market state",()=>{
  const up=dataset("KRW-BTC",[100,102,104,103,106],{quoteVolumes:[1000,1100,1200,1300,1400]});
  const down=dataset("KRW-ETH",[200,198,195,197,194],{quoteVolumes:[2000,1900,1800,1700,1600]});
  const frame=buildMarketStateFrame([down,up],{lookbackPeriods:4,generatedAt:"2026-08-25T01:00:00.000Z"});
  assert.equal(frame.schemaVersion,1);
  assert.deepEqual(frame.markets.map(m=>m.market),["KRW-BTC","KRW-ETH"]);
  assert.equal(frame.aggregate.marketCount,2);
  assert.equal(frame.aggregate.positiveBreadth,.5);
  assert.ok(frame.markets[0].lookbackReturn>0);
  assert.ok(frame.markets[1].lookbackReturn<0);
  assert.ok(frame.markets.every(m=>m.realizedVolatility>=0&&m.maxDrawdown<=0));
  assert.ok(frame.aggregate.crossSectionalDispersion>0);
  assert.deepEqual(frame.sourceDatasetIds,frame.markets.map(m=>m.datasetId));
  assert.equal(Object.isFrozen(frame),true);
});

test("MarketStateFrame preserves missing quote-volume truth instead of fabricating it",()=>{
  const partial=dataset("KRW-XRP",[10,11,10.5,11.5],{quoteVolumes:[100,undefined,120,130]});
  const frame=buildMarketStateFrame([partial],{lookbackPeriods:3});
  assert.equal(frame.markets[0].averageQuoteVolume,undefined);
});

test("MarketStateFrame fails closed on duplicate identities and insufficient history",()=>{
  const first=dataset("KRW-BTC",[100,101,102,103]);
  assert.throws(()=>buildMarketStateFrame([first,first],{lookbackPeriods:3}),e=>e instanceof MarketStateFrameError&&e.code==="DUPLICATE_MARKET_INTERVAL");
  assert.throws(()=>buildMarketStateFrame([dataset("KRW-ETH",[10,11,12])],{lookbackPeriods:3}),e=>e instanceof MarketStateFrameError&&e.code==="INSUFFICIENT_LOOKBACK");
});

test("MarketStateFrame rejects invalid configuration",()=>{
  const input=dataset("KRW-BTC",[100,101,102]);
  assert.throws(()=>buildMarketStateFrame([input],{lookbackPeriods:1}),e=>e instanceof MarketStateFrameError&&e.code==="INVALID_LOOKBACK");
  assert.throws(()=>buildMarketStateFrame([input],{lookbackPeriods:2,generatedAt:"not-a-date"}),e=>e instanceof MarketStateFrameError&&e.code==="INVALID_GENERATED_AT");
});
