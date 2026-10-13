const d=JSON.parse(require("fs").readFileSync(require("path").join(__dirname,"..","docs","research-data","2026-10-12-upbit-60m-closes.json")));
const fee=0.0005,slip=0.0005,grid=[[5,20],[10,50],[20,100],[50,200]];
function run(c,s,l){let r=[],e=null;for(let t=l;t<c.length;t++){const w=c.slice(t-l+1,t+1).map(x=>x[1]);
 const a=w.slice(-s).reduce((x,y)=>x+y)/s,b=w.reduce((x,y)=>x+y)/l;
 if(e===null&&a>b)e=c[t][1]*(1+slip);else if(e!==null&&a<b){r.push(c[t][1]*(1-slip)*(1-fee)/(e*(1+fee))-1);e=null}}
 return r}
const net=r=>(r.reduce((p,v)=>p*(1+v),1)-1)*100;
const rows={};
for(const [s,l] of grid){for(const part of["IS","OOS"]){let nets=[],tr=0,bh=[];
 for(const[m,c] of Object.entries(d)){const cut=Math.floor(c.length*2/3);
  const seg=part==="IS"?c.slice(0,cut):c.slice(cut-l); // OOS gets warmup only
  const r=run(seg,s,l);nets.push(net(r));tr+=r.length;
  const base=part==="IS"?c.slice(0,cut):c.slice(cut);bh.push((base[base.length-1][1]/base[0][1]-1)*100)}
 console.log(`${s}/${l} ${part} meanNet=${(nets.reduce((a,b)=>a+b)/5).toFixed(2)}% trades=${tr} nets=[${nets.map(x=>x.toFixed(1))}] buyhold=[${bh.map(x=>x.toFixed(1))}]`)}}
