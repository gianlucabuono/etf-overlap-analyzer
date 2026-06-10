import { useState, useMemo } from "react";

const COLORS = ["#6366f1","#10b981","#f59e0b","#ef4444","#3b82f6","#ec4899","#8b5cf6","#14b8a6","#f97316","#84cc16"];

// 11 visually distinct sector colors
const SECTOR_COLORS_LIST = [
  "#6366f1","#10b981","#f59e0b","#ef4444","#3b82f6",
  "#ec4899","#8b5cf6","#14b8a6","#f97316","#84cc16","#a78bfa"
];
let _sectorColorMap = {};
let _sectorColorIdx = 0;
function getSectorColor(sector) {
  if (!_sectorColorMap[sector]) {
    _sectorColorMap[sector] = SECTOR_COLORS_LIST[_sectorColorIdx % SECTOR_COLORS_LIST.length];
    _sectorColorIdx++;
  }
  return _sectorColorMap[sector];
}
function resetSectorColors() { _sectorColorMap = {}; _sectorColorIdx = 0; }

const fmt = n => `€${Math.round(n).toLocaleString("it-IT")}`;
const fmtPct = n => `${n.toFixed(2)}%`;
const selStyle = {padding:"6px 10px",borderRadius:8,border:"2px solid #e5e7eb",fontSize:13,outline:"none"};

function splitCSVLine(line) {
  const res=[]; let cur="", inQ=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"'){inQ=!inQ;continue;}
    if(c===','&&!inQ){res.push(cur.trim());cur="";continue;}
    cur+=c;
  }
  res.push(cur.trim()); return res;
}

