"use strict";
// Offline research, read-only (WO-RESEARCH-20261126-DESK-BATCH1). Analyst A: six cross-sectional daily families on the 56 KRW markets fetched by scripts/offline-crosssection-screen.js.
// Usage: node scripts/offline-desk-a-screen.js <dir with the daily JSON files>. Rules and bars: docs/research-data/desk-batch1-prereg-a-2026-11-26.md (sha256 7ccc192b...). No orders, no network.
"use strict";
const fs=require("fs"),path=require("path");
const DIR=process.argv[2]; if(!DIR){console.error("usage: <dir>");process.exit(2);}
const DAY=86400000,N=5,FEE=0.0015,STRESS=0.003,K=6,MINH=90;
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const std=a=>{const m=mean(a);return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1));};
function normalSf(z){const t=1/(1+0.2316419*Math.abs(z)),d=0.3989423*Math.exp(-z*z/2),p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return z>=0?p:1-p;}
const byDay={},first={},days=new Set();
for(const f of fs.readdirSync(DIR)){const m=f.replace(".json","");const rows=JSON.parse(fs.readFileSync(path.join(DIR,f)));if(!rows.length)continue;byDay[m]=new Map(rows.map(r=>[r[0],r]));first[m]=rows[0][0];rows.forEach(r=>days.add(r[0]));}
const D=[...days].sort((a,b)=>a-b),last=D[D.length-1],cut=last-365*DAY;
// series getter: rows for k=back..0, null if any missing
const seg=(m,t,n)=>{const o=[];for(let k=n;k>=0;k--){const r=byDay[m].get(t-k*DAY);if(!r)return null;o.push(r);}return o;};
const sret=c=>{const r=[];for(let i=1;i<c.length;i++)r.push(c[i]/c[i-1]-1);return r;};
const lret=c=>{const r=[];for(let i=1;i<c.length;i++)r.push(Math.log(c[i]/c[i-1]));return r;};
const FAM=[
{id:"SIZE_REV",H:7,pick:(t,el)=>{const c=[];for(const m of el){const s=seg(m,t,30);if(!s)continue;const to=mean(s.slice(1).map(r=>r[5]*r[4]));c.push({m,to,s:-(s[30][4]/s[23][4]-1)});}
 c.sort((a,b)=>a.to-b.to);return c.slice(0,Math.floor(c.length/2));}},
{id:"LISTING_AGE",H:7,pick:(t,el)=>{const c=[];for(const m of el){const age=(t-first[m])/DAY;if(age<90||age>240)continue;const s=seg(m,t,28);if(!s)continue;const cl=s.map(r=>r[4]);c.push({m,s:(cl[28]/cl[0]-1)/std(lret(cl))});}return c;}},
{id:"WEEKDAY_XS",H:3,cohortDay:t=>(t/DAY+4)%7===5,pick:(t,el)=>{const c=[];for(const m of el){const a=byDay[m].get(t),b=byDay[m].get(t-3*DAY);if(a&&b)c.push({m,s:a[4]/b[4]-1});}return c;}},
{id:"BTC_BETA_ROT",H:7,pick:(t,el)=>{const b=seg("KRW-BTC",t,60);if(!b)return[];const b20=byDay["KRW-BTC"].get(t-20*DAY);if(!b20||!(b[60][4]/b20[4]-1>0))return[];const br=sret(b.map(r=>r[4])),bm=mean(br),bv=br.reduce((x,y)=>x+(y-bm)**2,0);const c=[];
 for(const m of el){if(m==="KRW-BTC")continue;const s=seg(m,t,60);if(!s)continue;const r=sret(s.map(x=>x[4])),rm=mean(r);let cv=0;for(let i=0;i<60;i++)cv+=(r[i]-rm)*(br[i]-bm);c.push({m,s:cv/bv});}return c;}},
{id:"VOL_COMPRESS_BREAK",H:5,pick:(t,el)=>{const c=[];for(const m of el){const s=seg(m,t,139);if(!s)continue; // idx139 = D
 const rg=[];for(let d=119;d>=0;d--){const e=139-d;let hi=-Infinity,lo=Infinity;for(let i=e-9;i<=e;i++){hi=Math.max(hi,s[i][2]);lo=Math.min(lo,s[i][3]);}rg.push((hi-lo)/s[e][4]);}
 const cur=rg[119],sorted=[...rg].sort((a,b)=>a-b),q=sorted[Math.floor(0.2*119)];if(!(cur<=q))continue;
 let ph=-Infinity;for(let i=129;i<=138;i++)ph=Math.max(ph,s[i][2]);if(!(s[139][4]>ph))continue;
 const v=mean(s.slice(119,139).map(r=>r[5]));if(!(v>0))continue;c.push({m,s:s[139][5]/v});}return c;}},
{id:"DOWNVOL_LOW",H:14,pick:(t,el)=>{const c=[];for(const m of el){const s=seg(m,t,60);if(!s)continue;const neg=sret(s.map(r=>r[4])).filter(x=>x<0);if(neg.length<5)continue;c.push({m,s:-std(neg)});}return c;}},
];
const rows=[];
for(const fam of FAM){const cohorts=[];
 for(const t of D){if(fam.cohortDay){if(!fam.cohortDay(t))continue;}else if((t/DAY)%fam.H!==0)continue;
  const exit=t+fam.H*DAY;if(exit>last)continue;
  const el=Object.keys(byDay).filter(m=>byDay[m].has(t)&&t-first[m]>=MINH*DAY);if(el.length<20)continue;
  const picks=fam.pick(t,el).sort((a,b)=>b.s-a.s||(a.m<b.m?-1:1)).slice(0,N);if(!picks.length)continue;
  const ret=(m,fee)=>{const e=byDay[m].get(exit),en=byDay[m].get(t);if(!e)return null;return e[4]*(1-fee)/(en[4]*(1+fee))-1;};
  const avg=(ms,fee)=>{const v=ms.map(m=>ret(m,fee)).filter(x=>x!==null);return v.length?mean(v):null;};
  const pm=picks.map(x=>x.m);const p=avg(pm,FEE),b=avg(el,FEE),ps=avg(pm,STRESS),bs=avg(el,STRESS);if(p===null||b===null||ps===null)continue;
  cohorts.push({t,ex:p-b,exS:ps-bs,bench:b});}
 const fi=cohorts.filter(c=>c.t<cut),la=cohorts.filter(c=>c.t>=cut);const size=Math.floor(fi.length/6);const w=[];
 for(let i=0;i<6;i++){const part=fi.slice(i*size,(i+1)*size);w.push({ex:mean(part.map(c=>c.ex)),st:mean(part.map(c=>c.exS)),up:mean(part.map(c=>c.bench))>0});}
 const U=w.filter(x=>x.up),Dn=w.filter(x=>!x.up);
 const disc=size>=10&&w.filter(x=>x.ex>0).length>=4&&U.length>0&&Dn.length>0&&mean(U.map(x=>x.ex))>0&&mean(Dn.map(x=>x.ex))>0&&w.filter(x=>x.st>0).length>=4;
 const ex=la.map(c=>c.ex),m=mean(ex),sd=ex.length>1?std(ex):0,p=sd>0?normalSf(m/(sd/Math.sqrt(ex.length))):1;
 const sec=la.length>=30&&m>0&&p<0.05/K&&mean(la.map(c=>c.exS))>0;
 rows.push({id:fam.id,n:cohorts.length,pos:w.filter(x=>x.ex>0).length,up:U.length?mean(U.map(x=>x.ex)):NaN,dn:Dn.length?mean(Dn.map(x=>x.ex)):NaN,disc,ln:la.length,m,p,sec,nu:U.length,nd:Dn.length,wex:w.map(x=>(x.ex*100).toFixed(2)).join(",")});}
const pc=x=>isNaN(x)?"n/a":(x>=0?"+":"")+(x*100).toFixed(2)+"%";
console.log(`${Object.keys(byDay).length} markets, last ${new Date(last).toISOString().slice(0,10)}, p bar ${(0.05/K).toExponential(2)}`);
console.log("family | cohorts | +windows | UP excess | DOWN excess | discovery | last-365d cohorts | mean excess/cohort | p | second filter");
for(const r of rows)console.log(`${r.id} | ${r.n} | ${r.pos}/6 | ${pc(r.up)} (${r.nu}w) | ${pc(r.dn)} (${r.nd}w) | ${r.disc?"PASS":"fail"} | ${r.ln} | ${pc(r.m)} | ${r.p.toExponential(2)} | ${r.sec?"PASS":"fail"}   [win ex% ${r.wex}]`);
console.log(`SUMMARY: ${rows.filter(r=>r.disc).length} discovery, ${rows.filter(r=>r.disc&&r.sec).length} both`);
