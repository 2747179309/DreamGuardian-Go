'use strict';
const $=id=>document.getElementById(id);
const $$=selector=>Array.from(document.querySelectorAll(selector));
const state={
  edition:'monitor',
  archive:null,archiveRequest:0,timelineLatest:true,eventPage:0,activeView:'dashboard',live:null,liveHistory:[],history:[],events:[],sessions:[],
  health:null,telemetry:null,control:null,scenes:[],controlAvailable:false,aiAvailable:false,
  ws:null,wsState:'connecting',lastWsMessageAt:0,lastSampleChangedAt:0,lastSampleKey:null,
  pollBusy:false,reconnectTimer:null,historyRequest:0,historyMinutes:480,
  commandLocks:new Map(),debounceTimers:new Map(),pendingRobotAction:null,awakeUntil:0
};
const sleepNames={awake:'清醒',wake:'清醒',assist:'助眠',light:'浅睡趋势',deep:'深睡趋势',unstable:'睡眠不稳定',restless:'睡眠不稳定',away:'离床',left_bed:'离床',return:'回床',unknown:'未知'};
const assistNames={idle:'待机',sleep:'助眠中',active:'干预中',light:'灯光干预',sound:'声音干预',locked:'安全锁定'};
Object.assign(sleepNames,{deep_trend:'深睡趋势',light_trend:'浅睡趋势',transition:'入睡过渡',out_of_bed:'离床'});
Object.assign(assistNames,{baseline:'基线采集',settle:'安定阶段',entrain:'入睡引导',fade:'声音淡出',sleep_lock:'深睡守护',off:'未开启'});
const dashboardWaveform=DGWaveform.create();
const eegBandStream=DGEEGBands.create();
const homeEeg={points:[],seq:null,device:null,rate:null,unit:null};
function captureHomeEeg(esp){
  const eeg=esp?.eeg,rate=finite(eeg?.sample_rate_hz),raw=eeg?.raw_samples;
  if(esp?.stale!==false||eeg?.contact===false||!rate||!Array.isArray(raw))return;
  if(homeEeg.device!==esp.device_id||homeEeg.rate!==rate||homeEeg.unit!==eeg.unit){homeEeg.points=[];homeEeg.seq=null}
  if(esp.seq!=null&&esp.seq===homeEeg.seq)return;
  const now=performance.now()/1000,last=homeEeg.points.at(-1);
  const contiguous=last&&Number(esp.seq)===Number(homeEeg.seq)+1&&Math.abs(now-last.t-raw.length/rate)<.15;
  const end=contiguous?last.t+raw.length/rate:now;
  if(last&&!contiguous)homeEeg.points.push({t:end-raw.length/rate,value:null});
  raw.forEach((v,i)=>homeEeg.points.push({t:end-(raw.length-1-i)/rate,value:finite(v)}));
  Object.assign(homeEeg,{seq:esp.seq,device:esp.device_id,rate,unit:eeg.unit});
  homeEeg.points=homeEeg.points.filter(p=>p.t>now-31);
}
const voiceNames={wake:'唤醒',wait:'等待',listen:'收听',think:'思考',answer:'回答'};
const invalidNames={heart_bpm:'bio.heart_bpm',breath_bpm:'bio.breath_bpm',motion:'bio.motion',radar_phase_valid:'radar.phase_valid',csi_motion:'csi.motion',csi_stability:'csi.stability',snore_active:'mic.snore_active'};
const requiredExtended=['pressure_matrix','pillow_pressure_delta','turn_count','temperature_c','humidity_percent','skin_conductance'];
function finite(value){if(value==null||value===''||typeof value==='boolean')return null;const n=Number(value);return Number.isFinite(n)?n:null}
function field(sample,key){if(!sample||sample[key]==null)return null;const invalid=Array.isArray(sample.invalid_fields)?sample.invalid_fields:[];return invalid.includes(invalidNames[key]||key)?null:sample[key]}
function text(id,value){const node=$(id);if(node)node.textContent=value}
function number(value,digits=0){const n=finite(value);return n==null?'--':n.toFixed(digits)}
function formatTime(value,seconds=true){if(value==null)return'--';const d=typeof value==='number'?new Date(value*1000):new Date(value);if(Number.isNaN(d.getTime()))return'--';return new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',second:seconds?'2-digit':undefined,hour12:false}).format(d)}
function formatDuration(value){const n=finite(value);if(n==null||n<0)return'--';const h=Math.floor(n/3600),m=Math.floor(n%3600/60);return h?((h+'小时 '+m+'分钟')):(m+'分钟')}
function sampleKey(sample){return sample?String(sample.seq??sample.unix_time??sample.timestamp??'none'):null}
function sampleIsStale(){return !state.live?.sample||!state.lastSampleChangedAt||Date.now()-state.lastSampleChangedAt>4500}
function sampleUsable(){const sample=state.live?.sample;return !!sample&&sample.connected!==false&&!sampleIsStale()}
function extendedField(sample,key,pillow=state.live?.pillow||{}){
  if(sample?.[key]!=null)return sample[key];
  const pillowKeys={pressure_matrix:'pressure_zones',pillow_pressure_delta:'pressure_change',temperature_c:'temperature_c',humidity_percent:'humidity_pct'};
  return pillowKeys[key]?pillow[pillowKeys[key]]:null;
}
function missingFields(){const sample=state.live?.sample||{},pillow=state.live?.pillow||{};const explicit=Array.isArray(state.live?.missing_fields)?state.live.missing_fields:[];return [...new Set([...explicit,...requiredExtended.filter(key=>extendedField(sample,key,pillow)==null)])]}
function setChip(id,statusId,kind,label){const chip=$(id);if(chip)chip.dataset.state=kind;text(statusId,label)}
function safeRender(name,fn){try{fn()}catch(error){console.error(name,error)}}
function showToast(message){const node=$('toast');if(!node)return;node.textContent=message;node.hidden=false;clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>node.hidden=true,3200)}

function renderTop(){
  if(state.wsState==='open')setChip('transport-chip','transport-status','ok','WebSocket');
  else if(state.wsState==='fallback')setChip('transport-chip','transport-status','warn','轮询降级');
  else setChip('transport-chip','transport-status','bad','正在重连');
  const sample=state.live?.sample;
  if(!sample)setChip('device-chip','device-status','bad','无数据');
  else if(sample.connected===false)setChip('device-chip','device-status','bad','设备离线');
  else if(sampleIsStale())setChip('device-chip','device-status','warn','数据过期');
  else setChip('device-chip','device-status','ok','设备在线');
  text('data-age',state.lastSampleChangedAt?Math.max(0,Math.round((Date.now()-state.lastSampleChangedAt)/1000))+'秒前':'--');
}
function updateVoice(voice){
  const v=voice&&typeof voice==='object'?voice:{};
  const mode=Object.hasOwn(voiceNames,v.mode)?v.mode:'wait';
  window.DGXiaomeng?.render(mode);
  const stage=$('avatar-stage');if(stage)stage.dataset.mode=mode;
  text('voice-mode',voiceNames[mode]);text('voice-detail',v.detail||(mode==='wait'?'等待唤醒词：嗨，小梦':'语音状态更新中'));
  text('monitor-voice-mode',voiceNames[mode]);text('monitor-voice-detail',v.detail||(mode==='wait'?'等待唤醒词：嗨，小梦':'语音状态更新中'));
  const monitorStage=$('monitor-avatar-stage');if(monitorStage)monitorStage.dataset.mode=mode;
  $$('[data-voice-mode]').forEach(node=>node.classList.toggle('active',node.dataset.voiceMode===mode));
}
function clearLiveMetrics(){
  ['heart','breath','motion','turn-count','snore-count','pressure-delta','temperature','humidity','skin-conductance','sleep-state','assist-state','presence','radar-state','csi-stability','model-state','personal-score','personal-heart','personal-breath','personal-motion','personal-presence'].forEach(id=>text(id,'--'));
  text('live-badge','无有效数据');text('personal-sleep-state','等待睡眠数据');text('personal-intervention','等待设备状态');
}
function renderLive(){
  const payload=state.live||{},sample=payload.sample,usable=sampleUsable();
  updateVoice(usable?payload.voice_state:null);
  if(!usable){clearLiveMetrics();renderTop();renderControl();return}
  const pillow=payload.pillow||{},pressureDelta=extendedField(sample,'pillow_pressure_delta',pillow),temperature=extendedField(sample,'temperature_c',pillow),humidity=extendedField(sample,'humidity_percent',pillow);
  const heart=field(sample,'heart_bpm'),breath=field(sample,'breath_bpm'),motion=field(sample,'csi_motion')??field(sample,'motion');
  const score=field(sample,'sleep_score'),presence=field(sample,'presence'),snoreCount=finite(sample.snore_events);
  text('sample-seq','帧序号 '+(sample.seq??'--'));text('sample-time','采样时间 '+formatTime(sample.timestamp||sample.unix_time));
  text('heart',number(heart,1));text('breath',number(breath,1));text('motion',number(motion,3));
  text('personal-heart',number(heart,0));text('personal-breath',number(breath,0));text('personal-motion',number(motion,2));text('personal-score',number(score,0));
  text('personal-score-note',score==null?'等待有效数据':(score>=80?'整体状态良好':score>=60?'仍需持续观察':'建议查看检测版'));
  text('presence',presence==null?'--':presence?'在床':'离床');text('personal-presence',presence==null?'--':presence?'在床':'离床');
  text('heart-note',heart==null?'数据无效':'毫米波雷达');text('breath-note',breath==null?'数据无效':'毫米波雷达');text('motion-note',motion==null?'数据无效':'Wi-Fi CSI');
  text('turn-count',number(sample.turn_count));text('turn-note',sample.turn_count==null?'接口未接入':sample.turn_event?'刚刚翻身':'本次累计');
  text('snore-count',number(snoreCount));text('snore-state',sample.snore_active==null?'无有效鼾声数据':sample.snore_active?'正在检测鼾声':'当前未检测到');
  text('pressure-delta',number(pressureDelta,3));text('pressure-note',pressureDelta==null?'接口未接入':'压力变化值');
  text('temperature',number(temperature,1));text('humidity',number(humidity,0));text('environment-note',temperature==null&&humidity==null?'接口未接入':'环境传感器');
  text('skin-conductance',number(sample.skin_conductance,2));text('skin-note',sample.skin_conductance==null?'接口未接入':'皮肤电活动');
  const sk=String(sample.sleep_state||'unknown').toLowerCase(),sleep=sleepNames[sk]||sample.sleep_state||'未知';
  text('sleep-state',sleep);text('personal-sleep-state',sleep);text('personal-sample-time','采样时间 '+formatTime(sample.timestamp||sample.unix_time));
  text('assist-state',assistNames[sample.assist_state]||sample.assist_state||'--');text('personal-intervention',assistNames[sample.assist_state]||sample.assist_state||'未启用干预');
  text('radar-state',sample.radar_phase_valid==null?'--':sample.radar_phase_valid?'有效':'无效');text('csi-stability',number(sample.csi_stability,2));
  const model=payload.model||{};text('model-state',model.ready?(model.label||'已就绪'):'未就绪');
  text('live-badge','实时');text('latest-event',payload.voice_event?.text||sample.device_action||'暂无新事件');
  const missing=missingFields();text('personal-missing','缺失指标：'+(missing.length?missing.join('、'):'无'));text('ai-missing-fields',missing.length?missing.join('、'):'无');
  text('guardian-sleep-state',sleep);text('guardian-assist-state',assistNames[sample.assist_state]||sample.assist_state||'--');text('guardian-data-state',missing.length?('缺 '+missing.length+' 项'):'数据完整');
  renderTop();renderHeatmap(sample.pressure_matrix??payload.pillow?.pressure_zones);renderAiEvidence();renderControl();renderScreenPolicy();
}

