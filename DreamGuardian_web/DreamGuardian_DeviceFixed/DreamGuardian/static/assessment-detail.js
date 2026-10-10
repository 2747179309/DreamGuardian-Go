/* Shared detail overlay. Text is inserted safely and remains available in full. */
(function(root){
 let current=null,label='未选择睡眠记录';
 const byId=id=>document.getElementById(id),list=x=>Array.isArray(x)?x.map(String):[];
 const dialog=document.createElement('dialog');dialog.className='assessment-dialog';dialog.setAttribute('aria-label','完整睡眠评估');document.body.append(dialog);
 function open(report,title){
  dialog.replaceChildren();const header=document.createElement('header'),h=document.createElement('h2'),close=document.createElement('button');h.textContent=title||'完整睡眠评估';close.textContent='关闭';close.type='button';close.onclick=()=>dialog.close();header.append(h,close);dialog.append(header);
  const nav=document.createElement('div');nav.className='assessment-tabs';nav.setAttribute('role','tablist');const body=document.createElement('div');body.className='assessment-detail-body';body.id='assessment-detail-body';body.setAttribute('role','tabpanel');dialog.append(nav,body);
  const sections=[['总体情况',[report?.assessment||'暂无综合评估报告','缺失指标：'+(list(report?.missing_fields).join('、')||'未提供缺失指标信息')]],['主要问题',list(report?.issues)],['改善建议',list(report?.suggestions)]];
  const buttons=[];
  function select(i){body.replaceChildren();sections[i][1].filter(Boolean).forEach(value=>{const p=document.createElement('p');p.textContent=value;body.append(p)});if(!body.children.length){const p=document.createElement('p');p.textContent='该记录尚未提供此项内容';body.append(p)}buttons.forEach((b,j)=>{b.setAttribute('aria-selected',String(i===j));b.tabIndex=i===j?0:-1});body.setAttribute('aria-labelledby','assessment-tab-'+i);body.scrollTop=0}
  sections.forEach(([name],i)=>{const b=document.createElement('button');b.type='button';b.textContent=name;b.id='assessment-tab-'+i;b.setAttribute('role','tab');b.setAttribute('aria-controls',body.id);b.onclick=()=>select(i);b.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const j=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;select(j);buttons[j].focus()}};buttons.push(b);nav.append(b)});select(0);if(!dialog.open)dialog.showModal();
 }
 function setReport(report,title){current=report;label=title||'综合睡眠评估';byId('report-assessment').textContent=report?.assessment||title||'选择一条睡眠记录查看评估';byId('report-assessment').title=report?.assessment||'';
  for(const [id,values,limit] of [['report-issues',list(report?.issues),2],['report-suggestions',list(report?.suggestions),1]]){const box=byId(id);box.replaceChildren();(values.length?values.slice(0,limit):id==='report-suggestions'?['暂无改善建议']:[]).forEach(value=>{const li=document.createElement('li');li.textContent=value;li.title=value;box.append(li)})}
  byId('report-missing').textContent='缺失指标：'+(list(report?.missing_fields).join('、')||'--');
 }
 byId('report-detail-open').onclick=()=>open(current,label);
 root.DGAssessmentDetail={open,setReport};
})(window);
