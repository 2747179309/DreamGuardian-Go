/* Select only completed sessions; never substitute live samples. */
(function(root){
 const stamp=x=>x==null||x===''?NaN:typeof x==='number'?(x<1e12?x*1000:x):Date.parse(x);
 function normalize(item,report){
  const timer=report?.timer||item.payload?.sleep_guide?.timer||item.timer||{};
  const start=stamp(timer.started_unix??item.start_time??item.started_at),end=stamp(timer.ended_unix??item.end_time??item.ended_at);
  if(timer.running===true||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end>Date.now())return null;
  const inside=x=>{const t=stamp(x.timestamp??x.unix_time);return t>=start&&t<=end};
  const history=(report?.history||report?.samples||item.history||[]).filter(inside).sort((a,b)=>stamp(a.timestamp??a.unix_time)-stamp(b.timestamp??b.unix_time));
  const events=(report?.events||item.events||[]).filter(inside).map(x=>({...x,timestamp:x.timestamp??x.unix_time,type:x.type||x.event_type}));
  return {...item,history,events,report:report||item.report,completed:true,end,
   label:item.label||new Date(start).toLocaleString('zh-CN',{hour12:false}),
   payload:{sleep_guide:{timer:{...timer,session_id:item.session_id,started_unix:start/1000,ended_unix:end/1000,running:false}}}};
 }
 async function latest(remote,local,fetchReport){
  const items=[...new Map([...remote,...local].filter(x=>x?.session_id).map(x=>[x.session_id,x])).values()];
  const records=[];
  for(let i=0;i<items.length;i+=4)await Promise.all(items.slice(i,i+4).map(async item=>{
   let report=item.report;
   if(!item.local||!item.completed){try{report=await fetchReport(item.session_id)}catch{}}
   const record=normalize(item,report);if(record)records.push(record);
  }));
  return records.sort((a,b)=>b.end-a.end)[0]||null;
 }
 root.DGLastSleep={latest,normalize};if(typeof module!=='undefined')module.exports=root.DGLastSleep;
})(typeof window==='undefined'?globalThis:window);