function parseWeight(str) {
  if(!str) return 0;
  const c=str.replace(/"/g,"").trim();
  if(c.includes(".")&&c.includes(",")) return parseFloat(c.replace(/\./g,"").replace(",","."))||0;
  if(c.includes(",")&&!c.includes(".")) return parseFloat(c.replace(",","."))||0;
  return parseFloat(c)||0;
}

function normalizeName(name) {
  return name.replace(/"/g,"").replace(/\s+/g," ").trim().toUpperCase();
}

function parseCSV(text) {
  const lines=text.split("\n").map(l=>l.trim()).filter(Boolean);
  if(lines.length<2) return {holdings:[],skipped:0};
  let hi=0;
  for(let i=0;i<Math.min(15,lines.length);i++){
    const low=lines[i].toLowerCase();
    if(low.includes("nome")||low.includes("name")||low.includes("ticker")||low.includes("ponderazione")||low.includes("weight")){hi=i;break;}
  }
  const headers=splitCSVLine(lines[hi]).map(h=>h.replace(/"/g,"").trim().toLowerCase());
  const ni=headers.findIndex(h=>h==="nome"||h.includes("nome")||h==="name"||h.includes("issuer")||h==="company");
  const wi=headers.findIndex(h=>h.includes("ponderazione")||h.includes("weight")||h.includes("allocation")||h==="%");
  const ti=headers.findIndex(h=>h==="ticker"||h==="symbol"||h.includes("ticker dell"));
  const si=headers.findIndex(h=>h.includes("settore")||h.includes("sector"));
  const ai=headers.findIndex(h=>h.includes("asset class")||h==="asset class");
  const gi=headers.findIndex(h=>h.includes("area geografica")||h.includes("geography")||h.includes("country")||h.includes("paese")||h.includes("area geo"));
  if(ni===-1) return {holdings:[],skipped:0};
  const holdings=[]; let skipped=0;
  for(let i=hi+1;i<lines.length;i++){
    const cols=splitCSVLine(lines[i]);
    const name=cols[ni]?.replace(/"/g,"").trim();
    if(!name||name.length<1){skipped++;continue;}
    const ac=(ai!==-1?cols[ai]?.replace(/"/g,"").trim().toLowerCase():"");
    if(ac.includes("futures")||ac==="fx"){skipped++;continue;}
    const weight=wi!==-1?parseWeight(cols[wi]):0;
    const ticker=ti!==-1?cols[ti]?.replace(/"/g,"").trim():"";
    const sector=si!==-1?(cols[si]?.replace(/"/g,"").trim()||"Altro"):"Altro";
    const country=gi!==-1?(cols[gi]?.replace(/"/g,"").trim()||"N/D"):"N/D";
    holdings.push({name:normalizeName(name),ticker,weight,sector,country});
  }
  return {holdings,skipped};
}

function computeOverlap(etfA,etfB) {
  const mA={},mB={};
  etfA.forEach(h=>{mA[h.name]={weight:h.weight,sector:h.sector,country:h.country};});
  etfB.forEach(h=>{mB[h.name]={weight:h.weight,sector:h.sector,country:h.country};});
  const common=[];
  Object.keys(mA).forEach(name=>{
    if(mB[name]!==undefined)
      common.push({name,weightA:mA[name].weight,weightB:mB[name].weight,avgWeight:(mA[name].weight+mB[name].weight)/2,sector:mA[name].sector,country:mA[name].country});
  });
  return {common:common.sort((a,b)=>b.avgWeight-a.avgWeight),overlapPct:Math.min(common.reduce((s,c)=>s+Math.min(c.weightA,c.weightB),0),100)};
}

function calcOverlapWeight(h, mode) {
  if(mode==="min") return Math.min(h.weightA, h.weightB);
  if(mode==="avg") return (h.weightA + h.weightB) / 2;
  return h.weightA + h.weightB; // sum
}

function computeOverlapPct(common, mode) {
  return Math.min(common.reduce((s,c)=>s+calcOverlapWeight(c,mode),0), mode==="sum"?200:100);
}

// ── Overlap Mode Selector ──
function OverlapModeSelector({mode, setMode}) {
  const options = [
    {id:"min", label:"Minimo", desc:'min(A,B) — quota certamente duplicata (metodo JustETF)'},
    {id:"avg", label:"Media", desc:'(A+B)/2 — esposizione media nel portafoglio combinato'},
    {id:"sum", label:"Somma", desc:'A+B — esposizione totale combinata su ogni titolo'},
  ];
  return (
    <div style={{background:"#f9fafb",borderRadius:12,padding:"12px 16px",marginBottom:16}}>
      <div style={{fontWeight:700,fontSize:13,color:"#374151",marginBottom:8}}>📐 Metodo di calcolo overlap ponderato</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {options.map(o=>(
          <button key={o.id} onClick={()=>setMode(o.id)}
            style={{...selStyle,border:`2px solid ${mode===o.id?"#6366f1":"#e5e7eb"}`,background:mode===o.id?"#ede9fe":"#fff",color:mode===o.id?"#4338ca":"#374151",fontWeight:700,cursor:"pointer",textAlign:"left"}}>
            <div style={{fontWeight:700}}>{o.label}</div>
            <div style={{fontSize:10,color:"#6b7280",fontWeight:400,maxWidth:180}}>{o.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Venn Diagram ──
function VennDiagram({etfs, matrix, mode}) {
  const [tooltip,setTooltip]=useState(null);
  if(etfs.length<2) return null;
  const W=500,H=320,cx=W/2,cy=H/2;
  const maxH=Math.max(...etfs.map(e=>e.holdings.length));
  const n=etfs.length;
  const spread=n===2?85:n===3?75:65;
  const positioned=etfs.map((etf,i)=>{
    const angle=(2*Math.PI*i/n)-Math.PI/2;
    const r=Math.max(50,Math.min(110,(etf.holdings.length/maxH)*110));
    return {...etf,r,x:cx+Math.cos(angle)*spread,y:cy+Math.sin(angle)*spread};
  });
  const pairInfo=[];
  for(let i=0;i<etfs.length;i++) for(let j=i+1;j<etfs.length;j++){
    const ov=matrix[`${i}-${j}`]||matrix[`${j}-${i}`];
    if(!ov) continue;
    const a=positioned[i],b=positioned[j];
    const pct=computeOverlapPct(ov.common,mode);
    pairInfo.push({x:(a.x+b.x)/2,y:(a.y+b.y)/2,pct,count:ov.common.length,nameA:etfs[i].name,nameB:etfs[j].name});
  }

  const modeLabel = mode==="min"?"min(A,B)":mode==="avg"?"(A+B)/2":"A+B";
  const modeDesc = mode==="min"
    ? "Somma di min(pesoA, pesoB) per ogni titolo in comune — quota certamente duplicata in entrambi gli ETF"
    : mode==="avg"
    ? "Somma di (pesoA+pesoB)/2 per ogni titolo in comune — peso medio nel portafoglio combinato"
    : "Somma di (pesoA+pesoB) per ogni titolo in comune — esposizione totale complessiva";

  return (
    <div style={{position:"relative"}}>
      <p style={{fontSize:12,color:"#6b7280",marginBottom:4}}>Dimensione cerchio = numero holdings · Il % al centro = overlap ponderato</p>
      <div style={{background:"#ede9fe",borderRadius:10,padding:"8px 12px",marginBottom:10,fontSize:11,color:"#4338ca"}}>
        <strong>Come si calcola il %:</strong> {modeDesc} — formula: <strong>{modeLabel}</strong>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
        {positioned.map((c,i)=><circle key={i} cx={c.x} cy={c.y} r={c.r} fill={c.color} opacity={0.22} stroke={c.color} strokeWidth={2}/>)}
        {positioned.map((c,i)=>(
          <g key={i}>
            <text x={c.x} y={c.y-c.r-8} textAnchor="middle" fontSize={12} fontWeight="700" fill={c.color}>{c.name}</text>
            <text x={c.x} y={c.y+4} textAnchor="middle" fontSize={11} fontWeight="600" fill={c.color}>{c.holdings.length} holdings</text>
          </g>
        ))}
        {pairInfo.map((p,i)=>(
          <g key={i} style={{cursor:"pointer"}} onMouseEnter={()=>setTooltip(p)} onMouseLeave={()=>setTooltip(null)}>
            <circle cx={p.x} cy={p.y} r={24} fill="rgba(255,255,255,0.75)" stroke="none"/>
            <text x={p.x} y={p.y-4} textAnchor="middle" fontSize={12} fontWeight="800" fill="#1e1b4b">{p.pct.toFixed(1)}%</text>
            <text x={p.x} y={p.y+9} textAnchor="middle" fontSize={9} fill="#6b7280">{p.count} titoli</text>
          </g>
        ))}
      </svg>
      {tooltip&&(
        <div style={{position:"absolute",left:10,bottom:10,background:"#1e1b4b",color:"#fff",padding:"8px 12px",borderRadius:10,fontSize:12,fontWeight:600,pointerEvents:"none",zIndex:10}}>
          <div style={{marginBottom:4}}>{tooltip.nameA} ↔ {tooltip.nameB}</div>
          <div style={{color:"#6ee7b7"}}>Overlap ({modeLabel}): {fmtPct(tooltip.pct)}</div>
          <div style={{color:"#a5b4fc"}}>{tooltip.count} titoli in comune</div>
        </div>
      )}
    </div>
  );
}

// ── Heatmap NxN ──
function HeatmapNxN({etfs,matrix}) {
  const [tooltip,setTooltip]=useState(null);
  const [limit,setLimit]=useState(20);
  const allOverlaps=useMemo(()=>{
    const map={};
    for(let i=0;i<etfs.length;i++) for(let j=i+1;j<etfs.length;j++){
      const ov=matrix[`${i}-${j}`]; if(!ov) continue;
      ov.common.forEach(h=>{
        if(!map[h.name]) map[h.name]={name:h.name,weights:{}};
        map[h.name].weights[etfs[i].name]=h.weightA;
        map[h.name].weights[etfs[j].name]=h.weightB;
      });
    }
    return Object.values(map).sort((a,b)=>Object.values(b.weights).reduce((s,v)=>s+v,0)-Object.values(a.weights).reduce((s,v)=>s+v,0));
  },[etfs,matrix]);
  const shown=allOverlaps.slice(0,limit);
  if(!allOverlaps.length) return <div style={{textAlign:"center",color:"#6b7280",padding:20}}>Nessuna sovrapposizione trovata</div>;
  const maxW=Math.max(...shown.flatMap(h=>Object.values(h.weights)));
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap"}}>
        <p style={{fontSize:12,color:"#6b7280",margin:0}}>Intensità colore = peso nell'ETF · Hover per dettaglio</p>
        <select value={limit} onChange={e=>setLimit(+e.target.value)} style={selStyle}>
          <option value={20}>Top 20</option><option value={50}>Top 50</option><option value={100}>Top 100</option>
        </select>
        <span style={{fontSize:12,color:"#9ca3af"}}>({allOverlaps.length} totali)</span>
      </div>
      <div style={{overflowX:"auto",overflowY:"auto",maxHeight:460}}>
        <table style={{borderCollapse:"collapse",fontSize:11,minWidth:300}}>
          <thead>
            <tr>
              <th style={{padding:"6px 10px",background:"#f9fafb",fontWeight:700,textAlign:"left",borderBottom:"2px solid #e5e7eb",position:"sticky",top:0,left:0,zIndex:2,minWidth:160}}>Titolo</th>
              {etfs.map((etf,i)=><th key={i} style={{padding:"6px 10px",background:"#f9fafb",fontWeight:700,textAlign:"center",borderBottom:"2px solid #e5e7eb",color:etf.color,position:"sticky",top:0,zIndex:1,whiteSpace:"nowrap"}}>{etf.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((h,i)=>(
              <tr key={i} style={{background:i%2===0?"#fff":"#fafafa"}}>
                <td style={{padding:"5px 10px",fontWeight:600,color:"#374151",position:"sticky",left:0,background:i%2===0?"#fff":"#fafafa",zIndex:1,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={h.name}>{h.name}</td>
                {etfs.map((etf,j)=>{
                  const w=h.weights[etf.name]||0;
                  const intensity=w/maxW;
                  return (
                    <td key={j} style={{padding:"5px 10px",textAlign:"center",background:w>0?`rgba(99,102,241,${0.1+intensity*0.8})`:"#f9fafb",color:intensity>0.5?"#fff":"#374151",fontWeight:600,cursor:"pointer"}}
                      onMouseEnter={e=>setTooltip({h,etf,w,x:e.clientX,y:e.clientY})} onMouseLeave={()=>setTooltip(null)}>
                      {w>0?fmtPct(w):"—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tooltip&&<div style={{position:"fixed",left:tooltip.x+12,top:tooltip.y-40,background:"#1e1b4b",color:"#fff",padding:"6px 10px",borderRadius:8,fontSize:11,fontWeight:600,pointerEvents:"none",zIndex:9999,whiteSpace:"nowrap"}}>{tooltip.h.name} in {tooltip.etf.name}: {fmtPct(tooltip.w)}</div>}
    </div>
  );
}

// ── Sector Heatmap (bug-fixed for 3+ ETFs) ──
function SectorHeatmap({etfs, matrix, mode}) {
  // Collect all sectors
  const sectors=[...new Set(etfs.flatMap(e=>e.holdings.map(h=>h.sector)))].filter(Boolean);
  resetSectorColors();
  sectors.forEach(sec=>getSectorColor(sec)); // assign colors in consistent order

  // Total unique holdings per sector across all ETFs
  const sectorTotals={};
  etfs.forEach(etf=>etf.holdings.forEach(h=>{
    const sec=h.sector||"Altro";
    if(!sectorTotals[sec]) sectorTotals[sec]=new Set();
    sectorTotals[sec].add(h.name);
  }));

  // Collect overlapping holdings per sector — deduplicated across all pairs
  const sectorData={};
  sectors.forEach(sec=>{
    // Map: name -> {weightA, weightB} — use max weight seen across all pairs
    const nameWeights={};
    for(let i=0;i<etfs.length;i++) for(let j=i+1;j<etfs.length;j++){
      const ov=matrix[`${i}-${j}`]; if(!ov) continue;
      ov.common.filter(h=>h.sector===sec).forEach(h=>{
        if(!nameWeights[h.name]) nameWeights[h.name]={wA:h.weightA,wB:h.weightB};
        else {
          nameWeights[h.name].wA=Math.max(nameWeights[h.name].wA,h.weightA);
          nameWeights[h.name].wB=Math.max(nameWeights[h.name].wB,h.weightB);
        }
      });
    }
    const entries=Object.values(nameWeights);
    const overlapCount=Object.keys(nameWeights).length;
    const weightSum=entries.reduce((s,v)=>s+calcOverlapWeight({weightA:v.wA,weightB:v.wB},mode),0);
    sectorData[sec]={overlapCount,totalCount:sectorTotals[sec]?.size||0,weightSum};
  });

  const maxCount=Math.max(...Object.values(sectorData).map(d=>d.overlapCount),1);
  const modeLabel=mode==="min"?"min(A,B)":mode==="avg"?"(A+B)/2":"A+B";

  return (
    <div>
      <p style={{fontSize:12,color:"#6b7280",marginBottom:4}}>Titoli sovrapposti vs totale per settore</p>
      <p style={{fontSize:11,color:"#9ca3af",marginBottom:12}}>
        <strong>% overlap ({modeLabel})</strong>: somma di {modeLabel} per ogni titolo sovrapposto nel settore — indica il peso finanziario duplicato. Es: NVIDIA pesa 5% in ETF1 e 3% in ETF2 → contribuisce {mode==="min"?"3%":mode==="avg"?"4%":"8%"} all'overlap.
      </p>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {sectors.sort((a,b)=>sectorData[b].overlapCount-sectorData[a].overlapCount).map(sec=>{
          const {overlapCount,totalCount,weightSum}=sectorData[sec];
          const barPct=overlapCount/maxCount*100;
          const overlapRatio=totalCount>0?((overlapCount/totalCount)*100).toFixed(0):0;
          const col=getSectorColor(sec);
          return (
            <div key={sec} style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:178,fontSize:11,fontWeight:600,color:"#374151",flexShrink:0,textAlign:"right"}}>{sec}</div>
              <div style={{flex:1,background:"#f3f4f6",borderRadius:99,height:26,overflow:"hidden",position:"relative"}}>
                <div style={{width:`${barPct}%`,background:col,height:"100%",borderRadius:99}}/>
                <span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",fontSize:10,fontWeight:700,color:barPct>35?"#fff":"#374151",whiteSpace:"nowrap"}}>
                  {overlapCount}/{totalCount} titoli ({overlapRatio}%) · overlap: {fmtPct(weightSum)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Bar Chart ──
function BarChart({etfs,matrix}) {
  const [limit,setLimit]=useState(20);
  const allOverlaps=useMemo(()=>{
    const map={};
    for(let i=0;i<etfs.length;i++) for(let j=i+1;j<etfs.length;j++){
      const ov=matrix[`${i}-${j}`]; if(!ov) continue;
      ov.common.forEach(h=>{
        if(!map[h.name]) map[h.name]={name:h.name,weights:{}};
        map[h.name].weights[etfs[i].name]=h.weightA;
        map[h.name].weights[etfs[j].name]=h.weightB;
      });
    }
    return Object.values(map).sort((a,b)=>Object.values(b.weights).reduce((s,v)=>s+v,0)-Object.values(a.weights).reduce((s,v)=>s+v,0));
  },[etfs,matrix]);
  const shown=allOverlaps.slice(0,limit);
  if(!allOverlaps.length) return <div style={{textAlign:"center",color:"#6b7280",padding:20}}>Nessuna sovrapposizione trovata</div>;
  const maxW=Math.max(...shown.flatMap(h=>Object.values(h.weights)));
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:12,flex:1,flexWrap:"wrap"}}>
          {etfs.map((etf,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:4,fontSize:12}}><div style={{width:12,height:12,borderRadius:2,background:etf.color}}/><span style={{fontWeight:600,color:"#374151"}}>{etf.name}</span></div>)}
        </div>
        <select value={limit} onChange={e=>setLimit(+e.target.value)} style={selStyle}>
          <option value={20}>Top 20</option><option value={50}>Top 50</option><option value={100}>Top 100</option>
        </select>
        <span style={{fontSize:12,color:"#9ca3af"}}>({allOverlaps.length} totali)</span>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:500,overflowY:"auto"}}>
        {shown.map((h,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:150,fontSize:11,fontWeight:600,color:"#374151",textAlign:"right",flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={h.name}>{h.name}</div>
            <div style={{flex:1,display:"flex",flexDirection:"column",gap:2}}>
              {etfs.map((etf,j)=>{
                const w=h.weights[etf.name]||0;
                return (
                  <div key={j} style={{display:"flex",alignItems:"center",gap:4}}>
                    <div style={{flex:1,background:"#f3f4f6",borderRadius:99,height:14,overflow:"hidden"}}>
                      <div style={{width:`${w/maxW*100}%`,background:etf.color,height:"100%",borderRadius:99,minWidth:w>0?4:0}}/>
                    </div>
                    <span style={{fontSize:10,color:"#6b7280",width:36,textAlign:"right"}}>{w>0?fmtPct(w):"-"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Treemap (bug-fixed + better info) ──
function Treemap({etfs, matrix, mode}) {
  const MAX_SHOWN=12;
  const sectorMap=useMemo(()=>{
    resetSectorColors();
    const sectorTotals={};
    etfs.forEach(etf=>etf.holdings.forEach(h=>{
      const sec=h.sector||"Altro";
      if(!sectorTotals[sec]) sectorTotals[sec]=new Set();
      sectorTotals[sec].add(h.name);
    }));
    const m={};
    // Deduplicate: for each sector, collect unique overlapping names with max weights
    for(let i=0;i<etfs.length;i++) for(let j=i+1;j<etfs.length;j++){
      const ov=matrix[`${i}-${j}`]; if(!ov) continue;
      ov.common.forEach(h=>{
        const sec=h.sector||"Altro";
        if(!m[sec]) m[sec]={sector:sec,nameWeights:{},overlapPct:0,totalCount:sectorTotals[sec]?.size||0};
        if(!m[sec].nameWeights[h.name]) m[sec].nameWeights[h.name]={wA:h.weightA,wB:h.weightB};
        else {
          m[sec].nameWeights[h.name].wA=Math.max(m[sec].nameWeights[h.name].wA,h.weightA);
          m[sec].nameWeights[h.name].wB=Math.max(m[sec].nameWeights[h.name].wB,h.weightB);
        }
      });
    }
    // Finalize
    Object.values(m).forEach(sec=>{
      const entries=Object.entries(sec.nameWeights);
      sec.items=entries.map(([name,v])=>({name,weight:(v.wA+v.wB)/2})).sort((a,b)=>b.weight-a.weight);
      sec.overlapCount=entries.length;
      sec.overlapPct=entries.reduce((s,[,v])=>s+calcOverlapWeight({weightA:v.wA,weightB:v.wB},mode),0);
      delete sec.nameWeights;
    });
    return m;
  },[etfs,matrix,mode]);

  const sectors=Object.values(sectorMap).sort((a,b)=>b.overlapCount-a.overlapCount).slice(0,9);
  if(!sectors.length) return <div style={{textAlign:"center",color:"#6b7280",padding:20}}>Nessuna sovrapposizione trovata</div>;
  const grandTotal=sectors.reduce((s,sec)=>s+sec.overlapCount,0);
  const modeLabel=mode==="min"?"min(A,B)":mode==="avg"?"(A+B)/2":"A+B";

  return (
    <div>
      <p style={{fontSize:12,color:"#6b7280",marginBottom:4}}>Titoli sovrapposti raggruppati per settore</p>
      <p style={{fontSize:11,color:"#9ca3af",marginBottom:12}}>
        Badge = <strong>% overlap ({modeLabel})</strong>: peso finanziario duplicato nel settore · Riga sotto = titoli sovrapposti / totale titoli nel settore
      </p>
      <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
        {sectors.map((sec,si)=>{
          const col=getSectorColor(sec.sector);
          const secPct=sec.overlapCount/grandTotal*100;
          const shown=sec.items.slice(0,MAX_SHOWN);
          const hidden=sec.items.length-shown.length;
          const overlapRatio=sec.totalCount>0?((sec.overlapCount/sec.totalCount)*100).toFixed(0):0;
          return (
            <div key={si} style={{background:col+"15",border:`2px solid ${col}`,borderRadius:14,padding:"10px 14px",flex:`${Math.max(secPct,8)} 1 150px`,minWidth:150}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <span style={{fontWeight:700,fontSize:12,color:col}}>{sec.sector}</span>
                <span title={`% overlap cumulativa (${modeLabel})`} style={{background:col,color:"#fff",borderRadius:99,padding:"2px 8px",fontSize:10,fontWeight:700,cursor:"help"}}>{fmtPct(sec.overlapPct)}</span>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:6}}>
                {shown.map((item,ii)=>{
                  const itemPct=item.weight/(sec.items.reduce((s,x)=>s+x.weight,0)||1);
                  return (
                    <div key={ii} style={{background:col,borderRadius:6,padding:"2px 7px",fontSize:Math.max(9,Math.min(12,9+itemPct*20)),fontWeight:600,color:"#fff",opacity:0.65+itemPct*1.5,maxWidth:"100%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={`${item.name} — ${fmtPct(item.weight)}`}>
                      {item.name.split(" ")[0]}
                    </div>
                  );
                })}
                {hidden>0&&<div style={{background:"#e5e7eb",borderRadius:6,padding:"2px 7px",fontSize:10,fontWeight:600,color:"#6b7280"}}>{shown.length} di {sec.items.length} mostrati (+{hidden})</div>}
              </div>
              <div style={{fontSize:10,color:col,fontWeight:700,borderTop:`1px solid ${col}33`,paddingTop:4}}>
                {sec.overlapCount}/{sec.totalCount} sovrapposti ({overlapRatio}%)
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Geography ──
function Geography({etfs}) {
  const [activeEtf,setActiveEtf]=useState(0);
  const etf=etfs[Math.min(activeEtf,etfs.length-1)];
  const countryData=useMemo(()=>{
    const map={};
    etf.holdings.forEach(h=>{
      const c=h.country||"N/D";
      if(!map[c]) map[c]={country:c,count:0,weight:0};
      map[c].count++; map[c].weight+=h.weight;
    });
    return Object.values(map).sort((a,b)=>b.weight-a.weight);
  },[etf]);
  const top10=countryData.slice(0,10);
  const otherWeight=countryData.slice(10).reduce((s,c)=>s+c.weight,0);
  const maxW=Math.max(...top10.map(c=>c.weight),0.1);

  const geoOverlap=useMemo(()=>{
    if(etfs.length<2) return [];
    const result=[];
    for(let i=0;i<etfs.length;i++) for(let j=i+1;j<etfs.length;j++){
      const cMap={};
      etfs[i].holdings.forEach(h=>{const c=h.country||"N/D";if(!cMap[c])cMap[c]={wA:0,wB:0};cMap[c].wA+=h.weight;});
      etfs[j].holdings.forEach(h=>{const c=h.country||"N/D";if(!cMap[c])cMap[c]={wA:0,wB:0};cMap[c].wB+=h.weight;});
      const overlap=Object.values(cMap).reduce((s,v)=>s+Math.min(v.wA,v.wB),0);
      result.push({nameA:etfs[i].name,nameB:etfs[j].name,overlap,countries:Object.keys(cMap).filter(k=>cMap[k].wA>0&&cMap[k].wB>0).length});
    }
    return result;
  },[etfs]);

  return (
    <div>
      {etfs.length>1&&(
        <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
          {etfs.map((e,i)=>(
            <button key={i} onClick={()=>setActiveEtf(i)}
              style={{...selStyle,border:`2px solid ${activeEtf===i?e.color:"#e5e7eb"}`,background:activeEtf===i?e.color+"22":"#f9fafb",fontWeight:700,color:activeEtf===i?e.color:"#374151",cursor:"pointer"}}>
              {e.name}
            </button>
          ))}
        </div>
      )}
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        <div style={{background:"#ede9fe",borderRadius:12,padding:"10px 16px",flex:1,minWidth:120}}>
          <div style={{fontSize:11,color:"#6b7280",fontWeight:600}}>Paesi rappresentati</div>
          <div style={{fontSize:24,fontWeight:800,color:"#4338ca"}}>{countryData.length}</div>
        </div>
        <div style={{background:"#d1fae5",borderRadius:12,padding:"10px 16px",flex:1,minWidth:120}}>
          <div style={{fontSize:11,color:"#6b7280",fontWeight:600}}>Paese principale</div>
          <div style={{fontSize:15,fontWeight:800,color:"#065f46"}}>{top10[0]?.country} ({fmtPct(top10[0]?.weight||0)})</div>
        </div>
        <div style={{background:"#fef3c7",borderRadius:12,padding:"10px 16px",flex:1,minWidth:120}}>
          <div style={{fontSize:11,color:"#6b7280",fontWeight:600}}>Peso top 10 paesi</div>
          <div style={{fontSize:15,fontWeight:800,color:"#92400e"}}>{fmtPct(top10.reduce((s,c)=>s+c.weight,0))}</div>
        </div>
      </div>
      <p style={{fontSize:12,color:"#6b7280",marginBottom:10}}>Top 10 paesi per peso ponderato</p>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
        {top10.map((c,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:140,fontSize:12,fontWeight:600,color:"#374151",textAlign:"right",flexShrink:0}}>{c.country}</div>
            <div style={{flex:1,background:"#f3f4f6",borderRadius:99,height:22,overflow:"hidden",position:"relative"}}>
              <div style={{width:`${c.weight/maxW*100}%`,background:etf.color,height:"100%",borderRadius:99}}/>
              <span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",fontSize:11,fontWeight:700,color:c.weight/maxW>0.3?"#fff":"#374151",whiteSpace:"nowrap"}}>
                {fmtPct(c.weight)} · {c.count} titoli
              </span>
            </div>
          </div>
        ))}
        {otherWeight>0&&(
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:140,fontSize:12,fontWeight:600,color:"#9ca3af",textAlign:"right",flexShrink:0}}>Altri {countryData.length-10} paesi</div>
            <div style={{flex:1,background:"#f3f4f6",borderRadius:99,height:22,overflow:"hidden",position:"relative"}}>
              <div style={{width:`${otherWeight/maxW*100}%`,background:"#d1d5db",height:"100%",borderRadius:99}}/>
              <span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",fontSize:11,fontWeight:600,color:"#6b7280"}}>{fmtPct(otherWeight)}</span>
            </div>
          </div>
        )}
      </div>
      {etfs.length>=2&&geoOverlap.length>0&&(
        <div>
          <p style={{fontSize:12,color:"#6b7280",marginBottom:8}}>Overlap geografico tra ETF — calcolato con metodo min(A,B) per paese</p>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {geoOverlap.map((g,i)=>(
              <div key={i} style={{background:"#f9fafb",borderRadius:12,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                <span style={{fontWeight:600,fontSize:13,color:"#374151"}}>{g.nameA} ↔ {g.nameB}</span>
                <div style={{display:"flex",gap:12,alignItems:"center"}}>
                  <span style={{fontSize:12,color:"#6b7280"}}>{g.countries} paesi in comune</span>
                  <span style={{fontWeight:800,fontSize:16,color:g.overlap>60?"#ef4444":g.overlap>30?"#f59e0b":"#10b981"}}>{fmtPct(g.overlap)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main App ──
export default function App() {
  const [etfs,setEtfs]=useState([]);
  const [dragging,setDragging]=useState(false);
  const [activeTab,setActiveTab]=useState("matrix");
  const [activeViz,setActiveViz]=useState("venn");
  const [filterName,setFilterName]=useState("");
  const [sortDir,setSortDir]=useState("desc");
  const [sortEtf,setSortEtf]=useState(null);
  const [investment,setInvestment]=useState("");
  const [overlapMode,setOverlapMode]=useState("min");

  const handleFiles=files=>{
    Array.from(files).forEach(file=>{
      if(!file.name.endsWith(".csv")) return;
      const reader=new FileReader();
      reader.onload=e=>{
        const {holdings,skipped}=parseCSV(e.target.result);
        if(!holdings.length) return;
        const name=file.name.replace(".csv","").replace(/_/g," ");
        setEtfs(prev=>prev.find(etf=>etf.name===name)?prev:[...prev,{name,holdings,skipped,color:COLORS[prev.length%COLORS.length]}]);
      };
      reader.readAsText(file);
    });
  };

  const matrix=useMemo(()=>{
    const m={};
    for(let i=0;i<etfs.length;i++) for(let j=0;j<etfs.length;j++){
      if(i===j){m[`${i}-${j}`]=null;continue;}
      if(j<i){m[`${i}-${j}`]=m[`${j}-${i}`];continue;}
      m[`${i}-${j}`]=computeOverlap(etfs[i].holdings,etfs[j].holdings);
    }
    return m;
  },[etfs]);

  const allOverlaps=useMemo(()=>{
    const map={};
    for(let i=0;i<etfs.length;i++) for(let j=i+1;j<etfs.length;j++){
      const ov=matrix[`${i}-${j}`]; if(!ov) continue;
      ov.common.forEach(h=>{
        if(!map[h.name]) map[h.name]={name:h.name,pairs:[],avgWeight:0,weights:{}};
        map[h.name].pairs.push({etfA:etfs[i].name,etfB:etfs[j].name,wA:h.weightA,wB:h.weightB});
        map[h.name].avgWeight=Math.max(map[h.name].avgWeight,h.avgWeight);
        map[h.name].weights[etfs[i].name]=h.weightA;
        map[h.name].weights[etfs[j].name]=h.weightB;
      });
    }
    return Object.values(map);
  },[etfs,matrix]);

  const filtered=useMemo(()=>{
    return allOverlaps
      .filter(h=>h.name.toLowerCase().includes(filterName.toLowerCase()))
      .sort((a,b)=>{
        const wa=sortEtf!=null?(a.weights[sortEtf]||0):a.avgWeight;
        const wb=sortEtf!=null?(b.weights[sortEtf]||0):b.avgWeight;
        return sortDir==="desc"?wb-wa:wa-wb;
      });
  },[allOverlaps,filterName,sortDir,sortEtf]);

  const inv=parseFloat(investment)||0;
  const overlapColor=pct=>pct>60?"#ef4444":pct>30?"#f59e0b":pct>10?"#6366f1":"#10b981";

  const matrixOverlapPct=(i,j)=>{
    const ov=matrix[`${i}-${j}`]||matrix[`${j}-${i}`];
    if(!ov) return 0;
    return computeOverlapPct(ov.common,overlapMode);
  };

  return (
    <div style={s.page}>
      <div style={{...s.card,maxWidth:920}}>
        <div style={s.logo}>📊</div>
        <h1 style={s.title}>ETF Overlap Analyzer</h1>
        <p style={s.sub}>Carica i CSV delle holdings di più ETF per analizzare sovrapposizioni e distribuzione geografica.</p>

        <div style={{...s.dropzone,borderColor:dragging?"#6366f1":"#e5e7eb",background:dragging?"#ede9fe":"#f9fafb"}}
          onDrop={e=>{e.preventDefault();setDragging(false);handleFiles(e.dataTransfer.files);}}
          onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)}
          onClick={()=>document.getElementById("csvInput").click()}>
          <div style={{fontSize:36,marginBottom:8}}>📂</div>
          <div style={{fontWeight:700,color:"#374151"}}>Trascina i CSV qui o clicca per selezionarli</div>
          <div style={{fontSize:12,color:"#9ca3af",marginTop:4}}>Supporta iShares, Vanguard, JustETF · Più file contemporaneamente</div>
          <input id="csvInput" type="file" accept=".csv" multiple style={{display:"none"}} onChange={e=>handleFiles(e.target.files)}/>
        </div>

        <div style={{display:"flex",alignItems:"center",gap:10,margin:"14px 0",background:"#f9fafb",borderRadius:12,padding:"12px 16px"}}>
          <span style={{fontSize:20}}>💶</span>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,fontSize:13,color:"#374151"}}>Investimento totale (opzionale)</div>
            <div style={{fontSize:11,color:"#9ca3af"}}>Mostra la distribuzione in euro per ogni titolo sovrapposto</div>
          </div>
          <input type="number" placeholder="es. 10000" value={investment} onChange={e=>setInvestment(e.target.value)}
            style={{padding:"8px 12px",borderRadius:10,border:"2px solid #e5e7eb",fontSize:14,fontWeight:700,width:130,outline:"none"}}/>
        </div>

        {etfs.length>0&&(
          <>
            <OverlapModeSelector mode={overlapMode} setMode={setOverlapMode}/>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:16}}>
              {etfs.map((etf,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:6,background:etf.color+"22",border:`2px solid ${etf.color}`,borderRadius:99,padding:"4px 12px"}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:etf.color}}/>
                  <span style={{fontWeight:700,fontSize:13,color:"#1f2937"}}>{etf.name}</span>
                  <span style={{fontSize:11,color:"#6b7280"}}>({etf.holdings.length} holdings{etf.skipped>0?`, ${etf.skipped} scartate`:""})</span>
                  <button style={{background:"none",border:"none",cursor:"pointer",color:"#9ca3af",fontSize:14,padding:0}}
                    onClick={()=>setEtfs(prev=>prev.filter((_,j)=>j!==i))}>✕</button>
                </div>
              ))}
              <button style={s.btnSec} onClick={()=>setEtfs([])}>Rimuovi tutti</button>
            </div>
          </>
        )}

        {etfs.length>=1&&(
          <>
            <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
              {[
                ...(etfs.length>=2?[["matrix","🔢 Matrice"],["visual","📈 Visualizzazioni"],["detail","📋 Dettaglio"]]:[]),
                ["geo","🌍 Geografia"]
              ].map(([id,label])=>(
                <button key={id} style={{...s.tabBtn,...(activeTab===id?s.tabBtnActive:{})}} onClick={()=>setActiveTab(id)}>{label}</button>
              ))}
            </div>

            {activeTab==="matrix"&&etfs.length>=2&&(
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                  <thead>
                    <tr>
                      <th style={s.th}>ETF</th>
                      <th style={{...s.th,color:"#6b7280"}}>Tot. holdings</th>
                      {etfs.map((etf,i)=><th key={i} style={{...s.th,color:etf.color}}>{etf.name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {etfs.map((etfA,i)=>(
                      <tr key={i}>
                        <td style={{...s.td,fontWeight:700,color:etfA.color,whiteSpace:"nowrap"}}>{etfA.name}</td>
                        <td style={{...s.td,textAlign:"center",fontWeight:700,color:"#374151"}}>{etfA.holdings.length}</td>
                        {etfs.map((etfB,j)=>{
                          if(i===j) return <td key={j} style={{...s.td,background:"#f3f4f6",textAlign:"center"}}>—</td>;
                          const ov=matrix[`${i}-${j}`]||matrix[`${j}-${i}`];
                          const pct=matrixOverlapPct(i,j);
                          return (
                            <td key={j} style={{...s.td,textAlign:"center"}}>
                              <span style={{fontWeight:800,fontSize:16,color:overlapColor(pct)}}>{pct.toFixed(1)}%</span>
                              <div style={{fontSize:10,color:"#9ca3af"}}>{ov?.common.length} comuni</div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{display:"flex",gap:12,marginTop:12,fontSize:12,color:"#6b7280",flexWrap:"wrap"}}>
                  {[["#10b981","< 10%"],["#6366f1","10-30%"],["#f59e0b","30-60%"],["#ef4444","> 60%"]].map(([c,l])=>(
                    <div key={l} style={{display:"flex",alignItems:"center",gap:4}}><div style={{width:10,height:10,borderRadius:2,background:c}}/>{l}</div>
                  ))}
                </div>
              </div>
            )}

            {activeTab==="visual"&&etfs.length>=2&&(
              <div>
                <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
                  {[["venn","🔵 Venn"],["heatmapnxn","🟦 Heatmap"],["heatmap","🌡️ Settori"],["bars","📊 Barre"],["treemap","🗂️ Treemap"]].map(([id,label])=>(
                    <button key={id} style={{...s.tabBtn,...(activeViz===id?s.tabBtnActive:{})}} onClick={()=>setActiveViz(id)}>{label}</button>
                  ))}
                </div>
                {activeViz==="venn"&&<VennDiagram etfs={etfs} matrix={matrix} mode={overlapMode}/>}
                {activeViz==="heatmapnxn"&&<HeatmapNxN etfs={etfs} matrix={matrix}/>}
                {activeViz==="heatmap"&&<SectorHeatmap etfs={etfs} matrix={matrix} mode={overlapMode}/>}
                {activeViz==="bars"&&<BarChart etfs={etfs} matrix={matrix}/>}
                {activeViz==="treemap"&&<Treemap etfs={etfs} matrix={matrix} mode={overlapMode}/>}
              </div>
            )}

            {activeTab==="detail"&&etfs.length>=2&&(
              <div>
                <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
                  <input type="text" placeholder="🔍 Cerca un titolo..." value={filterName}
                    onChange={e=>setFilterName(e.target.value)}
                    style={{...s.searchInput,flex:1,minWidth:160}}/>
                  <span style={{color:"#6b7280",fontWeight:600,fontSize:13}}>Ordina per:</span>
                  <select value={sortEtf??""} onChange={e=>setSortEtf(e.target.value||null)} style={selStyle}>
                    <option value="">Peso medio</option>
                    {etfs.map((etf,i)=><option key={i} value={etf.name}>{etf.name}</option>)}
                  </select>
                  <button onClick={()=>setSortDir(d=>d==="desc"?"asc":"desc")} style={{...s.btnSec,fontSize:13}}>
                    {sortDir==="desc"?"↓ Desc":"↑ Asc"}
                  </button>
                </div>
                <div style={{fontSize:13,color:"#6b7280",marginBottom:12}}>{filtered.length} titoli sovrapposti</div>
                <div style={{display:"flex",flexDirection:"column",gap:10,maxHeight:500,overflowY:"auto"}}>
                  {filtered.map((h,i)=>(
                    <div key={i} style={s.overlapRow}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,flexWrap:"wrap",gap:4}}>
                        <span style={{fontWeight:700,fontSize:14,color:"#1f2937"}}>{h.name}</span>
                        <div style={{display:"flex",gap:6,alignItems:"center"}}>
                          <span style={{fontSize:12,background:"#ede9fe",color:"#4338ca",borderRadius:99,padding:"2px 10px",fontWeight:700}}>{h.pairs.length+1} ETF</span>
                          <span style={{fontSize:12,fontWeight:700,color:"#6366f1"}}>avg {fmtPct(h.avgWeight)}</span>
                        </div>
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {h.pairs.map((p,j)=>(
                          <div key={j} style={{fontSize:11,background:"#f3f4f6",borderRadius:8,padding:"4px 10px",color:"#374151"}}>
                            <strong>{p.etfA}</strong> {fmtPct(p.wA)}{inv>0&&<span style={{color:"#6366f1"}}> ({fmt(inv*p.wA/100)})</span>}
                            {" ↔ "}
                            <strong>{p.etfB}</strong> {fmtPct(p.wB)}{inv>0&&<span style={{color:"#6366f1"}}> ({fmt(inv*p.wB/100)})</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab==="geo"&&<Geography etfs={etfs}/>}
          </>
        )}

        {etfs.length===0&&(
          <div style={{textAlign:"center",padding:20,color:"#9ca3af",fontSize:14}}>Carica almeno un CSV per iniziare 👆</div>
        )}
      </div>
    </div>
  );
}

const s={
  page:{minHeight:"100vh",background:"linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,fontFamily:"'Segoe UI',sans-serif"},
  card:{background:"#fff",borderRadius:24,padding:"36px 32px",width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"},
  logo:{fontSize:48,textAlign:"center",marginBottom:8},
  title:{fontSize:24,fontWeight:800,color:"#1e1b4b",margin:"0 0 6px"},
  sub:{color:"#6b7280",fontSize:14,margin:"0 0 20px"},
  dropzone:{border:"2px dashed",borderRadius:16,padding:"32px 20px",textAlign:"center",cursor:"pointer",transition:"all .2s"},
  tabBtn:{padding:"8px 16px",borderRadius:10,border:"2px solid #e5e7eb",background:"#f9fafb",fontSize:13,fontWeight:600,cursor:"pointer",color:"#374151"},
  tabBtnActive:{padding:"8px 16px",borderRadius:10,border:"2px solid #6366f1",background:"#ede9fe",fontSize:13,fontWeight:600,cursor:"pointer",color:"#4338ca"},
  btnSec:{background:"#f3f4f6",color:"#374151",border:"none",borderRadius:99,padding:"6px 14px",fontSize:13,fontWeight:600,cursor:"pointer"},
  th:{padding:"10px 14px",background:"#f9fafb",fontWeight:700,textAlign:"left",borderBottom:"2px solid #e5e7eb"},
  td:{padding:"10px 14px",borderBottom:"1px solid #f3f4f6"},
  overlapRow:{background:"#f9fafb",borderRadius:12,padding:"12px 14px"},
  searchInput:{padding:"10px 14px",borderRadius:12,border:"2px solid #e5e7eb",fontSize:14,outline:"none",boxSizing:"border-box"},
};