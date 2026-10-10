/* Session-end assessment uses the explicit timer and the corresponding report. */
(function(root){
  let requestKey='',report=null,busy=false,lastTry=0;
  const time=x=>x!=null&&x!==''&&Number.isFinite(Number(x))?Number(x)*1000:NaN;
  function render(payload,history,savedReport){
    const box=document.getElementById('session-assessment');if(!box)return;
    const timer=payload?.sleep_guide?.timer||{},start=time(timer.started_unix),end=timer.ended_unix==null?NaN:time(timer.ended_unix),ended=timer.running===false&&Number.isFinite(end)&&end>start;
    const sessionId=timer.session_id||payload?.sample?.session_id;
    const key=String(start)+':'+String(end)+':'+String(sessionId);
    if(key!==requestKey){requestKey=key;report=null;busy=false;lastTry=0}
    if(savedReport)report=savedReport;
    if(ended&&sessionId&&!String(sessionId).startsWith('local-')&&!report&&!busy&&Date.now()-lastTry>15000){
      busy=true;lastTry=Date.now();const pending=key;
      fetch('/api/sleep/reports/'+encodeURIComponent(sessionId),{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(r=>{if(requestKey===pending){report=r;busy=false;render(payload,history)}}).catch(()=>{if(requestKey===pending){busy=false;render(payload,history)}});
    }
    box.replaceChildren();
    function add(tag,text,cls){const node=document.createElement(tag);node.textContent=text;if(cls)node.className=cls;box.append(node);return node}
    const valid=history.filter(x=>{const t=DGSleepTimeline.timestamp(x.timestamp??x.unix_time);return Number.isFinite(start)&&t>=start&&t<=(ended?end:Date.now())});
    const data=DGSleepTimeline.model(valid,x=>{if(x.presence===false)return'away';const s=String(x.sleep_state||'');return s.includes('deep')?'deep':s.includes('light')?'light':s==='awake'||s==='wake'?'awake':'unknown'});
    const duration=ended?end-start:Number.isFinite(start)?Math.max(0,Date.now()-start):0;
    let sleep=0,deep=0,covered=0;data.segments.forEach(s=>{const ms=Math.max(0,Math.min(s.end,ended?end:Date.now())-s.start);if(s.key!=='unknown')covered+=ms;if(['light','deep'].includes(s.key))sleep+=ms;if(s.key==='deep')deep+=ms});
    const minutes=ms=>Math.round(ms/60000)+' 分钟';
    if(!ended){add('p','暂无已结束的睡眠评估','empty-copy');return}
    const score=report?.sleep_score??report?.score;
    const issues=Array.isArray(report?.issues)?report.issues.slice():[];
    if(duration&&covered/duration<.8)issues.push('历史数据未覆盖完整睡眠，本次评估信息不完整。');
    if(valid.some(x=>x.snore_active))issues.push('记录中出现鼾声事件，可在时间轴查看发生时段。');
    const suggestions=report?.suggestions||[];
    const content=add('div','','assessment-page');
      const number=document.createElement('strong');number.className='assessment-score';number.textContent=typeof score==='number'&&Number.isFinite(score)&&score>=0&&score<=100?Math.round(score)+' / 100':'-- / 100';content.append(number);
      const note=document.createElement('span');note.className='assessment-note';note.textContent=report?(document.body.dataset.offline==='true'?'离线模拟报告':'已结束睡眠评分'):'报告尚未就绪';content.append(note);
      const stats=document.createElement('div');stats.className='assessment-stats';content.append(stats);
      [['睡眠时长',minutes(duration)],['已观测睡眠',minutes(sleep)],['已观测深睡',minutes(deep)],['有效覆盖',duration?Math.min(100,Math.round(covered/duration*100))+'%':'--']].forEach(([label,value])=>{const cell=document.createElement('div'),a=document.createElement('span'),v=document.createElement('strong');a.textContent=label;v.textContent=value;cell.append(a,v);stats.append(cell)});
    const assessment=report?.assessment||(busy?'正在读取睡眠报告…':'暂无综合评估报告');
    const summary=document.createElement('div');summary.className='session-summary';content.append(summary);
    for(const [label,value] of [['结论',assessment],['关注',issues.join('；')],['建议',suggestions.join('；')||'暂无改善建议']]){
      if(!value)continue;const p=document.createElement('p'),strong=document.createElement('strong'),span=document.createElement('span');strong.textContent=label+'：';span.textContent=value;p.append(strong,span);p.title=value;summary.append(p);
    }
    const details=add('button','查看完整评估','assessment-open');details.type='button';details.onclick=()=>DGAssessmentDetail.open({assessment,issues,suggestions},'上次睡眠评估');

  }
  root.DGSessionAssessment={render};
})(window);
