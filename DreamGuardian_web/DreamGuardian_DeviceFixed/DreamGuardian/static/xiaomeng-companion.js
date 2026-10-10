/* Xiaomeng companion: local presentation and preferences; device actions use NX receipts. */
(()=>{
  'use strict';
  const offline=document.body.dataset.offline==='true';
  const poses={wait:'wait',wake:'wake',listen:'listen',think:'think',answer:'answer',guard:'wait',notice:'listen',confirm:'think',execute:'think',done:'answer',error:'listen'};
  const labels={wait:'安静待机',wake:'我在这里',listen:'认真倾听',think:'正在整理',answer:'温柔回应',guard:'安静守护',notice:'发现变化',confirm:'等待你的确认',execute:'正在执行',done:'已收到回执',error:'需要关注'};
  let prefs={style:'gentle',motion:true},lockedUntil=0,current='',remoteMode='wait',busy=false,demoTimer=0,demoRun=0,lastContext='',lastPrompt=0,context=null;
  try{Object.assign(prefs,JSON.parse(localStorage.getItem('dg-xiaomeng-preferences')||'{}'))}catch{}
  const el=(tag,cls,copy)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(copy!=null)n.textContent=copy;return n};
  const button=(copy,fn)=>{const b=el('button','xm-button',copy);b.type='button';b.addEventListener('click',fn);return b};
  const save=()=>{try{localStorage.setItem('dg-xiaomeng-preferences',JSON.stringify(prefs))}catch{}document.body.dataset.xmMotion=prefs.motion?'on':'off';};
  save();
  const baseRender=window.DGXiaomeng.render;
  const guardEntry=el('div','xm-home-guard');
  const guardStatus=el('span','xm-home-guard-status','入睡后自动守护');
  guardStatus.setAttribute('role','status');
  const guardButton=button('查看详情 ›',()=>selectView('guard'));guardButton.classList.add('dashboard-detail-link');
  guardButton.setAttribute('aria-label','查看深睡守护详情');
  guardEntry.append(guardStatus,guardButton);
  document.getElementById('monitor-voice-detail').after(guardEntry);
  function syncHome(){
    if(!current)return;
    const hints={wake:'我在这里，想聊聊还是看看睡眠状态？',listen:'正在倾听，慢慢说就好。',think:'正在整理信息，请稍等一下。',answer:'回复已准备好，可以在对话页查看。',confirm:'请在对话卡片中确认或取消操作。',execute:'正在等待设备回执，请稍等。',done:'设备已返回成功回执。',error:'暂时没有有效睡眠数据，正在等待恢复。'};
    const situations={offline:'暂时没有有效睡眠数据，正在等待恢复。',away:'检测到离床，需要时可以调整夜灯。',guard:'检测到你已入睡，我已进入深睡守护模式，安静陪伴。下方可以查看守护详情。',notice:'睡眠状态出现变化，可以查看守护详情。',settle:'我在陪你慢慢放松。检测到入睡后，我会进入深睡守护模式。'};
    const situational=['wait','guard','notice'].includes(current);
    const copy=(offline?'演示 · ':'')+(current==='error'&&context?.key!=='offline'?'刚才的交互未完成，请在对话页查看原因。':situational?(situations[context?.key]||situations.settle):hints[current]||'我在这里陪着你。');
    ['voice-mode','monitor-voice-mode'].forEach(id=>{const n=document.getElementById(id);if(n&&n.textContent!==labels[current])n.textContent=labels[current]});
    ['voice-detail','monitor-voice-detail'].forEach(id=>{const n=document.getElementById(id);if(n&&n.textContent!==copy)n.textContent=copy});
    document.querySelectorAll('.agent-info,.dashboard-agent').forEach(n=>n.dataset.companion=current);
    document.querySelectorAll('[data-voice-mode]').forEach(n=>n.classList.toggle('active',n.dataset.voiceMode===current));
    guardEntry.dataset.active=context?.key==='guard'?'true':'false';
    guardStatus.textContent=context?.key==='guard'?'深睡守护模式':context?.key==='offline'?'等待有效睡眠数据':context?.key==='away'?'离床 · 查看守护状态':context?.key==='notice'?'睡眠变化 · 查看守护状态':'入睡后自动守护';
  }
  // The live renderer writes legacy voice labels after rendering the avatar.
  // Reapply the companion state so text and pose share the same priority/hold.
  const baseUpdateVoice=updateVoice;
  updateVoice=voice=>{baseUpdateVoice(voice);syncHome()};
  function render(mode,hold=0){
    if(!poses[mode])mode='wait';
    if(hold)lockedUntil=Date.now()+hold;
    if(current!==mode){document.querySelectorAll('.avatar-stage').forEach(s=>{const old=s.querySelector('img.xiaomeng');if(old&&poses[current]!==poses[mode]){s.querySelectorAll('.xm-previous').forEach(n=>n.remove());const ghost=old.cloneNode();ghost.className='xiaomeng xm-previous';ghost.alt='';ghost.setAttribute('aria-hidden','true');s.append(ghost);setTimeout(()=>ghost.remove(),450)}});current=mode;baseRender(poses[mode]);document.querySelectorAll('.avatar-stage').forEach(s=>{const img=s.querySelector('img.xiaomeng:not(.xm-previous)');if(img){img.src='/static/xiaomeng/'+poses[mode]+'.png?v=transparent-1';img.alt='小梦 · '+labels[mode]}s.dataset.companion=mode;s.classList.remove('xm-enter');void s.offsetWidth;s.classList.add('xm-enter')});}
    document.querySelectorAll('[data-xm-state]').forEach(n=>n.textContent=labels[mode]);
    syncHome();
  }
  window.DGXiaomeng.render=mode=>{remoteMode=mode;if(Date.now()<lockedUntil)return;render(mode==='wait'&&context?context.mode:mode)};
  document.querySelectorAll('.xiaomeng-demo-control').forEach(n=>n.remove());
  if(offline)window.dispatchEvent(new CustomEvent('xiaomeng-demo-mode',{detail:'wait'}));
  const layout=document.querySelector('#view-ai .ai-layout');
  const studio=el('aside','panel xm-studio');
  studio.innerHTML='<div class="xm-studio-heading"><span class="eyebrow">YOUR NIGHT COMPANION</span><span class="xm-presence">陪伴已开启</span></div><div class="avatar-stage xm-main-stage" data-mode="wait"><div class="xm-halo"></div><div class="xm-stars" aria-hidden="true">✦ <span>·</span> ✧ <span>·</span> ✦</div><img class="xiaomeng" src="/static/xiaomeng/wait.png" alt="小梦，睡眠陪伴助手"><div class="xm-floor"></div></div><div class="xm-identity"><h2>小梦</h2><span data-xm-state>安静待机</span></div><p class="xm-caption">陪你慢慢放松，把夜晚交给安静。</p><div class="xm-context" role="status"><span class="xm-context-label">此刻的陪伴</span><p id="xm-context-copy">正在等待有效睡眠数据。</p><small id="xm-context-source">尚无数据依据</small></div><label class="xm-pref">陪伴方式<select id="xm-style"><option value="quiet">安静守护</option><option value="gentle">温柔陪伴</option><option value="active">积极引导</option></select></label><label class="xm-motion"><input id="xm-motion" type="checkbox">开启细腻动效</label>';
  layout.prepend(studio);
  const intro=document.querySelector('.ai-intro');intro.querySelector('p').textContent=offline?'演示陪伴 · 回复与数据均为模拟':'和我聊聊今晚，或一起看看睡眠变化';
  const toolbar=el('div','xm-chat-toolbar');toolbar.append(el('span',null,offline?'本地互动演示':'睡眠对话'),button('清空对话',()=>{if(busy)return;log.replaceChildren();message('assistant','对话已清空。今晚想让我怎么陪你？')}));intro.after(toolbar);
  const log=document.querySelector('#chat-log');log.replaceChildren();log.setAttribute('role','log');log.setAttribute('aria-live','polite');log.setAttribute('aria-label','与小梦的对话');
  const quick=document.querySelector('.quick-question-grid');quick.replaceChildren();
  ['我有点睡不着','分析当前睡眠状态','把灯光调暗','把助眠音量降低','暂停助眠声音','看看睡眠记录'].forEach(q=>quick.append(button(q,()=>askAi(q))));
  document.querySelector('#ai-input').placeholder='说说你的感受，或试试“把灯光调暗”';
  document.querySelector('#ai-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();document.querySelector('#ai-form').requestSubmit()}});
  const style=document.querySelector('#xm-style');style.value=prefs.style;style.onchange=()=>{prefs.style=style.value;save();message('assistant',prefs.style==='quiet'?'已切换为安静守护。我会减少主动提示，仍然回应你的提问。':prefs.style==='active'?'已切换为积极引导。我会在状态变化时给出简短建议。':'已切换为温柔陪伴。我会在合适的时候轻声提醒。');};
  const motion=document.querySelector('#xm-motion');motion.checked=prefs.motion;motion.onchange=()=>{prefs.motion=motion.checked;save()};
  document.querySelectorAll('.avatar-stage').forEach(stage=>{
    stage.classList.add('xm-reactive');stage.tabIndex=0;stage.setAttribute('role','button');stage.setAttribute('aria-label','唤醒小梦');
    const greet=()=>{if(busy||demoRun)return;render('wake',3500);const copy=prefs.style==='quiet'?'我在。需要的时候，点开对话就好。':'我在这里。想聊聊今晚，还是看看现在的睡眠状态？';showToast(copy);if(stage.classList.contains('xm-main-stage'))message('assistant',copy)};
    stage.addEventListener('click',greet);stage.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();greet()}});
    stage.addEventListener('pointermove',e=>{const r=stage.getBoundingClientRect();stage.style.setProperty('--xm-look',((e.clientX-r.left)/r.width-.5)*5+'deg')});stage.addEventListener('pointerleave',()=>stage.style.setProperty('--xm-look','0deg'));
  });
  function message(role,copy,meta={}){
    const item=el('article','chat-message '+role);item.append(el('strong',null,role==='user'?'你':'小梦'),el('p',null,copy));
    if(meta.source){const d=el('details','xm-source');d.append(el('summary',null,'依据 · '+meta.source),el('p',null,meta.evidence||'依据当前页面已接收的数据；缺失数据不会补造。'));item.append(d)}
    if(meta.actions){const actions=el('div','xm-card-actions');meta.actions.forEach(a=>actions.append(button(a.label,()=>a.run(item))));item.append(actions)}
    if(role==='assistant'&&meta.feedback){const f=el('div','xm-feedback');f.append(el('span',null,'这条回复有帮助吗？'));['有帮助','需改进'].forEach(t=>f.append(button(t,()=>{f.replaceChildren(el('span',null,'已记录本次反馈：'+t+'（仅本次页面）'))})));item.append(f)}
    log.append(item);while(log.children.length>60)log.firstChild.remove();log.scrollTop=log.scrollHeight;return item;
  }
  function available(){const enabled=state.aiAvailable&&state.health?.qwen?.ready===true;document.querySelector('#ai-input').disabled=false;document.querySelector('#ai-send').disabled=busy;document.querySelector('#ai-input').placeholder=enabled?'说说你的感受，或试试“把灯光调暗”':'可使用本地陪伴与操作卡片；数据分析等待模型连接';quick.querySelectorAll('button').forEach(b=>b.disabled=busy)}
  const oldCheck=checkAi;checkAi=async()=>{await oldCheck();available()};
  const oldEvidence=renderAiEvidence;renderAiEvidence=()=>{oldEvidence();if(offline){text('ai-model-state','离线互动演示');text('ai-qwen-source','规则回复 · 未调用模型');text('ai-live-source','离线模拟数据')}};renderAiEvidence();
  function command(action,value,label){
    render('confirm',60000);
    message('assistant','准备'+label+'。确认后会发送给设备。',{source:offline?'离线模拟设备':'当前设备状态',actions:[{label:'确认'+label,run:async item=>{
      if(busy)return;if(!controlOnline()){message('assistant','设备或实时链路当前不可用，这次操作没有发送。');render('error',5000);return}
      busy=true;available();item.querySelectorAll('button').forEach(b=>b.disabled=true);render('execute',15000);
      const result=await sendControl(action,value);busy=false;available();
      if(result?.ok){render('done',5000);message('assistant',offline?'演示设备已确认：'+label+'。没有发送真实设备命令。':'设备已确认：'+label+'。',{source:offline?'模拟回执':'设备回执',evidence:result.message,feedback:true})}else{render('error',5000);message('assistant','这次操作未完成：'+(result?.message||'设备未确认，请查看连接状态。'))}
    }},{label:'取消',run:item=>{item.querySelectorAll('button').forEach(b=>b.disabled=true);render('wait',1000);message('assistant','已取消，设备设置没有改变。')}}]});
  }
  askAi=async question=>{
    question=question.trim();if(!question||busy)return;stopDemo(false);message('user',question);
    if(/不要|别|不想|取消/.test(question)){render('answer',4000);message('assistant','好的，这条消息不会触发设备操作。你可以在已有操作卡片中点“取消”。');return}
    const device=confirmedDevice();
    if(/调暗|降低.*亮度/.test(question)){if(device?.brightness==null){message('assistant','还没有收到灯光亮度，暂时无法调整。');return}command('set_brightness',Math.max(0,Number(device.brightness)-15),'将灯光调至 '+Math.max(0,Number(device.brightness)-15)+'%');return}
    if(/音量.*降低|降低.*音量/.test(question)){if(device?.volume==null){message('assistant','还没有收到助眠音量，暂时无法调整。');return}command('set_volume',Math.max(0,Number(device.volume)-5),'将助眠音量调至 '+Math.max(0,Number(device.volume)-5)+'%');return}
    if(/暂停.*声音/.test(question)){command('pause',null,'暂停助眠声音');return}
    if(/睡眠记录|昨夜/.test(question)){render('answer',4500);message('assistant','可以从睡眠报告里选择一晚，查看时间轴和当时的数据。',{actions:[{label:'打开睡眠报告',run:()=>selectView('reports')}]});return}
    if(/睡不着|紧张|陪我|晚安/.test(question)){render('answer',6000);message('assistant',/晚安/.test(question)?'晚安。你可以放下屏幕了，需要时我就在这里。':'先不急着睡着。可以让肩膀松下来，按舒服的节奏呼吸。想要安静一点，还是听一点背景声音？',{actions:[{label:'安静陪伴',run:()=>{style.value='quiet';style.onchange();render('guard',6000)}},{label:'选择助眠声音',run:()=>selectView('control')}],feedback:true});return}
    if(!state.aiAvailable||!state.health?.qwen?.ready){render('error',5000);message('assistant','分析服务还没有连接。你仍然可以和我说晚安、调整灯光，或打开睡眠记录。');return}
    busy=true;available();render('think',20000);const pending=message('assistant','正在查看数据，整理给你的回答…');pending.classList.add('xm-pending');
    try{const result=await fetchJson('/api/ai/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,scope:'current',require_sources:true})},12000);pending.remove();render('answer',6500);message('assistant',result.answer||result.reply||'没有收到文字结果，请稍后再试。',{source:result.data_source||(offline?'离线规则回复':'当前数据'),evidence:'缺失指标：'+(Array.isArray(result.missing_fields)&&result.missing_fields.length?result.missing_fields.join('、'):'接口未报告缺失项')+'。设备操作需要单独确认。',feedback:true});}
    catch(error){pending.remove();render('error',6000);message('assistant','这次分析没有完成：'+error.message,{actions:[{label:'重试',run:()=>askAi(question)}]})}finally{busy=false;available()}
  };
  function readContext(){
    if(!sampleUsable())return {key:'offline',mode:'error',copy:'暂时没有有效睡眠数据。连接恢复后，我会继续观察。',source:'数据缺失或已过期',quiet:false};
    const s=state.live.sample,source=(offline?'模拟数据':'实时数据')+' · '+formatTime(s.timestamp||s.unix_time);
    if(s.presence===false)return {key:'away',mode:'notice',copy:'当前数据显示你已离床。需要的话，可以打开设备页调整夜灯。',source,quiet:false};
    if(['unstable','restless'].includes(s.sleep_state)||['high','restless'].includes(s.risk_level))return {key:'notice',mode:'notice',copy:'当前数据出现睡眠状态变化。可以一起查看变化原因，暂时不替你调整设备。',source,quiet:false};
    if(s.guard_mode==='deep_sleep_guard'||s.sleep_locked===true||['light','light_trend','deep','deep_trend','asleep','sleeping'].includes(s.sleep_state))return {key:'guard',mode:'guard',copy:'检测到你已入睡，小梦已进入深睡守护模式。我会减少动效和主动提示。',source,quiet:true};
    return {key:'settle',mode:'wait',copy:'我在陪你慢慢安定下来。你可以聊聊感受，也可以让我安静守护。',source,quiet:false};
  }
  function tickCompanion(){context=readContext();document.querySelector('#xm-context-copy').textContent=context.copy;document.querySelector('#xm-context-source').textContent=context.source;
    document.body.dataset.xmQuiet=context.quiet?'true':'false';
    if(Date.now()>lockedUntil&&!demoRun&&!busy)render(remoteMode==='wait'?context.mode:remoteMode);
    if(context.key!==lastContext){const previous=lastContext;lastContext=context.key;if(previous&&prefs.style!=='quiet'&&!context.quiet&&Date.now()-lastPrompt>(prefs.style==='active'?45000:120000)&&!busy&&!demoRun){lastPrompt=Date.now();message('assistant',context.copy,{source:context.source})}}
  }
  const demo=el('details','xm-demo');demo.innerHTML='<summary>互动演示 <span>仅展示 · 不操作设备</span></summary><p>体验一次从唤醒到晚安的完整陪伴。演示不使用麦克风，不播放声音。</p>';
  const controls=el('div','xm-demo-buttons');demo.append(controls);studio.append(demo);
  const steps=[['wake','嗨，小梦','我在。今晚想怎么放松？'],['listen','倾听','我正在听你说。'],['think','思考','让我整理一下你的想法。'],['answer','回应','可以先把灯光调暗一点。'],['notice','发现变化','演示：检测到状态变化，先查看数据。'],['confirm','等待确认','演示：灯光调整需要你的确认。'],['execute','执行中','演示：正在等待设备回应。'],['done','完成','演示：设备已返回确认。'],['guard','晚安','晚安。我会安静地陪着你。']];
  const demoStatus=el('p','xm-demo-status','尚未开始');demoStatus.setAttribute('role','status');demo.append(demoStatus);
  function stopDemo(announce=true){clearTimeout(demoTimer);demoRun=0;lockedUntil=0;if(announce)demoStatus.textContent='演示已停止，恢复实时状态';}
  function showStep(index){const step=steps[index];render(step[0],5000);demoStatus.textContent=(index+1)+' / '+steps.length+' · '+step[2];}
  controls.append(button('播放完整流程',()=>{if(busy)return;stopDemo(false);demoRun=1;let i=0;const next=()=>{showStep(i++);if(i<steps.length)demoTimer=setTimeout(next,2800);else demoTimer=setTimeout(()=>{stopDemo(false);demoStatus.textContent='演示完成，已恢复实时状态'},3200)};next()}),button('停止演示',()=>stopDemo()));
  steps.forEach((step,index)=>controls.append(button(step[1],()=>{if(busy)return;stopDemo(false);showStep(index)})));
  window.addEventListener('dreamguardian:view',()=>stopDemo(false));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopDemo(false)});
  message('assistant',offline?'你好，我是小梦。这里可以体验陪伴、数据问答和设备操作卡片；演示数据与回复均为模拟。':'你好，我是小梦。今晚想聊聊心情，还是一起看看睡眠状态？');
  render('wait');available();tickCompanion();setInterval(tickCompanion,1500);
})();
