const assert=require('node:assert/strict');
class Element{constructor(){this.children=[];this.textContent=''}append(...nodes){this.children.push(...nodes)}replaceChildren(){this.children=[]}}
const box=new Element();global.window=global;global.document={getElementById:()=>box,createElement:()=>new Element(),body:{dataset:{}}};
global.DGSleepTimeline=require('../static/sleep-timeline.js');
let requests=0;global.fetch=async()=>{requests++;return{ok:true,json:async()=>({score:82,assessment:'本次报告',issues:['睡眠中断'],suggestions:['核对中断时段']})}};
require('../static/session-assessment.js');
const all=node=>node.textContent+' '+node.children.map(all).join(' ');
(async()=>{
DGSessionAssessment.render({},[]);assert.match(all(box),/暂无已结束/);assert.equal(requests,0);
DGSessionAssessment.render({sleep_guide:{timer:{started_unix:100,running:true}}},[]);assert.equal(requests,0);assert.match(all(box),/暂无已结束/);
DGSessionAssessment.render({sleep_guide:{timer:{started_unix:100,ended_unix:200,running:false}}},[]);assert.match(all(box),/报告尚未就绪/);assert.equal(requests,0);
DGSessionAssessment.render({sleep_guide:{timer:{started_unix:100,ended_unix:200,running:false,session_id:'test'}}},[]);
await new Promise(resolve=>setImmediate(resolve));assert.equal(requests,1);assert.match(all(box),/82 \/ 100/);const content=all(box);assert.doesNotMatch(content,/上一页|下一页/);assert.match(content,/睡眠中断/);assert.match(content,/核对中断时段/);
console.log('PASS: ongoing, missing association, completed report, issues and advice');
})().catch(error=>{console.error(error);process.exitCode=1});