function renderEsp(){
  const esp=state.live?.esp,eeg=esp?.eeg||{},bands=eeg.bands||{},stale=esp?.stale!==false;
  text('eeg-alpha',bands.alpha==null?'--':number(bands.alpha,2));
  text('eeg-unit',eeg.unit||'µV');
  text('eeg-note',!esp?'等待 ESP 数据':stale?'ESP 数据已过期':('质量 '+(eeg.signal_quality==null?'--':number(eeg.signal_quality,0)+'%')+' · '+(esp.device_id||'ESP')));
  renderEspPage();
}

function renderEspPage(){
  const esp=state.live?.esp,eeg=esp?.eeg||{},samples=Array.isArray(eeg.raw_samples)?eeg.raw_samples:[],bands=eeg.bands||{},stale=!esp||esp.stale!==false;
  text('esp-page-status',!esp?'未收到数据':stale?'数据已过期':'实时接收');text('esp-device-id',esp?.device_id||'--');text('esp-source-ip',esp?.source_ip||'--');text('esp-seq',esp?.seq??'--');text('esp-age',esp?number(esp.age_ms,0)+' ms':'--');text('esp-uptime',esp?.uptime_ms==null?'--':formatDuration(esp.uptime_ms/1000));
  text('esp-sample-rate',eeg.sample_rate_hz==null?'--':number(eeg.sample_rate_hz,0));text('esp-signal-quality',eeg.signal_quality==null?'--':number(eeg.signal_quality,0));text('esp-contact',eeg.contact==null?'--':eeg.contact?'接触良好':'未接触');text('esp-sample-count',samples.length||'--');
  const dot=$('esp-connection-dot');if(dot)dot.className='esp-connection-dot '+(!esp?'':stale?'stale':'live');const note=$('esp-data-note');if(note){note.className='esp-data-note '+(!esp?'':stale?'stale':'live');note.textContent=!esp?'尚未收到 ESP 脑电数据。':stale?'最后一帧已过期，不作为实时脑电使用。':'正在接收 ESP 实时脑电数据。'}
  $$('#esp-band-list [data-band]').forEach(row=>{const value=finite(bands[row.dataset.band]);row.querySelector('strong').textContent=stale||eeg.contact===false||value==null||value<0||value>1?'--':number(value*100,1)});
  const extra=$('esp-extra-metrics');if(extra){extra.replaceChildren();const entries=Object.entries(esp?.metrics||{});if(!entries.length){const p=document.createElement('p');p.textContent='等待 metrics 数据';extra.append(p)}else entries.forEach(([key,value])=>{const row=document.createElement('div'),label=document.createElement('span'),out=document.createElement('strong');label.textContent=key;out.textContent=number(value,3);row.append(label,out);extra.append(row)})}
  if(state.activeView==='esp')drawEspPageWaveform();
}

