"use strict";
// Offline research, read-only (WO-RESEARCH-20261126-DESK-BATCH1). Analyst B: six UTC time-of-day rules on 5-minute candles of five KRW markets fetched by scripts/offline-scalp-screen.js.
// Usage: node scripts/offline-desk-b-screen.js <dir with the 5-minute JSON files>. Rules and bars: docs/RESEARCH_DESK_BATCH1_RESULT_2026-11-26.md (PREREG sha256 5414d886...). No orders, no network.
const fs=require("fs");const P=(process.argv[2]||"")+"/"; if(!process.argv[2]){console.error("usage: <dir>");process.exit(2);}
const M=["KRW-BTC","KRW-ETH","KRW-XRP","KRW-SOL","KRW-DOGE"],BAR=300000,K=6,W=6,P2=90*288,COST=0.001,ST=0.0015;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sd=a=>{const m=mean(a);return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/Math.max(1,a.length-1))};
function sf(z){const t=1/(1+0.2316419*Math.abs(z)),d=0.3989423*Math.exp(-z*z/2),p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return z>=0?p:1-p}
const D={};for(const m of M)D[m]=JSON.parse(fs.readFileSync(P+m+".json"));
const bars=Math.min(...M.map(m=>D[m].length)),cut=bars-P2,size=Math.floor(cut/W),winOf=i=>Math.min(W-1,Math.floor(i/size));
const winRet=Array.from({length:W},(_,w)=>mean(M.map(m=>D[m][Math.min(cut,(w+1)*size)-1][4]/D[m][w*size][4]-1)));
// rule: [name, H, entry predicate(rows,i)]
const hm=t=>{const d=new Date(t);return d.getUTCHours()*60+d.getUTCMinutes()};
const at=(h)=>(r,i)=>hm(r[i][0])===h*60;
const R=[["HOUR_00_03",35,at(0)],["HOUR_08_11",35,at(8)],["HOUR_13_16",35,at(13)],
["KST_OPEN_REV",11,(r,i)=>hm(r[i][0])===0&&i>=49&&r[i][0]-r[i-49][0]===49*BAR&&r[i-1][4]/r[i-49][4]-1<-0.01],
["SUN_NIGHT",71,(r,i)=>hm(r[i][0])===1200&&new Date(r[i][0]).getUTCDay()===0],
["FIRST_BAR_BREAK",71,(r,i)=>hm(r[i][0])===0&&i>=1&&r[i][0]-r[i-1][0]===BAR&&r[i][4]>r[i-1][4]*1.005]];
const pc=x=>(x>=0?"+":"")+(x*100).toFixed(3)+"%";
console.log(`bars ${bars} cut ${cut} K=${K} p-bar ${(0.05/K).toExponential(2)}; winRet`,winRet.map(x=>pc(x)).join(" "));
console.log("rule | trades p1 | gross p1 | net p1 | +win | UP | DOWN | part1 | trades p2 | net p2 | stress p2 | p | part2");
for(const [name,H,pred] of R){const tr=[];
 for(const m of M){const r=D[m];for(let i=0;i+H<bars;i++){if(!pred(r,i))continue;if(r[i+H][0]-r[i][0]!==H*BAR)continue;tr.push({i,g:r[i+H][4]/r[i][4]-1});}}
 const net=(t,f)=>t.g-2*f-2*f*t.g;
 const p1=tr.filter(t=>t.i+H<cut),p2=tr.filter(t=>t.i>=cut);
 const wins=Array.from({length:W},(_,w)=>p1.filter(t=>winOf(t.i)===w));
 const wN=wins.map(x=>mean(x.map(t=>net(t,COST)))),wS=wins.map(x=>mean(x.map(t=>net(t,ST))));
 const up=wN.filter((_,w)=>winRet[w]>0),dn=wN.filter((_,w)=>winRet[w]<=0);
 const part1=p1.length>=300&&wins.every(x=>x.length>0)&&wN.filter(x=>x>0).length>=4&&up.length&&dn.length&&mean(up)>0&&mean(dn)>0&&wS.filter(x=>x>0).length>=4;
 const n2=p2.map(t=>net(t,COST)),m2=mean(n2),z=n2.length>1&&sd(n2)>0?m2/(sd(n2)/Math.sqrt(n2.length)):0,pv=sf(z);
 const s2=mean(p2.map(t=>net(t,ST)));
 const part2=p2.length>=100&&m2>0&&pv<0.05/K&&s2>0;
 console.log(`${name} | ${p1.length} | ${pc(mean(p1.map(t=>t.g)))} | ${pc(mean(p1.map(t=>net(t,COST))))} | ${wN.filter(x=>x>0).length}/6 | ${pc(mean(up))} | ${pc(mean(dn))} | ${part1?"PASS":"fail"} | ${p2.length} | ${pc(m2)} | ${pc(s2)} | ${pv.toExponential(2)} | ${part2?"PASS":"fail"}`);}
