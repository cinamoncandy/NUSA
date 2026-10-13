const d=JSON.parse(require("fs").readFileSync(require("path").join(__dirname,"..","docs","research-data","2026-10-12-upbit-60m-closes-250d.json")));
const fee=0.0005,slip=0.0005;
const net=r=>(r.reduce((p,v)=>p*(1+v),1)-1)*100;
function don(c,N){const M=N>>1,r=[];let e=null;for(let t=N;t<c.length;t++){const p=c[t][1];
 const hi=Math.max(...c.slice(t-N,t).map(x=>x[1])),lo=Math.min(...c.slice(t-M,t).map(x=>x[1]));
 if(e===null&&p>hi)e=p*(1+slip);else if(e!==null&&p<lo){r.push(p*(1-slip)*(1-fee)/(e*(1+fee))-1);e=null}}return r}
function mr(c,N){const r=[];let e=null;for(let t=N;t<c.length;t++){const w=c.slice(t-N+1,t+1).map(x=>x[1]);const m=w.reduce((a,b)=>a+b)/N;
 const sd=Math.sqrt(w.reduce((a,b)=>a+(b-m)**2,0)/N);const p=c[t][1],z=sd?(p-m)/sd:0;
 if(e===null&&z<-2)e=p*(1+slip);else if(e!==null&&z>0){r.push(p*(1-slip)*(1-fee)/(e*(1+fee))-1);e=null}}return r}
const sets=[["DON20",c=>don(c,20)],["DON50",c=>don(c,50)],["DON100",c=>don(c,100)],["MR20",c=>mr(c,20)],["MR50",c=>mr(c,50)]];
for(const[n,f] of sets)for(const part of["IS","OOS"]){let nets=[],tr=0;
 for(const c of Object.values(d)){const cut=Math.floor(c.length*2/3);const seg=part==="IS"?c.slice(0,cut):c.slice(cut-100);const r=f(seg);nets.push(net(r));tr+=r.length}
 console.log(n,part,"mean",(nets.reduce((a,b)=>a+b)/5).toFixed(2)+"%","trades",tr,"["+nets.map(x=>x.toFixed(1))+"]")}