function drawEspPageWaveform(){
  drawEegBands();
  const target=canvasContext('esp-wave-chart'),empty=$('esp-wave-empty');if(!target)return;const{ctx,width,height}=target,eeg=state.live?.esp?.eeg||{},samples=Array.isArray(eeg.raw_samples)?eeg.raw_samples.map(finite).filter(v=>v!=null):[];ctx.clearRect(0,0,width,height);
  if(empty)empty.hidden=!!samples.length;if(!samples.length){text('esp-wave-range','--');return}const rawMin=Math.min(...samples),rawMax=Math.max(...samples),span=Math.max(rawMax-rawMin,1),min=rawMin-span*.12,max=rawMax+span*.12,range=max-min,pad={l:46,r:12,t:18,b:25},w=width-pad.l-pad.r,h=height-pad.t-pad.b;
  ctx.strokeStyle='rgba(167,209,225,.14)';ctx.lineWidth=1;for(let i=0;i<=4;i++){const y=pad.t+h*i/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+w,y);ctx.stroke()}for(let i=0;i<=5;i++){const x=pad.l+w*i/5;ctx.beginPath();ctx.moveTo(x,pad.t);ctx.lineTo(x,pad.t+h);ctx.stroke()}
  const gradient=ctx.createLinearGradient(0,0,width,0);gradient.addColorStop(0,'#a885ff');gradient.addColorStop(1,'#67e2f2');ctx.strokeStyle=gradient;ctx.lineWidth=2;ctx.beginPath();samples.forEach((v,i)=>{const x=pad.l+i/Math.max(1,samples.length-1)*w,y=pad.t+(max-v)/range*h;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();
  ctx.fillStyle='#8cabb5';ctx.font='11px sans-serif';ctx.textAlign='right';ctx.fillText(number(rawMax,1),pad.l-6,pad.t+4);ctx.fillText(number(rawMin,1),pad.l-6,pad.t+h);ctx.textAlign='center';ctx.fillText(samples.length+' 点 · '+number(eeg.sample_rate_hz,0)+' Hz',pad.l+w/2,height-6);text('esp-wave-range',number(rawMin,1)+'～'+number(rawMax,1)+' '+(eeg.unit||'µV'));
}

function drawEegBands(){
  const target=canvasContext('esp-filter-chart');if(!target)return;
  const {ctx,width,height}=target,s=eegBandStream.snapshot(),fresh=Date.now()-s.lastAt<2000;
  ctx.clearRect(0,0,width,height);
  text('esp-filter-state',!fresh?'等待连续数据':!s.ready?'积累中 '+number(s.count/s.rate,1)+'/6秒':'分频 · '+s.unit);
  const left=88,right=12,top=8,bottom=22,w=Math.max(1,width-left-right),lane=Math.max(1,(height-top-bottom)/5);
  ctx.font='11px sans-serif';
  s.bands.forEach((band,i)=>{
    const cy=top+(i+.5)*lane,values=s.rows[i]||[];
    ctx.strokeStyle='rgba(119,215,233,.16)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,cy);ctx.lineTo(width-right,cy);ctx.stroke();
    ctx.fillStyle=band[4];ctx.textAlign='left';ctx.fillText(band[1],4,cy-3);ctx.fillStyle='#8cabb5';ctx.fillText(band[2]+'–'+band[3]+' Hz',4,cy+10);
    if(!s.ready||!fresh||!values.length){ctx.fillText(s.rate&&band[3]>=s.rate/2?'采样率不足':'等待连续采样',left+8,cy-4);return}
    const peak=Math.max(1,...values.map(Math.abs));
    ctx.save();ctx.beginPath();ctx.rect(left,top+i*lane,w,lane);ctx.clip();ctx.strokeStyle=band[4];ctx.lineWidth=1.3;ctx.beginPath();
    values.forEach((v,j)=>{const x=left+w*(1-(values.length-1-j)/(s.rate*6)),y=cy-v/peak*lane*.36;j?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();ctx.restore();
    ctx.fillStyle='#8cabb5';ctx.textAlign='right';ctx.fillText('±'+number(peak,1),width-right,top+i*lane+11);
  });
  ctx.fillStyle='#8cabb5';ctx.textAlign='left';ctx.fillText('−6秒',left,height-4);ctx.textAlign='right';ctx.fillText('0秒 · 各频段独立幅值刻度',width-right,height-4);
}

function acceptLive(payload){
  if(!payload||typeof payload!=='object')return;
  const key=sampleKey(payload.sample);
  if(key&&key!==state.lastSampleKey){state.lastSampleKey=key;state.lastSampleChangedAt=Date.now();dashboardWaveform.push({heart:chartValue(payload.sample,'heart_bpm'),breath:chartValue(payload.sample,'breath_bpm'),motion:chartValue(payload.sample,payload.sample?.csi_motion!=null?'csi_motion':'motion')});if(payload.sample?.connected!==false)state.liveHistory.push(payload.sample);if(state.liveHistory.length>600)state.liveHistory.shift()}
  state.live=payload;
  DGSleepArchive.capture(payload,state.history,buildEvents(Infinity,true));

  eegBandStream.push(payload.esp);
  captureHomeEeg(payload.esp);
  window.__dreamguardianLatest=payload;window.dispatchEvent(new CustomEvent('dreamguardian:telemetry',{detail:payload}));
  if(payload.device_state)state.control={...(state.control||{}),device_state:payload.device_state,online:payload.device_state.online??payload.sample?.connected};
  safeRender('esp',renderEsp);safeRender('live',renderLive);safeRender('charts',drawDashboardCharts);
}
function canvasContext(id){
  const canvas=$(id);if(!canvas||canvas.offsetParent===null)return null;
  const rect=canvas.getBoundingClientRect(),scale=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--display-scale'))||1,ratio=Math.min(devicePixelRatio||1,2);
  const pixelWidth=Math.max(1,Math.round(rect.width*ratio)),pixelHeight=Math.max(1,Math.round(rect.height*ratio));
  if(canvas.width!==pixelWidth)canvas.width=pixelWidth;if(canvas.height!==pixelHeight)canvas.height=pixelHeight;
  const ctx=canvas.getContext('2d');ctx.setTransform(ratio*scale,0,0,ratio*scale,0,0);return{canvas,ctx,width:rect.width/scale,height:rect.height/scale}
}
function chartValue(item,key){if(!item||item.connected===false)return null;if((key==='heart_bpm'||key==='breath_bpm')&&item.bio_valid===false)return null;return finite(field(item,key))}
function drawLineChart(id,items,key,color,label){
  const target=canvasContext(id);if(!target)return;const{ctx,width,height}=target;ctx.clearRect(0,0,width,height);
  const pad={l:46,r:14,t:10,b:24},pw=Math.max(1,width-pad.l-pad.r),ph=Math.max(1,height-pad.t-pad.b);
  const points=(Array.isArray(items)?items:[]).map((item,index)=>({value:chartValue(item,key),time:finite(item?.unix_time)??index}));const valid=points.filter(p=>p.value!=null);
  ctx.strokeStyle='rgba(119,215,233,.13)';ctx.lineWidth=1;for(let i=0;i<3;i++){const y=pad.t+ph*i/2;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+pw,y);ctx.stroke()}
  if(!valid.length){ctx.fillStyle='#8cabb5';ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText('暂无有效'+label+'数据',width/2,height/2);return}
  let min=Math.min(...valid.map(p=>p.value)),max=Math.max(...valid.map(p=>p.value));let extra=(max-min)*.15||Math.max(Math.abs(max)*.08,1);min-=extra;max+=extra;if(key==='motion'||key==='csi_motion')min=Math.max(0,min);
  let mint=Math.min(...points.map(p=>p.time)),maxt=Math.max(...points.map(p=>p.time));if(mint===maxt)maxt=mint+1;
  ctx.strokeStyle=color;ctx.lineWidth=2;ctx.lineJoin='round';ctx.beginPath();let drawing=false;
  points.forEach(p=>{if(p.value==null){drawing=false;return}const x=pad.l+(p.time-mint)/(maxt-mint)*pw,y=pad.t+(max-p.value)/(max-min)*ph;if(!drawing){ctx.moveTo(x,y);drawing=true}else ctx.lineTo(x,y)});ctx.stroke();
  ctx.fillStyle='#c5dce5';ctx.font='600 12px sans-serif';ctx.textAlign='right';ctx.fillText(max.toFixed(key.includes('motion')?2:1),pad.l-5,pad.t+4);ctx.fillText(min.toFixed(key.includes('motion')?2:1),pad.l-5,pad.t+ph);
  ctx.font='11px sans-serif';ctx.fillStyle='#9eb6c7';
  const hasTime=items.some(item=>finite(item?.unix_time)!=null);
  for(let i=0;i<3;i++){const t=mint+(maxt-mint)*i/2;const tick=hasTime?new Date(t*1000).toLocaleTimeString('zh-CN',{hour12:false}):'第 '+Math.round(t+1)+' 点';ctx.textAlign=i===0?'left':i===2?'right':'center';ctx.fillText(tick,pad.l+pw*i/2,height-5);}
}
function drawWaveform(id,key,color,minSpan){
  const target=canvasContext(id);if(!target)return;
  const {ctx,width,height}=target,points=dashboardWaveform.points(key),{start,end}=dashboardWaveform.range();
  const left=8,right=8,top=7,bottom=7,w=Math.max(1,width-left-right),h=Math.max(1,height-top-bottom);
  const visible=points.filter(p=>p.t>=start&&p.t<=end&&p.value!=null);
  const values=visible.map(p=>p.value);let minimum=0,maximum=minSpan;
  if(values.length){
    const rawMin=Math.min(...values),rawMax=Math.max(...values),rawSpan=rawMax-rawMin;
    const span=Math.max(rawSpan,minSpan),padding=span*.18+(span-rawSpan)/2;
    minimum=rawMin-padding;maximum=rawMax+padding;
    if(key==='motion')minimum=Math.max(0,minimum);
    else minimum=Math.max(key==='heart'?30:2,minimum);
    if(maximum-minimum<minSpan){const center=(minimum+maximum)/2;minimum=center-minSpan/2;maximum=center+minSpan/2;}
  }
  const scale=Math.max(.0001,maximum-minimum);
  ctx.clearRect(0,0,width,height);ctx.strokeStyle='rgba(167,209,225,.16)';ctx.lineWidth=1;
  for(let i=0;i<=4;i++){const x=left+w*i/4;ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,top+h);ctx.stroke();}
  for(let i=0;i<=2;i++){const y=top+h*i/2;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(left+w,y);ctx.stroke();}
  ctx.save();ctx.beginPath();ctx.rect(left,top,w,h);ctx.clip();
  const coords=visible.map(p=>({x:left+(p.t-start)/10*w,y:top+(maximum-p.value)/scale*h}));
  if(coords.length>1){
    ctx.beginPath();ctx.moveTo(coords[0].x,top+h);for(const p of coords)ctx.lineTo(p.x,p.y);ctx.lineTo(coords[coords.length-1].x,top+h);ctx.closePath();
    const fill=ctx.createLinearGradient(0,top,0,top+h);fill.addColorStop(0,color+'42');fill.addColorStop(1,color+'05');ctx.fillStyle=fill;ctx.fill();
  }
  ctx.strokeStyle=color;ctx.shadowColor=color;ctx.shadowBlur=6;ctx.lineWidth=2.5;ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();let drawing=false;
  for(const p of visible){const x=left+(p.t-start)/10*w,y=top+(maximum-p.value)/scale*h;if(drawing)ctx.lineTo(x,y);else{ctx.moveTo(x,y);drawing=true;}}
  ctx.stroke();ctx.shadowBlur=0;
  const latestVisible=visible[visible.length-1];if(latestVisible){const x=left+(latestVisible.t-start)/10*w,y=top+(maximum-latestVisible.value)/scale*h;ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,3.2,0,Math.PI*2);ctx.fill();}
  ctx.restore();
  const latest=points[points.length-1],output=$(id+'-value');
  if(output)output.textContent=latest?.value==null?'--':number(latest.value,key==='motion'?3:1);
  const range=$(id+'-range'),digits=key==='motion'?3:1;if(range)range.textContent=values.length?(number(Math.min(...values),digits)+'–'+number(Math.max(...values),digits)):'--';
  target.canvas.setAttribute('aria-label','最近10秒'+({heart:'心率',breath:'呼吸',motion:'体动'}[key])+'波形，当前 '+(output?.textContent||'--'));
}
function drawDashboardCharts(){drawCombinedWaveforms();drawEegWaveform()}
function drawCombinedWaveforms(){
  const target=canvasContext('trend-signals');if(!target)return;const{ctx,width,height}=target,{start,end}=dashboardWaveform.range();
  const signals=[{key:'heart',color:'#ff938a',minSpan:8,digits:1},{key:'breath',color:'#77efff',minSpan:4,digits:1},{key:'motion',color:'#ffda78',minSpan:.08,digits:3}];
  const left=12,right=12,top=10,bottom=24,w=Math.max(1,width-left-right),h=Math.max(1,height-top-bottom);
  ctx.clearRect(0,0,width,height);ctx.strokeStyle='rgba(167,209,225,.08)';ctx.lineWidth=1;
  for(let i=0;i<=4;i++){const x=left+w*i/4;ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,top+h);ctx.stroke()}for(let i=0;i<=2;i++){const y=top+h*i/2;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(left+w,y);ctx.stroke()}
  ctx.fillStyle='#7895a8';ctx.font='10px sans-serif';
  for(let i=0;i<=6;i++){ctx.textAlign=i===0?'left':i===6?'right':'center';ctx.fillText(i===6?'现在':(i*5-30)+'s',left+w*i/6,height-5)}
  signals.forEach(signal=>{
    const points=dashboardWaveform.points(signal.key),visible=points.filter(p=>p.t>=start&&p.t<=end),values=visible.filter(p=>p.value!=null).map(p=>p.value);let minimum=0,maximum=signal.minSpan;
    if(values.length){const rawMin=Math.min(...values),rawMax=Math.max(...values),rawSpan=rawMax-rawMin,span=Math.max(rawSpan,signal.minSpan),padding=span*.18+(span-rawSpan)/2;minimum=rawMin-padding;maximum=rawMax+padding;if(signal.key==='motion')minimum=Math.max(0,minimum);else minimum=Math.max(signal.key==='heart'?30:2,minimum);if(maximum-minimum<signal.minSpan){const center=(minimum+maximum)/2;minimum=center-signal.minSpan/2;maximum=center+signal.minSpan/2}}
    const scale=Math.max(.0001,maximum-minimum);ctx.save();ctx.beginPath();ctx.rect(left,top,w,h);ctx.clip();ctx.strokeStyle=signal.color;ctx.shadowColor=signal.color;ctx.shadowBlur=0;ctx.lineWidth=1.4;ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();let drawing=false;
    visible.forEach(p=>{if(p.value==null){drawing=false;return}const x=left+(p.t-start)/30*w,y=top+(maximum-p.value)/scale*h;if(drawing)ctx.lineTo(x,y);else{ctx.moveTo(x,y);drawing=true}});ctx.stroke();ctx.restore();
    const latest=points[points.length-1],output=$('trend-'+signal.key+'-value');if(output)output.textContent=latest?.value==null?'--':number(latest.value,signal.digits);const range=$('trend-'+signal.key+'-range');if(range)range.textContent=values.length?number(Math.min(...values),signal.digits)+'–'+number(Math.max(...values),signal.digits):'--';
  });
  target.canvas.setAttribute('aria-label','最近30秒心率、呼吸与体动归一化变化叠加图');
}
function drawEegWaveform(){
  const target=canvasContext('trend-eeg');if(!target)return;
  const {ctx,width,height}=target,now=performance.now()/1000,start=now-5;
  const points=homeEeg.points.filter(p=>p.t>=start&&p.t<=now),values=points.filter(p=>p.value!=null).map(p=>p.value);
  const left=12,w=width-24,top=10,h=Math.max(1,height-34);
  ctx.clearRect(0,0,width,height);ctx.lineWidth=1;ctx.font='10px sans-serif';ctx.fillStyle='#7895a8';
  for(let i=0;i<=5;i++){const x=left+w*i/5;ctx.strokeStyle='rgba(167,209,225,.08)';ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,top+h);ctx.stroke();ctx.textAlign=i===0?'left':i===5?'right':'center';ctx.fillText(i===5?'现在':(i-5)+'s',x,height-5)}
  for(let i=0;i<=2;i++){ctx.beginPath();ctx.moveTo(left,top+h*i/2);ctx.lineTo(left+w,top+h*i/2);ctx.stroke()}
  const fresh=state.live?.esp?.stale===false&&state.live?.esp?.eeg?.contact!==false&&points.length&&now-points.at(-1).t<2;
  text('trend-eeg-value',fresh?number(points.at(-1)?.value,1):'--');text('trend-eeg-range','5秒 · '+(homeEeg.rate?homeEeg.rate+' Hz':'等待数据'));
  if(!values.length)return;
  const lo=Math.min(...values),hi=Math.max(...values),span=Math.max(hi-lo,1)*1.25,center=(hi+lo)/2;
  ctx.save();ctx.beginPath();ctx.rect(left,top,w,h);ctx.clip();ctx.strokeStyle=fresh?'#b7a5ee':'#64718c';ctx.lineWidth=1;ctx.lineJoin='round';ctx.beginPath();let drawing=false;
  for(const p of points){if(p.value==null){drawing=false;continue}const x=left+(p.t-start)/5*w,y=top+(.5-(p.value-center)/span)*h;if(drawing)ctx.lineTo(x,y);else{ctx.moveTo(x,y);drawing=true}}
  ctx.stroke();ctx.restore();
}
function drawReportCharts(){drawLineChart('report-heart-chart',state.history,'heart_bpm','#ff817b','心率');drawLineChart('report-breath-chart',state.history,'breath_bpm','#67e2f2','呼吸');drawLineChart('report-motion-chart',state.history,'motion','#f1c96d','体动')}
const pressureRaster=document.createElement('canvas');pressureRaster.width=180;pressureRaster.height=108;
function renderHeatmap(matrix){
  const empty=$('heatmap-empty'),source=$('pressure-source');
  const zones=window.DGPressureField.values(matrix);
  const target=canvasContext('pressure-heatmap');
  if(!zones||zones.every(v=>v==null)){
    if(empty){empty.hidden=false;empty.textContent='等待上下两排共 6 点压力数据';}
    if(source)source.textContent='未接入';
    if(target)target.ctx.clearRect(0,0,target.width,target.height);return;
  }
  if(empty)empty.hidden=true;
  if(source)source.textContent=zones.some(v=>v==null)?'部分测点缺失':'6 点估算';
  if(!target)return;
  const {ctx,width,height}=target;
  DGPressureField.raster(pressureRaster.getContext('2d'),zones);
  ctx.clearRect(0,0,width,height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  ctx.drawImage(pressureRaster,0,0,width,height);
  DGPressureField.positions.forEach(([x,y],i)=>{
    ctx.beginPath();ctx.arc(x*width,y*height,3,0,Math.PI*2);
    ctx.fillStyle=zones[i]==null?'#263844':'#ffffff';ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle='#09213b';ctx.stroke();
    ctx.font='600 11px sans-serif';ctx.textAlign='center';ctx.lineWidth=3;ctx.strokeStyle='#09213b';ctx.strokeText('P'+(i+1),x*width,y*height-10);ctx.fillStyle='#fff';ctx.fillText('P'+(i+1),x*width,y*height-10);
  });
  $('pressure-heatmap').setAttribute('aria-label','六传感器压力分布估算：上排 '+zones.slice(0,3).map(v=>v==null?'缺失':v.toFixed(0)).join('、')+'；下排 '+zones.slice(3).map(v=>v==null?'缺失':v.toFixed(0)).join('、'));
}
async function fetchJson(path,options={},timeout=6000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{const response=await fetch(path,{cache:'no-store',...options,signal:controller.signal});if(!response.ok){const error=new Error('HTTP '+response.status);error.status=response.status;throw error}return await response.json()}finally{clearTimeout(timer)}
}
async function pollLive(){
  if(state.pollBusy||(state.wsState==='open'&&Date.now()-state.lastWsMessageAt<1500))return;state.pollBusy=true;
  try{const payload=await fetchJson('/api/live');if(state.wsState!=='open')state.wsState='fallback';acceptLive(payload)}catch(error){if(state.wsState!=='open')state.wsState='closed';renderTop();renderControl()}finally{state.pollBusy=false}
}
function connectWebSocket(){
  clearTimeout(state.reconnectTimer);if(state.ws&&(state.ws.readyState===WebSocket.OPEN||state.ws.readyState===WebSocket.CONNECTING))return;
  state.wsState='connecting';renderTop();const scheme=location.protocol==='https:'?'wss':'ws';const socket=new WebSocket(scheme+'://'+location.host+'/ws/live');state.ws=socket;
  socket.onopen=()=>{state.wsState='open';renderTop()};socket.onmessage=e=>{state.lastWsMessageAt=Date.now();try{acceptLive(JSON.parse(e.data))}catch(error){showToast('收到无法解析的实时消息，已忽略。')}};
  socket.onerror=()=>{state.wsState='fallback';renderTop()};socket.onclose=()=>{if(state.ws===socket)state.ws=null;state.wsState='closed';renderTop();renderControl();state.reconnectTimer=setTimeout(connectWebSocket, 2000)};
}
function sleepKey(item){if(item?.presence===false)return'away';const raw=String(item?.sleep_state||'').toLowerCase();if(item?.assist_state==='sleep'&&(raw==='awake'||!raw))return'assist';if(raw.includes('deep')||raw.includes('深'))return'deep';if(raw.includes('light')||raw.includes('浅'))return'light';if(raw.includes('unstable')||raw.includes('restless')||raw.includes('不稳'))return'unstable';if(raw.includes('assist')||raw.includes('助眠'))return'assist';if(raw.includes('awake')||raw==='wake'||raw.includes('清醒')||raw.includes('return'))return'awake';return'unknown'}
async function loadLastSleep(){
  const request=++state.archiveRequest;
  state.archive={history:[],events:[],payload:{}};state.eventPage=0;
  text('timeline-record-status','正在读取上次睡眠…');renderTimeline();
  try{
    const remote=await fetchJson('/api/sleep/sessions').catch(()=>[]);
    const local=await DGSleepArchive.list().catch(()=>[]);
    const record=await DGLastSleep.latest(Array.isArray(remote)?remote:remote.sessions||[],local,
      id=>fetchJson('/api/sleep/reports/'+encodeURIComponent(id)));
    if(request!==state.archiveRequest||!state.timelineLatest)return;
    state.archive=record||{history:[],events:[],payload:{}};
    text('timeline-record-status',record?record.label||'最近一次已结束记录':'暂无已结束的睡眠记录');renderTimeline();
  }catch(error){if(request===state.archiveRequest){text('timeline-record-status','记录读取失败');renderTimeline()}}
}
window.addEventListener('dreamguardian:archive-saved',()=>{if(state.activeView==='timeline'&&state.timelineLatest)loadLastSleep()});
let sleepTimelineChart=null;
let selectedTimelineEvent=null;
window.addEventListener('resize',()=>{if(state.activeView==='timeline')requestAnimationFrame(renderEvents)});
function renderTimeline(){
  const canvas=$('sleep-stage-chart');if(!canvas)return;
  if(!sleepTimelineChart)sleepTimelineChart=DGSleepTimeline.create({canvas,key:item=>{
    const raw=String(item?.sleep_state||'').toLowerCase();
    if(item?.presence===false||['out_of_bed','left_bed','away'].includes(raw))return'away';
    if(raw==='transition')return'assist';
    return sleepKey(item);
  },onEvent:setEventDetail});
  sleepTimelineChart.update(state.archive?.history||[],buildEvents(Infinity),state.archive?.payload?.sleep_guide?.timer);renderEvents();DGSessionAssessment.render(state.archive?.payload||{},state.archive?.history||[],state.archive?.report);
}
function createDerivedEvents(items){
  const result=[];for(let i=1;i<items.length;i++){const before=items[i-1],current=items[i],stamp=current.timestamp||current.unix_time,context={heart_bpm:field(current,'heart_bpm'),breath_bpm:field(current,'breath_bpm'),motion:field(current,'motion'),sleep_score:field(current,'sleep_score'),wake_risk:field(current,'wake_risk'),temperature_c:extendedField(current,'temperature_c',{}),humidity_percent:extendedField(current,'humidity_percent',{})};
    if(before.presence!==current.presence&&current.presence!=null)result.push({timestamp:stamp,type:current.presence?'return_bed':'leave_bed',title:current.presence?'检测到回床':'检测到离床',trigger:'人体在床状态发生变化',metrics:context,source:'NX 实时遥测'});
    if(before.sleep_state!==current.sleep_state&&current.sleep_state)result.push({timestamp:stamp,type:'sleep_stage',title:'睡眠阶段：'+(sleepNames[sleepKey(current)]||current.sleep_state),trigger:'睡眠阶段字段发生变化',metrics:context,source:'NX 睡眠判断'});
    if(!before.snore_active&&current.snore_active)result.push({timestamp:stamp,type:'snore',title:'检测到鼾声',trigger:'MEMS 双麦字段 snore_active 变为有效',metrics:context,source:'NX 实时遥测'});
    if((current.turn_event&&!before.turn_event)||(finite(current.turn_count)!=null&&finite(before.turn_count)!=null&&Number(current.turn_count)>Number(before.turn_count)))result.push({timestamp:stamp,type:'turn',title:'检测到翻身',trigger:'翻身事件或累计次数增加',metrics:context,source:'NX 实时遥测'});
    if(current.device_action&&!['none','idle','--'].includes(current.device_action)&&current.device_action!==before.device_action)result.push({timestamp:stamp,type:'intervention',title:'设备动作：'+current.device_action,trigger:'设备回执状态发生变化',metrics:context,intervention:current.device_action,source:'DG 设备回执'});
  }return result;
}
function eventTime(event){return DGSleepTimeline.timestamp(event?.timestamp??event?.unix_time)||0}
function buildEvents(limit=4,live=false){
  if(!live&&!state.archive)return [];
  if(state.archive&&!live)return (state.archive.events||[]).map(DGSleepTimeline.describeEvent).sort((a,b)=>eventTime(b)-eventTime(a)).slice(0,limit);
  const remote=(Array.isArray(state.events)?state.events:[]).map(e=>({
    timestamp:e.timestamp??e.unix_time,type:e.event_type||e.type||'system',command:e.command||e.cmd||e.details?.command,
    title:e.title||e.message||e.type||'系统事件',trigger:e.trigger_reason||e.trigger||e.reason||e.details?.trigger_reason||'NX 事件记录',
    metrics:e.metrics||e.snapshot||e.sample||e.details?.metrics||e.details||{},
    intervention:e.intervention_method||e.intervention||e.action||'--',recovery:e.recovery||e.recovery_status||'--',source:e.data_source||e.source||'NX 事件数据库'
  }));
  return [...remote,...createDerivedEvents(state.history)].map(DGSleepTimeline.describeEvent).sort((a,b)=>eventTime(b)-eventTime(a)).slice(0,limit)
}
function renderEvents(){
  const all=buildEvents(Infinity),box=$('event-list');if(!box)return;box.replaceChildren();
  const count=Math.max(1,Math.min(4,Math.floor((box.clientHeight||130)/60)));
  state.eventPage=Math.min(state.eventPage,Math.max(0,Math.ceil(all.length/count)-1));
  const events=all.slice(state.eventPage*count,(state.eventPage+1)*count);box.style.gridTemplateRows='repeat('+count+',minmax(0,1fr))';
  const total=$('event-count');total.replaceChildren();
  const prev=document.createElement('button'),next=document.createElement('button'),label=document.createElement('span');
  prev.textContent='‹';prev.setAttribute('aria-label','上一页事件');next.textContent='›';next.setAttribute('aria-label','下一页事件');
  label.textContent=all.length+' 条 · '+(all.length?state.eventPage+1:0)+'/'+Math.ceil(all.length/count);
  prev.disabled=state.eventPage===0;next.disabled=(state.eventPage+1)*count>=all.length;prev.onclick=()=>{state.eventPage--;renderEvents()};next.onclick=()=>{state.eventPage++;renderEvents()};total.append(prev,label,next);
  if(!events.length){const p=document.createElement('p');p.className='empty-copy';p.textContent='暂无可展示事件';box.append(p);setEventDetail(null);return}
  const typeNames={turn:'翻身',intervention:'干预',snore:'鼾声',leave_bed:'离床',return_bed:'回床',sleep_stage:'阶段变化',offline_demo:'离线演示'};
  events.forEach((event,index)=>{const b=document.createElement('button');b.type='button';b.className='event-item';b.innerHTML='<time></time><strong></strong><span></span>';b.querySelector('time').textContent=formatTime(event.timestamp);b.querySelector('strong').textContent=event.title;b.querySelector('span').textContent=typeNames[event.type]||event.type;b.addEventListener('click',()=>{$$('.event-item').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');sleepTimelineChart?.openEvent(event)});box.append(b)});
}
function setEventDetail(event){
  selectedTimelineEvent=event;
  const box=$('event-detail');if(!box)return;box.replaceChildren();if(!event){const p=document.createElement('p');p.className='empty-copy';p.textContent='点击事件查看详细信息';box.append(p);text('event-source','--');return}
  text('event-source',event.source||'NX');const h=document.createElement('h3');h.textContent=event.title;const time=document.createElement('p');time.textContent='发生时间：'+formatTime(event.timestamp);const reason=document.createElement('p');reason.textContent='触发原因：'+(event.trigger||'未提供');
  const dl=document.createElement('dl');const labels={heart_bpm:'心率',breath_bpm:'呼吸',motion:'体动',sleep_score:'睡眠得分',wake_risk:'苏醒风险',temperature_c:'温度',humidity_percent:'湿度'};Object.entries(event.metrics||{}).filter(([key])=>Object.hasOwn(labels,key)).slice(0,6).forEach(([key,value])=>{const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=labels[key]||key;dd.textContent=value==null?'--':(typeof value==='number'?number(value,key==='motion'?3:1):String(value));row.append(dt,dd);dl.append(row)});
  const trace=document.createElement('div');trace.className='event-trace';[['干预方法',event.intervention||'未提供'],['恢复情况',event.recovery||'未提供'],['数据来源',event.source||'NX']].forEach(([a,b])=>{const d=document.createElement('div'),s=document.createElement('span'),st=document.createElement('strong');s.textContent=a;st.textContent=b;d.append(s,st);trace.append(d)});box.append(h,time,reason,dl,trace);
}
function valuesFor(key){return state.history.map(x=>chartValue(x,key)).filter(x=>x!=null)}
function average(key){const a=valuesFor(key);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null}
function renderReport(){
  text('report-samples',state.history.filter(x=>x&&x.connected!==false).length);text('report-heart',number(average('heart_bpm'),1));text('report-breath',number(average('breath_bpm'),1));
  const motions=valuesFor('motion');text('report-motion',number(motions.length?Math.max(...motions):null,3));text('report-score',number(average('sleep_score'),0));drawReportCharts();
}
async function loadHistory(minutes){
  const request=++state.historyRequest;try{const items=await fetchJson('/api/history?minutes='+minutes,{},8000);if(request!==state.historyRequest)return;state.history=Array.isArray(items)?items.filter(x=>x&&typeof x==='object').sort((a,b)=>(finite(a.unix_time)??0)-(finite(b.unix_time)??0)):[];renderTimeline();renderReport()}catch(error){if(request!==state.historyRequest)return;state.history=[];renderTimeline();renderReport();showToast('历史数据暂时无法读取。')}
}
async function loadEvents(){try{const items=await fetchJson('/api/events');state.events=Array.isArray(items)?items:[]}catch(error){state.events=[]}if(state.activeView==='timeline')renderTimeline();else renderEvents()}
async function openSleepRecord(id){
  state.timelineLatest=false;state.eventPage=0;
  if(!id)return;const request=++state.archiveRequest;
  try{
    let record=await DGSleepArchive.get(id).catch(()=>null);
    if(!record){const report=await fetchJson('/api/sleep/reports/'+encodeURIComponent(id));record={history:report.history||report.samples||[],events:report.events||[],report,payload:{sleep_guide:{timer:report.timer||{}}},label:state.sessions.find(s=>s.session_id===id)?.label||id};}
    if(request!==state.archiveRequest)return;
    state.archive=record;selectView('timeline');$('timeline-title').textContent=record.label||'历史睡眠时间轴';$('timeline-back').textContent='← 返回历史报告 · 记录列表';$('timeline-back').hidden=false;text('timeline-record-status','历史已结束记录');renderTimeline();
    if(!record.history.length)showToast('这条记录尚未保存时间轴数据，当前不显示实时数据。');
  }catch(error){if(request===state.archiveRequest)showToast('无法读取这次睡眠记录，请稍后重试。')}
}
async function loadSessions(){
  try{const data=await fetchJson('/api/sleep/sessions').catch(()=>[]);const remote=Array.isArray(data)?data:(data.sessions||[]);const local=await DGSleepArchive.list().catch(()=>[]);state.sessions=[...new Map([...remote,...local].map(s=>[s.session_id,s])).values()].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));renderSleepRecords();text('report-notice',state.sessions.length?'展开历史睡眠记录，选择想回看的那一晚。':'暂无整晚睡眠记录');drawScoreBars()}
  catch(error){state.sessions=[];text('report-source','接口未接入');const empty=$('score-bars-empty');if(empty)empty.hidden=false}
}
function renderSleepRecords(){
  const list=$('sleep-record-list'),scroll=list.scrollTop;list.replaceChildren();
  if(!state.sessions.length){const empty=document.createElement('p');empty.textContent='暂无历史睡眠记录，完成一次睡眠后可在这里查看。';list.append(empty);return}
  state.sessions.forEach(item=>{
    const row=document.createElement('button');row.type='button';row.className='sleep-record';
    const info=document.createElement('span'),title=document.createElement('strong'),detail=document.createElement('small');
    title.textContent=item.label||item.date||item.session_id;
    const timer=item.payload?.sleep_guide?.timer||item.timer||{};
    const start=DGSleepTimeline.timestamp(timer.started_unix??item.start_time??item.started_at),end=DGSleepTimeline.timestamp(timer.ended_unix??item.end_time??item.ended_at);
    if(Number.isFinite(start)&&Number.isFinite(end)&&end>start){const minutes=Math.round((end-start)/60000);detail.textContent=formatTime(start/1000)+' — '+formatTime(end/1000)+' · '+Math.floor(minutes/60)+'小时'+minutes%60+'分'}
    else detail.textContent=item.local?'本地保存的睡眠记录':document.body.dataset.offline==='true'?'模拟睡眠记录':'睡眠记录';
    info.append(title,detail);row.append(info);
    const score=finite(item.sleep_score??item.score);if(score!=null){const badge=document.createElement('span');badge.className='sleep-record-score';badge.textContent=Math.round(score)+' 分';row.append(badge)}
    row.onclick=()=>{loadReport(item.session_id);openSleepRecord(item.session_id)};list.append(row);
  });list.scrollTop=scroll;
}
function drawScoreBars(){
  const empty=$('score-bars-empty'),target=canvasContext('report-score-bars');if(!target)return;
  const {ctx,width,height}=target;ctx.clearRect(0,0,width,height);target.canvas.onclick=null;
  const items=state.sessions.map((x,i)=>({...x,scoreValue:finite(x.sleep_score??x.score),time:Date.parse(x.date||x.start_time||x.started_at||''),order:i}))
    .filter(x=>x.scoreValue!=null&&x.scoreValue>=0&&x.scoreValue<=100)
    .sort((a,b)=>Number.isFinite(a.time)&&Number.isFinite(b.time)?a.time-b.time:b.order-a.order).slice(-7);
  if(empty){empty.hidden=!!items.length;empty.textContent='暂无有效的历史睡眠评分'}
  if(!items.length){text('report-source','暂无记录');return}
  text('report-source',(document.body.dataset.offline==='true'?'模拟 · ':'')+'最近 '+items.length+' 次');
  const pad={l:32,r:8,t:24,b:42},w=Math.max(1,width-pad.l-pad.r),h=Math.max(1,height-pad.t-pad.b);
  ctx.font='10px sans-serif';ctx.lineWidth=1;
  for(let score=0;score<=100;score+=20){const y=pad.t+h*(1-score/100);ctx.strokeStyle='rgba(140,180,200,.13)';ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(width-pad.r,y);ctx.stroke();ctx.fillStyle='#8cabb5';ctx.textAlign='right';ctx.fillText(String(score),pad.l-5,y+3)}
  const slot=w/items.length,bw=Math.max(2,Math.min(42,slot*.62));
  items.forEach((item,i)=>{
    const bh=h*item.scoreValue/100,x=pad.l+slot*(i+.5)-bw/2,y=pad.t+h-bh;
    const fill=ctx.createLinearGradient(0,pad.t,0,pad.t+h);fill.addColorStop(0,'#8aadef');fill.addColorStop(1,'#4bc5ca');ctx.fillStyle=fill;
    if(bh>0){ctx.beginPath();ctx.roundRect(x,y,bw,bh,Math.min(5,bh/2,bw/2));ctx.fill()}
    ctx.fillStyle='#d8edf3';ctx.textAlign='center';ctx.fillText(String(Math.round(item.scoreValue)),x+bw/2,y-7);
    const label=Number.isFinite(item.time)?new Date(item.time).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'}):String(item.label||'第'+(i+1)+'次');
    ctx.fillStyle='#8cabb5';ctx.fillText(label,x+bw/2,pad.t+h+18,slot-2);
  });
  target.canvas.style.cursor='pointer';target.canvas.onclick=event=>{const rect=target.canvas.getBoundingClientRect(),x=(event.clientX-rect.left)*width/rect.width,y=(event.clientY-rect.top)*height/rect.height;if(x<pad.l||x>width-pad.r||y<pad.t||y>height)return;const item=items[Math.floor((x-pad.l)/slot)];if(item)openSleepRecord(item.session_id)};
  target.canvas.setAttribute('aria-label','最近'+items.length+'次睡眠质量，满分100分：'+items.map(x=>(x.date||x.label||x.session_id)+' '+x.scoreValue+'分').join('；'));
}
let reportRequest=0;
async function loadReport(sessionId){
  if(!sessionId)return;const request=++reportRequest;
  DGAssessmentDetail.setReport(null,'正在读取睡眠报告…');
  try{
    const local=await DGSleepArchive.get(sessionId).catch(()=>null);
    const report=local?.report||(local?{assessment:'本地保存记录，暂无综合评分。'}:await fetchJson('/api/sleep/reports/'+encodeURIComponent(sessionId)));
    if(request!==reportRequest)return;
    DGAssessmentDetail.setReport(report,state.sessions.find(x=>x.session_id===sessionId)?.label||sessionId);
  }catch(error){if(request===reportRequest)DGAssessmentDetail.setReport(null,'报告读取失败，请重新选择记录');showToast('无法读取该次睡眠报告。')}
}

function confirmedDevice(){return state.control?.device_state||state.live?.device_state||null}
function setCommandStatus(kind,value){$$('[data-command-status="'+kind+'"]').forEach(node=>{if(kind==='scene'){const span=node.querySelector('[data-current-scene]');if(span)span.textContent=value;else node.textContent=value}else node.textContent=value})}
function controlOnline(){return state.controlAvailable&&state.wsState==='open'&&state.control?.online!==false&&state.live?.sample?.connected!==false}
function renderControl(){
  const device=confirmedDevice(),enabled=controlOnline();
  text('control-capability',state.controlAvailable?(enabled?'控制接口就绪':'设备或链路离线'):'控制接口未接入');
  const values={brightness:finite(device?.brightness),volume:finite(device?.volume)};
  Object.entries(values).forEach(([kind,value])=>{$$('[data-confirmed-value="'+kind+'"]').forEach(n=>n.textContent=value==null?'--%':Math.round(value)+'%');$$('[data-preview="'+kind+'"]').forEach(n=>n.textContent=value==null?'--':Math.round(value)+'%');$$('[data-range="'+kind+'"]').forEach(n=>{if(value!=null&&!n.matches(':active'))n.value=String(value);n.disabled=!enabled||value==null})});
  $$('[data-action]').forEach(button=>button.disabled=!enabled);$$('[data-scene-select]').forEach(select=>select.disabled=!enabled||!state.scenes.length);
  $$('[data-playback-state]').forEach(n=>n.textContent=device?.playing===true?'播放中':device?.playing===false?'已暂停':'未连接');
  $$('[data-current-scene]').forEach(n=>n.textContent=device?.scene_name||device?.scene_id||'--');
  if(!enabled){const reason=!state.controlAvailable?'等待 NX 提供 /api/control/state':state.wsState!=='open'?'实时链路断开，控制已禁用':'DG 离线，控制已禁用';['brightness','volume'].forEach(k=>setCommandStatus(k,reason))}
  const robot=state.control?.robot_state||{},sleeping=['deep','asleep'].includes(String(state.live?.sample?.sleep_state||'').toLowerCase())||state.live?.sample?.sleep_locked===true;
  const robotReady=enabled&&robot.online===true&&!sleeping&&robot.busy!==true;text('robot-state',robot.online===true?(robot.busy?'工作中':'设备在线'):'状态未接入');const lock=$('robot-lock');if(lock){lock.dataset.state=robotReady?'ready':'locked';lock.querySelector('strong').textContent=robotReady?'安全检查通过':'安全锁定';lock.querySelector('p').textContent=sleeping?'检测到用户熟睡，禁止机械臂工作。':robotReady?'动作执行前仍需二次确认。':'等待机械臂与安全状态。'}$$('[data-robot-action]').forEach(b=>b.disabled=!robotReady);
}
async function refreshControl(){
  try{const data=await fetchJson('/api/control/state');state.control=data;state.controlAvailable=true;state.scenes=Array.isArray(data.scenes)?data.scenes:state.scenes;populateScenes()}catch(error){state.controlAvailable=false;if(error.status!==404)console.warn('control state unavailable')}renderControl()
}
function populateScenes(){
  $$('[data-scene-select]').forEach(select=>{const current=select.value;select.replaceChildren();if(!state.scenes.length){const o=document.createElement('option');o.textContent='等待场景列表';o.value='';select.append(o);return}state.scenes.forEach(scene=>{const o=document.createElement('option');o.value=scene.id;o.textContent=scene.name||scene.id;select.append(o)});select.value=confirmedDevice()?.scene_id||current||state.scenes[0].id})
}
function commandCategory(action){if(action.includes('light')||action==='set_brightness')return'brightness';if(action.includes('mute')||action==='set_volume')return'volume';if(['play','pause','stop','set_scene'].includes(action))return'scene';return action.startsWith('robot_')?'robot':'device'}
async function sendControl(action,value,target='dg'){
  const category=commandCategory(action);if(!controlOnline()){showToast('设备或实时链路不可用，未发送命令。');renderControl();return}if(state.commandLocks.has(category)){showToast('同类命令正在执行，请稍候。');return}
  const requestId='web-'+Date.now()+'-'+category;state.commandLocks.set(category,requestId);setCommandStatus(category,category==='robot'?'机械臂命令发送中':'发送中…');
  try{const result=await fetchJson('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:requestId,target,action,value})},8000);if(result.request_id&&result.request_id!==requestId)throw new Error('request_id_mismatch');if(result.status!=='success'&&result.success!==true)throw new Error(result.message||result.error||'command_failed');state.control={...(state.control||{}),...result,device_state:result.device_state||confirmedDevice()};setCommandStatus(category,category==='robot'?'机械臂命令成功':'成功 · 已按设备回执更新');showToast(result.message||'设备控制成功。');return {ok:true,message:result.message||'设备已确认',device_state:result.device_state}}
  catch(error){setCommandStatus(category,category==='robot'?'机械臂命令失败':'失败 · '+(error.message||'设备未确认'));showToast('控制失败：'+(error.message||'未收到设备回执'));return {ok:false,message:error.message||'未收到设备回执'}}finally{state.commandLocks.delete(category);renderControl()}
}
function scheduleRange(kind,value){$$('[data-preview="'+kind+'"]').forEach(n=>n.textContent=Math.round(value)+'%');clearTimeout(state.debounceTimers.get(kind));state.debounceTimers.set(kind,setTimeout(()=>sendControl(kind==='brightness'?'set_brightness':'set_volume',Number(value)),250))}
function renderScreenPolicy(){
  const request=state.live?.screen_policy?.should_sleep===true||state.live?.ui?.screen_off_requested===true;const overlay=$('screen-sleep');if(!overlay)return;overlay.hidden=!(state.edition==='personal'&&request&&Date.now()>state.awakeUntil)
}
function renderAiEvidence(){
  text('ai-live-source',sampleUsable()?'NX 实时数据':'不可用');text('ai-history-source',state.history.length?state.history.length+' 个样本':'未加载');const q=state.health?.qwen||{},m=state.live?.model||state.health?.model||{};text('ai-qwen-source',q.ready?'本地模型就绪':'模型未就绪');text('ai-anomaly-source',m.ready?'异常模型就绪':'异常模型未就绪');text('ai-model-state',state.aiAvailable&&q.ready?'Qwen 可用':'分析接口未就绪')
}
async function checkAi(){try{const result=await fetchJson('/api/ai/capabilities');state.aiAvailable=result.ready===true}catch(error){state.aiAvailable=false}const enabled=state.aiAvailable&&state.health?.qwen?.ready===true;$$('[data-question]').forEach(b=>b.disabled=!enabled);$('ai-input').disabled=!enabled;$('ai-send').disabled=!enabled;renderAiEvidence()}
function addChat(role,message){const box=$('chat-log');const item=document.createElement('div');item.className='chat-message '+role;const s=document.createElement('strong'),p=document.createElement('p');s.textContent=role==='user'?'用户':'小梦';p.textContent=message;item.append(s,p);box.append(item);while(box.children.length>4)box.firstElementChild.remove()}
async function askAi(question){if(!state.aiAvailable||!question.trim())return;addChat('user',question);$('ai-send').disabled=true;try{const result=await fetchJson('/api/ai/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,scope:'current',require_sources:true})},12000);addChat('assistant',result.answer||result.reply||'接口没有返回文字结果。');if(result.missing_fields)text('ai-missing-fields',result.missing_fields.join('、')||'无');if(result.data_source)text('ai-data-scope','数据范围：'+result.data_source)}catch(error){addChat('assistant','分析失败：'+(error.message||'接口不可用'))}finally{$('ai-send').disabled=!state.aiAvailable}}
function setHealth(id,status,label){const card=$(id);if(!card)return;card.dataset.state=status;const strong=card.querySelector('strong');if(strong)strong.textContent=label}
function renderHealth(){
  const h=state.health;if(!h){['health-bridge','health-dg','health-qwen','health-model','health-db'].forEach(id=>setHealth(id,'bad','无法读取'));renderAiEvidence();return}
  setHealth('health-bridge',h.status==='ok'?'ok':'bad',h.status==='ok'?'服务正常':'状态异常');text('health-uptime','运行时长 '+formatDuration(h.uptime_sec));
  const dg=h.dreamguardian||{};setHealth('health-dg',dg.connected?'ok':'bad',dg.connected?'设备在线':'设备离线');text('health-dg-url',dg.base_url?'地址 '+dg.base_url:'地址 --');text('nx-dg-ip',dg.ip||dg.base_url||'--');
  const q=h.qwen||{};setHealth('health-qwen',q.ready?'ok':'bad',q.ready?'服务就绪':'服务未就绪');text('health-qwen-model','模型 '+(q.model||'--'));
  const m=h.model||{};setHealth('health-model',m.ready?'ok':'bad',m.ready?'模型就绪':'模型未就绪');text('health-model-reason','原因 '+(m.reason||'--'));
  const db=h.database||{};setHealth('health-db',db.ready?'ok':'bad',db.ready?'存储就绪':'存储未就绪');text('auto-action',h.auto_action_enabled?'已开启':'已关闭');text('last-error',h.last_error?.message||h.last_error||'--');renderAiEvidence();
}
function renderTelemetry(){
  const t=state.telemetry||{};text('telemetry-seq',t.seq??'--');text('telemetry-uptime',formatDuration(t.device_uptime_sec));text('telemetry-radar-age',finite(t.radar_phase_age_ms)==null?'--':number(t.radar_phase_age_ms,1)+' ms');text('telemetry-csi-packets',t.csi_packets??'--');
  const nx=t.nx||t.system||{};text('nx-cpu',finite(nx.cpu_percent)==null?'--%':number(nx.cpu_percent,0)+'%');text('nx-gpu',finite(nx.gpu_percent)==null?'--%':number(nx.gpu_percent,0)+'%');text('nx-ram',finite(nx.ram_percent)==null?'--%':number(nx.ram_percent,0)+'%');text('nx-temperature',finite(nx.temperature_c)==null?'--°C':number(nx.temperature_c,1)+'°C');text('nx-latency',finite(t.data_latency_ms)==null?'-- ms':number(t.data_latency_ms,0)+' ms');text('nx-source',nx.cpu_percent==null&&nx.gpu_percent==null?'接口未接入':'实时遥测');
}
function renderWsHealth(){setHealth('health-ws',state.wsState==='open'?'ok':'bad',state.wsState==='open'?'实时连接':state.wsState==='fallback'?'轮询降级':'正在重连')}
async function refreshSystem(show=false){const [h,t]=await Promise.allSettled([fetchJson('/health'),fetchJson('/api/nx/telemetry')]);state.health=h.status==='fulfilled'?h.value:null;state.telemetry=t.status==='fulfilled'?t.value:null;renderHealth();renderTelemetry();renderWsHealth();await checkAi();if(show)showToast(h.status==='fulfilled'?'系统状态已刷新。':'系统状态读取失败。')}
function selectView(name){
  if(!$('view-'+name))return;state.activeView=name;const navName=['esp','guard'].includes(name)?'dashboard':name==='timeline'&&!state.timelineLatest?'reports':name;$$('.nav-button').forEach(b=>b.classList.toggle('active',b.dataset.view===navName));$$('.monitor-view').forEach(p=>{const active=p.dataset.panel===name;p.hidden=!active;p.classList.toggle('active',active)});
  window.dispatchEvent(new CustomEvent('dreamguardian:view',{detail:name}));
  if(name==='timeline'){if(state.timelineLatest)loadLastSleep();else requestAnimationFrame(renderTimeline)}if(name==='reports'){loadHistory(state.historyMinutes);loadSessions()}if(name==='system')refreshSystem(false);if(name==='control')refreshControl();if(name==='ai')checkAi();if(name==='esp')renderEspPage();
  requestAnimationFrame(()=>{if(name==='dashboard')drawDashboardCharts();if(name==='reports'){drawReportCharts();drawScoreBars()}if(name==='esp')drawEspPageWaveform()})
}
function setEdition(edition){
  state.edition=edition;document.body.dataset.edition=edition;localStorage.setItem('dg-edition',edition);$$('[data-edition]').forEach(b=>{const active=b.dataset.edition===edition;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active))});
  if(edition==='personal'){$('view-personal').hidden=false;$('view-personal').classList.add('active')}else{$('view-personal').hidden=true;$('view-personal').classList.remove('active');selectView(state.activeView)}renderScreenPolicy()
}
function fullscreenElement(){return document.fullscreenElement||document.webkitFullscreenElement||null}
function renderFullscreenButton(){
  const button=$('fullscreen-button');if(!button)return;const active=Boolean(fullscreenElement());
  button.setAttribute('aria-pressed',String(active));button.setAttribute('aria-label',active?'退出全屏':'进入全屏');
  const label=button.querySelector('strong');if(label)label.textContent=active?'退出全屏':'全屏';
}
async function toggleFullscreen(){
  try{
    if(fullscreenElement()){const exit=document.exitFullscreen||document.webkitExitFullscreen;if(exit)await exit.call(document)}
    else{const enter=document.documentElement.requestFullscreen||document.documentElement.webkitRequestFullscreen;if(!enter)throw new Error('当前浏览器不支持网页全屏');await enter.call(document.documentElement)}
  }catch(error){showToast('无法切换全屏：'+(error.message||'浏览器拒绝请求'))}finally{renderFullscreenButton()}
}
function bindControls(){
  $$('.nav-button').forEach(b=>b.addEventListener('click',()=>{state.archive=null;state.archiveRequest++;state.timelineLatest=true;state.eventPage=0;$('timeline-title').textContent='上次睡眠时间轴';$('timeline-back').hidden=true;selectView(b.dataset.view)}));
  $('timeline-back').onclick=()=>{state.archive=null;state.archiveRequest++;state.timelineLatest=true;state.eventPage=0;$('timeline-title').textContent='上次睡眠时间轴';$('timeline-back').hidden=true;selectView('reports')};
  $('open-sleep-record').onclick=()=>{const list=$('sleep-record-list');list.hidden=!list.hidden;$('open-sleep-record').setAttribute('aria-expanded',String(!list.hidden));$('open-sleep-record').textContent=list.hidden?'查看历史记录':'收起历史记录';if(!list.hidden)loadSessions()};
  const closeRecordList=()=>{$('sleep-record-list').hidden=true;$('open-sleep-record').setAttribute('aria-expanded','false');$('open-sleep-record').textContent='查看历史记录'};
  document.addEventListener('click',event=>{if(state.activeView==='reports'&&!event.target.closest('.report-history'))closeRecordList()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.activeView==='reports'&&!$('sleep-record-list').hidden){closeRecordList();$('open-sleep-record').focus()}});
  window.addEventListener('dreamguardian:archive-error',()=>showToast('本地睡眠记录保存失败，请检查浏览器存储空间或权限。'));
  $$('[data-open-view]').forEach(b=>b.addEventListener('click',()=>selectView(b.dataset.openView)));

  $$('[data-range]').forEach(input=>input.addEventListener('input',()=>scheduleRange(input.dataset.range,input.value)));
  $$('[data-action]').forEach(button=>button.addEventListener('click',()=>{const map={light_off:['set_light_power',false],light_on:['set_light_power',true],mute:['set_mute',true],unmute:['set_mute',false],play:['play',null],pause:['pause',null],stop:['stop',null]};const cmd=map[button.dataset.action];if(cmd)sendControl(cmd[0],cmd[1])}));
  $$('[data-scene-select]').forEach(select=>select.addEventListener('change',()=>sendControl('set_scene',select.value)));
  $$('[data-question]').forEach(b=>b.addEventListener('click',()=>askAi(b.dataset.question)));$('ai-form').addEventListener('submit',event=>{event.preventDefault();const value=$('ai-input').value.trim();if(value){$('ai-input').value='';askAi(value)}});
  $('refresh-system').addEventListener('click',()=>refreshSystem(true));
  $$('[data-robot-action]').forEach(button=>button.addEventListener('click',()=>{state.pendingRobotAction=button.dataset.robotAction;text('confirm-message','请确认当前环境安全，并执行“'+button.textContent+'”。NX 仍会进行睡眠状态与危险动作校验。');$('confirm-dialog').showModal()}));
  $('confirm-dialog').addEventListener('close',()=>{if($('confirm-dialog').returnValue==='confirm'&&state.pendingRobotAction)sendControl('robot_'+state.pendingRobotAction,null,'robot');state.pendingRobotAction=null});
  $('screen-sleep').addEventListener('pointerdown',()=>{state.awakeUntil=Date.now()+60000;$('screen-sleep').hidden=true});
  $('fullscreen-button').addEventListener('click',toggleFullscreen);
  document.addEventListener('fullscreenchange',renderFullscreenButton);document.addEventListener('webkitfullscreenchange',renderFullscreenButton);
  $('settings-button').addEventListener('click',()=>{refreshControl();$('settings-dialog').showModal()});
}
function tick(){text('clock',new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date()));renderTop();renderWsHealth();renderScreenPolicy();if(state.live?.sample&&!sampleUsable())renderLive()}
function start(){
  DGSignalDetails.init(dashboardWaveform,canvasContext);bindControls();updateVoice(null);tick();drawDashboardCharts();setInterval(()=>{if(state.activeView==='dashboard')drawDashboardCharts();},200);connectWebSocket();pollLive();loadHistory(5);loadEvents();refreshSystem(false);refreshControl();
  setInterval(tick,1000);setInterval(pollLive,1000);setInterval(()=>refreshSystem(false),10000);setInterval(refreshControl,10000);setInterval(loadEvents,15000);
  if('ResizeObserver'in window){let resizeFrame=0;const observer=new ResizeObserver(()=>{if(resizeFrame)return;resizeFrame=requestAnimationFrame(()=>{resizeFrame=0;if(state.activeView==='dashboard')drawDashboardCharts();if(state.activeView==='reports'){drawReportCharts();drawScoreBars()}if(state.activeView==='esp')drawEspPageWaveform();renderHeatmap(state.live?.sample?.pressure_matrix??state.live?.pillow?.pressure_zones)})});$$('canvas').forEach(canvas=>observer.observe(canvas))}
}
start();
