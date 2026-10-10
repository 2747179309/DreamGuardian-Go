/* Transplanted guard / model rendering, isolated from the original app globals. */
(()=>{
const $=id=>document.getElementById(id);
const val=(x,d=1)=>x==null?'--':Number(x).toFixed(d);
let guidePending=false;
const labelNames={stable:'稳定',unstable:'需要关注',high_risk:'高风险',out_of_bed:'离床',unknown:'等待判断'};
function shortTime(value){if(!value)return '--';const date=new Date(value);return Number.isNaN(date.getTime())?'--':date.toLocaleTimeString('zh-CN',{hour12:false})}
function updateModel(m={}){
  const ready=m.ready===true,risk=m.scores?.arousal_risk==null?NaN:Number(m.scores.arousal_risk),confidence=m.confidence==null?NaN:Number(m.confidence);
  const riskPct=Number.isFinite(risk)?Math.max(0,Math.min(100,risk*100)):null;
  $('model-name').textContent=m.model_version||'rf:arousal_base_rf.joblib';
  $('model-ready').textContent=ready?'模型运行中':'模型未就绪';$('model-ready').className=`model-badge ${ready?'ready':'not-ready'}`;
  $('arousal-risk').textContent=riskPct==null?'--':`${riskPct.toFixed(1)}%`;
  $('model-confidence').textContent=Number.isFinite(confidence)?`${(confidence*100).toFixed(1)}%`:'--';
  $('breath-amplitude').textContent=val(m.scores&&m.scores.breath_phase_amplitude,3);
  $('model-label').textContent=labelNames[m.label]||m.label||'--';
  $('model-label-note').textContent=m.label==='stable'?'当前窗口风险较低':m.label==='unstable'?'异常超过关注阈值':m.label==='high_risk'?'异常超过高风险阈值':m.label==='out_of_bed'?'当前未检测到在床':'正在积累有效窗口';
  $('risk-fill').style.width=`${riskPct==null?0:riskPct}%`;$('risk-fill').className=riskPct==null?'':riskPct>=82?'high':riskPct>=55?'mid':'low';
  $('model-reason').textContent=m.reason||'--';
  $('model-window').textContent=m.window_start&&m.window_end?`${shortTime(m.window_start)} 至 ${shortTime(m.window_end)}`:'尚未形成完整窗口';
}
const sleepStateNames={awake:'清醒',transition:'入睡过渡',light_trend:'浅睡趋势',deep_trend:'深睡趋势',out_of_bed:'离床'};
const assistStateNames={off:'未开启',baseline:'基线采集',settle:'安定阶段',entrain:'入睡呼吸引导',fade:'淡出阶段',sleep_lock:'稳定睡眠锁定',abort:'助眠中止'};
const interventionNames={none:'持续监测（暂无干预）',pink_noise:'低音量粉红噪声',warm_light:'暖色呼吸灯',stereo_breathing:'立体声呼吸引导',night_path:'离床起夜夜间路径灯',reduce_arousal:'高风险低刺激安抚',wake_music:'唤醒音乐'};
const riskLevelNames={unknown:'等待评估',stable:'稳定',minor:'轻微苏醒风险',restless:'较高苏醒风险',high:'高苏醒风险',out_of_bed:'检测到离床'};
const guideModeNames={disabled:'自动引导已关闭',waiting:'等待 GD 进入助眠模式',playing:'正在播放睡前引导',fading:'已进入深睡，正在渐弱',completed:'本轮引导已完成',error:'引导播放器异常'};
let sleepTimerState={running:false,elapsed_sec:0,started_unix:null,phase:'unknown',received_at:Date.now()/1000};
function durationText(seconds){
  seconds=Math.max(0,Math.floor(Number(seconds)||0));
  const h=String(Math.floor(seconds/3600)).padStart(2,'0'),m=String(Math.floor(seconds%3600/60)).padStart(2,'0'),s=String(seconds%60).padStart(2,'0');
  return `${h}:${m}:${s}`;
}
function renderSleepTimer(){
  let elapsed=Number(sleepTimerState.elapsed_sec)||0;
  if(sleepTimerState.running)elapsed+=Math.max(0,Date.now()/1000-sleepTimerState.received_at);
  $('sleep-timer').textContent=durationText(elapsed);
  const phaseNames={pre_sleep:'助眠中',sleep_lock:'深睡守护中',idle:'会话继续',unknown:'等待 GD 状态'};
  const started=sleepTimerState.started_unix?new Date(sleepTimerState.started_unix*1000).toLocaleTimeString('zh-CN',{hour12:false}):null;
  $('sleep-timer-detail').textContent=sleepTimerState.running?`${phaseNames[sleepTimerState.phase]||'会话进行中'}${started?` · ${started} 起`:''}`:(started?`已结束 · ${started} 起`:'等待进入助眠模式');
}
function updateSleepGuide(g={}){
  const toggle=$('auto-guide-toggle'),enabled=g.enabled===true;
  if(!guidePending)toggle.checked=enabled;
  $('auto-guide-label').textContent=enabled?'已开启':'已关闭';
  $('auto-guide-status').textContent=g.detail||guideModeNames[g.mode]||(enabled?'等待 GD 进入助眠模式':'关闭后，进入助眠模式不会播放 NX 引导');
  document.querySelector('.guide-control').dataset.mode=g.mode||'disabled';
  sleepTimerState={...(g.timer||{}),received_at:Date.now()/1000};renderSleepTimer();
}
function updateGuard(s={}){
  const mode=s.guard_mode||'off',risk=s.wake_risk==null?null:Number(s.wake_risk),riskPct=Number.isFinite(risk)?Math.max(0,Math.min(100,risk)):null;
  const active=mode==='deep_sleep_guard',intervening=s.intervention_active===true;
  $('guard-panel').dataset.state=intervening?'intervening':active?'guarding':mode;
  $('guard-mode').textContent=intervening?'深睡干预中':active?'深睡守护中':mode==='sleep_assist'?'入睡引导中':'未开启';
  $('guard-badge').textContent=intervening?'正在执行干预':active?'监测已启动':mode==='sleep_assist'?'尚未锁定稳定睡眠':'等待进入深睡守护';
  $('guard-phase').textContent=`GD 助眠状态：${assistStateNames[s.assist_state]||s.assist_state||'未知'}`;
  $('guard-sleep-state').textContent=sleepStateNames[s.sleep_state]||s.sleep_state||'--';
  $('guard-stable-index').textContent=`稳定睡眠指数 ${s.stable_sleep_index==null?'--':Number(s.stable_sleep_index).toFixed(0)}`;
  $('guard-risk').textContent=riskPct==null?'--':`${riskPct.toFixed(0)}%`;
  $('guard-risk-level').textContent=riskLevelNames[s.risk_level]||s.risk_level||'等待评估';
  $('guard-intervention').textContent=interventionNames[s.intervention_action]||s.intervention_action||interventionNames.none;
  $('guard-action-code').textContent=`GD 动作：${s.device_action||'--'}`;
  const output=s.audio_output_enabled===true;
  $('guard-output').textContent=output?'音频输出中':s.intervention_action==='night_path'&&intervening?'路径灯输出中':'无音频输出';
  const volume=s.audio_volume_percent==null?'--':`${Number(s.audio_volume_percent).toFixed(0)}%`;
  $('guard-output-detail').textContent=`音频会话 ${s.audio_session_owner||'--'} · 音量 ${volume}`;
  $('guard-risk-fill').style.width=`${riskPct==null?0:riskPct}%`;
  $('guard-reason').textContent=s.sleep_reason||'GD 尚未给出状态依据';
}


let receivedAt=0, available=false, sceneStarted=false;
function render(payload){
  const usable=payload?.sample && payload.sample.connected!==false;
  available=!!(usable && payload.sleep_guide);
  updateModel(usable?payload.model||{}:{});
  updateGuard(usable?payload.sample:{});
  if(!guidePending)updateSleepGuide(usable?payload.sleep_guide||{}:{});
  if(!usable||!payload.sample.guard_mode){$('guard-mode').textContent='等待守护数据';$('guard-badge').textContent='等待 GD 守护状态';}
  $('auto-guide-toggle').disabled=!available||guidePending;
  if(!available)$('auto-guide-status').textContent='等待 NX 睡前引导接口';
  $('guard-data-status').textContent=usable?(document.body.dataset.offline?'离线模拟数据':'实时设备数据'):'等待有效数据';
}
window.addEventListener('dreamguardian:telemetry',event=>{receivedAt=Date.now();render(event.detail);});
setInterval(()=>{if(receivedAt && Date.now()-receivedAt>4500){receivedAt=0;render(null);window.__dreamguardianLatest=null;window.dispatchEvent(new CustomEvent('dreamguardian:telemetry',{detail:null}));receivedAt=0;}renderSleepTimer();},1000);
$('auto-guide-toggle').addEventListener('change',async event=>{
  if(!available||guidePending)return;
  const toggle=event.currentTarget,enabled=toggle.checked;
  guidePending=true;toggle.disabled=true;
  $('auto-guide-status').textContent=enabled?'正在开启…':'正在关闭并淡出…';
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),6000);
  try{
    const response=await fetch('/api/sleep-guide/auto',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled}),signal:controller.signal});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const result=await response.json();guidePending=false;updateSleepGuide(result);
  }catch(error){toggle.checked=!enabled;$('auto-guide-status').textContent='设置失败：'+error.message;}
  finally{clearTimeout(timeout);guidePending=false;toggle.disabled=!available;}
});
function loadTwinScene(){
  if(sceneStarted)return;
  sceneStarted=true;
  const script=document.createElement('script');
  script.src='/static/scene3d.bundle.js?v=resting-slow-20260924';
  script.onerror=()=>{sceneStarted=false;$('twin-status').textContent='三维模块加载失败，请重新进入页面';};
  document.body.append(script);
}
window.addEventListener('dreamguardian:view',event=>{
  if(event.detail==='twin')loadTwinScene();
});
// Preload the self-contained Three.js/GLTF bundle after the main page is ready.
// This avoids a blank first frame on slower Jetson storage while keeping the
// existing view event as a fallback.
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loadTwinScene,{once:true});
else setTimeout(loadTwinScene,0);
render(null);
})();
