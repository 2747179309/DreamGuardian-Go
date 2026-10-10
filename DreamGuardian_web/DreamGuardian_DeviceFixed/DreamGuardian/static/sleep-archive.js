/* Local archives are scoped to this browser and separated from offline demos. */
(function(root){
  const database=new Promise((resolve,reject)=>{const req=indexedDB.open(document.body.dataset.offline==='true'?'dg-sleep-demo':'dg-sleep-archive',1);req.onupgradeneeded=()=>req.result.createObjectStore('sessions',{keyPath:'session_id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
  database.catch(()=>{});
  async function query(mode,operation){const db=await database;return new Promise((resolve,reject)=>{const tx=db.transaction('sessions',mode),req=operation(tx.objectStore('sessions'));tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}
  const get=id=>query('readonly',s=>s.get(id));
  const list=async()=> (await query('readonly',s=>s.getAll())).filter(s=>s.completed);
  let chain=Promise.resolve(),lastWrite=0,lastKey='',warned=false,pendingId='',pendingSamples=[];
  function capture(payload,history,events){
    const timer=payload?.sleep_guide?.timer;if(timer?.started_unix==null)return;
    const start=Number(timer.started_unix),end=Number(timer.ended_unix),completed=timer.running===false&&timer.ended_unix!=null&&end>start;
    if(!Number.isFinite(start)||start<=0)return;
    const id=String(timer.session_id||payload.sample?.session_id||'local-'+start),key=id+':'+completed;
    if(pendingId!==id){pendingId=id;pendingSamples=[]}
    pendingSamples.push({...payload.sample,temperature_c:payload.sample?.temperature_c??payload.pillow?.temperature_c,humidity_percent:payload.sample?.humidity_percent??payload.pillow?.humidity_pct});
    if(key===lastKey&&Date.now()-lastWrite<5000)return;lastKey=key;lastWrite=Date.now();
    const copy=JSON.parse(JSON.stringify({payload,history:[...history,...pendingSamples],events}));pendingSamples=[];
    chain=chain.then(async()=>{
      const previous=await get(id),until=completed?end*1000:Date.now();
      const time=x=>DGSleepTimeline.timestamp(x.timestamp??x.unix_time);
      const sample={...copy.payload.sample,temperature_c:copy.payload.sample?.temperature_c??copy.payload.pillow?.temperature_c,humidity_percent:copy.payload.sample?.humidity_percent??copy.payload.pillow?.humidity_pct};
      const rows=new Map();[...(previous?.history||[]),...copy.history,sample].forEach(x=>{const t=time(x);if(t>=start*1000&&t<=until)rows.set(t,x)});
      const unique=new Map();[...(previous?.events||[]),...copy.events].forEach(x=>{const t=time(x);if(t>=start*1000&&t<=until)unique.set(t+':'+x.type+':'+x.title,x)});
      const date=new Date(start*1000).toLocaleString('zh-CN',{hour12:false});
      const record={...previous,session_id:id,backend_id:timer.session_id||copy.payload.sample?.session_id,local:true,label:date+' · '+(document.body.dataset.offline==='true'?'模拟记录':'本地记录'),date:new Date(start*1000).toISOString(),completed:completed||previous?.completed,history:[...rows.values()].sort((a,b)=>time(a)-time(b)),events:[...unique.values()],payload:{sleep_guide:{timer:{...timer,session_id:id}}}};
      if(completed&&record.backend_id&&!record.report){try{const response=await fetch('/api/sleep/reports/'+encodeURIComponent(record.backend_id));if(response.ok){record.report=await response.json();record.score=record.report.sleep_score??record.report.score}}catch{}}
      await query('readwrite',s=>s.put(record));
      if(completed&&!previous?.completed)root.dispatchEvent(new CustomEvent('dreamguardian:archive-saved')); 
    }).catch(error=>{console.error('Sleep archive',error);if(!warned){warned=true;root.dispatchEvent(new CustomEvent('dreamguardian:archive-error'))}});
  }
  root.DGSleepArchive={capture,get,list};
})(window);
