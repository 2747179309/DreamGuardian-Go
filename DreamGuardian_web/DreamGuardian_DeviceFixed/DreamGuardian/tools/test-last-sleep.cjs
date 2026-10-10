const assert=require('node:assert/strict');
const {latest,normalize}=require('../static/last-sleep.js');
(async()=>{
 const now=Math.floor(Date.now()/1000)-100;
 const record=(id,end)=>({session_id:id,local:true,completed:true,history:[{unix_time:end-10},{unix_time:end+1}],events:[{unix_time:end-5,type:'turn'},{unix_time:end+5,type:'turn'}],payload:{sleep_guide:{timer:{running:false,started_unix:end-60,ended_unix:end}}}});
 const a=record('old',now-400),b=record('new',now),active={...record('active',now+1),completed:false};active.payload.sleep_guide.timer.running=true;
 let result=await latest([], [b,active,a],async()=>{throw Error('offline')});assert.equal(result.session_id,'new');assert.equal(result.history.length,1);assert.equal(result.events.length,1);
 assert.equal(await latest([], [active],async()=>{throw Error()}),null);
 assert.equal(await latest([], [],async()=>{}),null);
 result=await latest([{session_id:'remote'}], [a],async()=>({timer:{running:false,started_unix:now-60,ended_unix:now},history:[],events:[]}));assert.equal(result.session_id,'remote');assert.deepEqual(result.history,[]);
 assert.equal(normalize(record('future',now+1000)),null);
 console.log('PASS: newest completed record, active excluded, out-of-session data excluded, empty record, missing history, remote report, future excluded');
})();
