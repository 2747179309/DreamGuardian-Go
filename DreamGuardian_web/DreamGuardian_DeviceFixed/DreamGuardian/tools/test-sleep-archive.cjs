const assert=require('node:assert/strict');
const records=new Map();
global.window=global;global.document={body:{dataset:{}}};global.dispatchEvent=()=>{};global.DGSleepTimeline=require('../static/sleep-timeline.js');
global.indexedDB={open(){const req={};setImmediate(()=>{req.result={transaction(){const tx={objectStore(){return {get:id=>operation(()=>structuredClone(records.get(id))),getAll:()=>operation(()=>structuredClone([...records.values()])),put:value=>operation(()=>records.set(value.session_id,structuredClone(value)))} }};function operation(fn){const r={};setImmediate(()=>{r.result=fn();tx.oncomplete()});return r}return tx}};req.onsuccess()});return req}};
const wait=()=>new Promise(resolve=>setTimeout(resolve,30));
const modulePath=require.resolve('../static/sleep-archive.js');
(async()=>{
require(modulePath);
const payload={sample:{unix_time:110,heart_bpm:60},pillow:{temperature_c:25},sleep_guide:{timer:{started_unix:100,running:true}}};
DGSleepArchive.capture(payload,[{unix_time:90},{unix_time:105}],[]);await wait();assert.equal((await DGSleepArchive.list()).length,0);
payload.sleep_guide.timer={started_unix:100,ended_unix:120,running:false};payload.sample.unix_time=120;
DGSleepArchive.capture(payload,[],[{timestamp:110,type:'turn',title:'翻身'}]);await wait();
let record=await DGSleepArchive.get('local-100');assert.equal(record.completed,true);assert.equal(record.history.length,3);assert.equal(record.events.length,1);assert.equal(record.history[1].temperature_c,25);
delete require.cache[modulePath];require(modulePath);assert.equal((await DGSleepArchive.list()).length,1);
DGSleepArchive.capture(payload,[],[{timestamp:110,type:'turn',title:'翻身'}]);await wait();record=await DGSleepArchive.get('local-100');assert.equal(record.history.length,3);assert.equal(record.events.length,1);
console.log('PASS: ongoing checkpoint, completed archive, reload, deduplication, timestamp bounds, snapshot');
})().catch(error=>{console.error(error);process.exitCode=1});
