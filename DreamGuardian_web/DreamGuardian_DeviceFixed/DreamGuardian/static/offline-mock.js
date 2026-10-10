/* Loaded ONLY by offline.html. Every API/WS request stays in this browser tab. */
(()=>{
  const openedAt=Date.now()/1000;
  if(document.body.dataset.offline!=='true')return;
  const nativeFetch=window.fetch.bind(window);
  let guideEnabled=true;
  let selectedVoice='auto';
  window.addEventListener('xiaomeng-demo-mode',event=>{
    if(['auto','wait','wake','listen','think','answer'].includes(event.detail))selectedVoice=event.detail;
  });
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

  function rawSnapshot(){
    const now=Date.now()/1000,t=now-openedAt;
    const locked=t>=24;
    const assistState=t<8?'baseline':t<16?'settle':t<24?'entrain':'sleep_lock';
    const demoStages=[
      {risk:22,action:'none',sleep:'deep_trend',motion:0.035,label:'stable',reason:'呼吸稳定、体动低，继续无感监测'},
      {risk:44,action:'pink_noise',sleep:'light_trend',motion:0.18,label:'unstable',reason:'出现轻微睡眠不稳定，启动低音量粉红噪声'},
      {risk:64,action:'stereo_breathing',sleep:'light_trend',motion:0.43,label:'unstable',reason:'连续体动升高，启动立体声呼吸引导'},
      {risk:86,action:'reduce_arousal',sleep:'transition',motion:0.72,label:'high_risk',reason:'翻身频繁且苏醒风险较高，启动低刺激安抚'},
      {risk:96,action:'night_path',sleep:'out_of_bed',motion:0,label:'out_of_bed',reason:'未检测到在床心率且离床条件持续满足，启动起夜夜灯'}
    ];
    const demoStage=demoStages[locked?Math.floor((t-24)/12)%demoStages.length:0];
    const sleepState=locked?demoStage.sleep:(t<8?'awake':t<16?'transition':'light_trend');
    const wakeRisk=locked?demoStage.risk:clamp(68-1.2*t,38,68);
    const intervention=locked?demoStage.action:'none';
    const guideMode=!guideEnabled?'disabled':t<24?'playing':t<36?'fading':'completed';
    const guideDetail=!guideEnabled?'自动睡前引导未开启':t<24?'正在播放睡前引导，进入深睡后淡出':t<36?'已进入深睡，引导音频 12 秒淡出':'已进入稳定睡眠，引导完成';
    const phase=locked?'sleep_lock':'pre_sleep';
    const outOfBed=sleepState==='out_of_bed';
    const voiceModes=[
      {mode:'wait',detail:'离线演示：等待唤醒词“嗨，小梦”'},
      {mode:'wake',detail:'离线演示：已检测到唤醒词'},
      {mode:'listen',detail:'离线演示：正在接收用户语音'},
      {mode:'think',detail:'离线演示：小梦正在思考回复'},
      {mode:'answer',detail:'离线演示：NX 本地千问正在回答'}
    ];
    const voiceState=selectedVoice==='auto'?voiceModes[Math.floor(t/5)%voiceModes.length]:voiceModes.find(item=>item.mode===selectedVoice);
    const suppressed=voiceState.mode==='listen'||voiceState.mode==='answer';
    const snoreWindow=Math.floor(t/7)%6===4;
    const snoreActive=snoreWindow&&!suppressed;
    const zoneBase=outOfBed?4:46+18*Math.sin(t/4);
    // A moving contact centre sampled by the actual 2 × 3 sensor arrangement.
    const contactX=.5+.24*Math.sin(t/8),contactY=.5+.18*Math.sin(t/11);
    const pressureZones=DGPressureField.positions.map(([x,y])=>outOfBed?0:clamp(95*Math.exp(-.5*(((x-contactX)/.22)**2+((y-contactY)/.28)**2)),0,100));
    const pressureContact=pressureZones.reduce((sum,value)=>sum+value,0)/(pressureZones.length*100);
    const bioHeart=outOfBed?null:66+demoStage.motion*22+2*Math.sin(t/4);
    const bioBreath=outOfBed?null:12.5+demoStage.motion*6+0.7*Math.sin(t/5);
    // Clearly labelled synthetic EEG for Windows layout review only.
    const eegSamples=Array.from({length:50},(_,index)=>{
      const seconds=t-0.5+index/100;
      const cortical=12*Math.sin(2*Math.PI*9.6*seconds+.35*Math.sin(seconds*.7))+6*Math.sin(2*Math.PI*5.4*seconds+1.1)+3*Math.sin(2*Math.PI*18.7*seconds+.4);
      const drift=3.5*Math.sin(2*Math.PI*.65*seconds);
      const deterministicNoise=2.4*Math.sin(2*Math.PI*31.3*seconds+Math.sin(seconds*13.7))+1.3*Math.sin(2*Math.PI*43.1*seconds+.8);
      return cortical+drift+deterministicNoise;
    });
    const alpha=0.37+0.08*Math.sin(t/9),theta=0.24-0.04*Math.sin(t/9),delta=0.21,beta=0.13,gamma=1-alpha-theta-delta-beta;
    return {
      sample:{timestamp:new Date().toISOString(),unix_time:now,connected:true,presence:!outOfBed,range_cm:outOfBed?null:42.3,
        bio_valid:!outOfBed,heart_bpm:bioHeart,breath_bpm:bioBreath,motion:locked?demoStage.motion:0.16,
        stability:locked?0.91:0.72,csi_stability:locked?0.89:0.7,sleep_state:sleepState,sleep_score:locked?86:58,
        wake_risk:wakeRisk,stable_sleep_index:locked?clamp(100-wakeRisk,0,100):48,sleep_reason:locked?demoStage.reason:'正在观察入睡趋势',
        sleep_locked:locked,assist_active:true,assist_state:assistState,guard_mode:locked?'deep_sleep_guard':'sleep_assist',
        risk_level:outOfBed?'out_of_bed':wakeRisk>=75?'high':wakeRisk>=55?'restless':wakeRisk>=35?'minor':'stable',
        intervention_action:intervention,intervention_active:intervention!=='none',
        audio_session_owner:intervention!=='none'&&intervention!=='night_path'?'SLEEP_AUDIO':'NONE',audio_output_enabled:intervention!=='none'&&intervention!=='night_path',
        audio_volume_percent:intervention!=='none'&&intervention!=='night_path'?18:0,device_action:intervention!=='none'?`mid_sleep.${intervention}`:`sleep_assist.${assistState}`},
      model:{ready:true,label:locked?demoStage.label:(wakeRisk>=55?'unstable':'stable'),confidence:0.88,
        scores:{arousal_risk:wakeRisk/100,breath_phase_amplitude:0.27},model_version:'rf:arousal_base_rf.joblib',
        reason:'Windows 离线模拟推理结果',window_start:new Date((now-30)*1000).toISOString(),window_end:new Date(now*1000).toISOString()},
      voice_state:voiceState,voice_event:{source:'offline_demo',intent:voiceState.mode==='listen'?'查询当前睡眠状态':'状态自动轮播',action:intervention},
      pillow:{received_at:now,pressure_contact:pressureContact,pressure_change:Math.abs(Math.sin(t/3))*0.12,imu_motion:outOfBed?0:demoStage.motion,temperature_c:26.4+0.3*Math.sin(t/20),
        humidity_pct:48.2+1.2*Math.sin(t/18),pressure_zones:pressureZones},
      esp:{device_id:'pillow-esp-offline',seq:Math.floor(t*2),uptime_ms:Math.floor(t*1000),received_at:now,source_ip:'离线模拟',age_ms:0,stale:false,
        eeg:{sample_rate_hz:100,raw_samples:eegSamples,unit:'uV',signal_quality:93,contact:true,bands:{delta,theta,alpha,beta,gamma}},
        metrics:{vibration_enabled:0,vibration_level_pct:0,electrode_ble_connected:1,electrode_enabled:0,electrode_intensity_level:0,eeg_scale_uv_per_count:0.488}},
      snore:{ready:true,active:snoreActive,raw_probability:snoreActive?0.91:0.08,dbfs:snoreActive?-31.8:-46.3,dominant_class:snoreActive?'Snore':'Breathing',event_count:2+Math.floor(t/42),
        suppressed_by_voice:suppressed,last_event:snoreActive?{path:'offline/demo-snore.wav',duration_sec:2.4}:null},
      sleep_guide:{enabled:guideEnabled,mode:guideMode,detail:guideDetail,pid:null,controls_dg:false,fade_seconds:12,
        timer:{running:true,started_unix:openedAt-120,ended_unix:null,elapsed_sec:Math.round(t+120),phase}}
    };
  }

  const device={online:true,brightness:45,volume:18,playing:true,scene_id:'rain',scene_name:'雨声',muted:false};
  const scenes=[{id:'rain',name:'雨声'},{id:'forest',name:'森林'},{id:'pink_noise',name:'粉红噪声'}];
  const history=[],events=[];
  let seq=0,lastAction='';
  function snapshot(){
    const data=rawSnapshot(),s=data.sample,p=data.pillow;
    Object.assign(s,{seq:++seq,csi_motion:s.motion,radar_phase_valid:s.presence,
      snore_events:data.snore.event_count,snore_active:data.snore.active,
      pillow_pressure_delta:p.pressure_change,temperature_c:p.temperature_c,humidity_percent:p.humidity_pct,
      pressure_matrix:[p.pressure_zones.slice(0,3),p.pressure_zones.slice(3,6)],
      turn_count:Math.floor((s.unix_time-openedAt)/12),skin_conductance:3.1+.2*Math.sin(s.unix_time/8)});
    data.esp.seq=seq;data.esp.uptime_ms=Math.floor((Date.now()/1000-openedAt)*1000);
    data.device_state={...device};data.missing_fields=[];
    history.push({...s});if(history.length>1800)history.shift();
    if(s.device_action!==lastAction){lastAction=s.device_action;events.unshift({id:'demo-'+seq,timestamp:s.timestamp,type:'offline_demo',source:'offline_demo',message:s.sleep_reason,action:s.device_action,reason:s.sleep_reason,sample:{...s}});if(events.length>80)events.pop();}
    return data;
  }
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  window.fetch=async(input,options={})=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href),route=url.pathname;
    if(!route.startsWith('/api/')&&route!=='/health')return nativeFetch(input,options);
    const method=String(options.method||'GET').toUpperCase();
    let body={};try{body=JSON.parse(options.body||'{}');}catch{return reply({detail:'invalid_json'},400);}
    if(route==='/api/live')return reply(snapshot());
    if(route==='/api/sleep-guide/auto'){
      if(method==='POST')guideEnabled=body.enabled===true;
      return reply(rawSnapshot().sleep_guide);
    }
    if(route==='/api/history'){
      const since=Date.now()/1000-Number(url.searchParams.get('minutes')||480)*60;
      return reply(history.filter(s=>s.unix_time>=since));
    }
    if(route==='/api/events')return reply(events);
    if(route==='/api/sleep/sessions')return reply([86,79,91,75,83,88,72].map((score,index)=>{
      const day=new Date();day.setDate(day.getDate()-index);
      const date=day.getFullYear()+'-'+String(day.getMonth()+1).padStart(2,'0')+'-'+String(day.getDate()).padStart(2,'0');
      return {session_id:index===0?'offline-current':'offline-night-'+index,label:date+' · 模拟睡眠',date,sleep_score:score,score};
    }));
    if(route.startsWith('/api/sleep/reports/')){
      const id=decodeURIComponent(route.split('/').pop()),match=/^offline-night-([1-6])$/.exec(id),index=id==='offline-current'?0:match?Number(match[1]):-1;
      if(index<0)return reply({error:'记录不存在'},404);
      const end=new Date();end.setDate(end.getDate()-index);end.setHours(7,0,0,0);const finish=end.getTime()/1000,start=finish-8*3600;
      const samples=Array.from({length:481},(_,i)=>{const phase=(i+index*7)%90;return {unix_time:start+i*60,timestamp:new Date((start+i*60)*1000).toISOString(),connected:true,presence:true,sleep_state:phase<8?'awake':phase<48?'light_trend':'deep_trend',heart_bpm:60+5*Math.sin(i/13+index),breath_bpm:14+Math.sin(i/17),motion:phase<8?.3:.04,wake_risk:phase<8?65:18,temperature_c:25.3+.4*Math.sin(i/80),humidity_percent:48}});
      const archivedEvents=[65,143,269,371].map((offset,i)=>({timestamp:samples[offset].timestamp,type:i%2?'intervention':'turn',title:i%2?'睡眠干预':'检测到翻身',intervention:i%2?'mid_sleep_test_restless':null,metrics:samples[offset]}));
      return reply({score:[86,79,91,75,83,88,72][index],history:samples,events:archivedEvents,timer:{running:false,started_unix:start,ended_unix:finish,session_id:id},assessment:'离线模拟睡眠记录，仅用于演示历史时间轴与交互，不是真实睡眠评估。',suggestions:['点击时间轴事件查看当时的数据与干预措施。'],missing_fields:[]});
    }
    if(route==='/health')return reply({status:'ok',uptime_sec:Date.now()/1000-openedAt,dreamguardian:{connected:true,base_url:'离线模拟设备',ip:'模拟'},qwen:{ready:true,model:'离线规则回复（非真实 Qwen）'},model:{ready:true,reason:'离线模拟推理'},database:{ready:true},auto_action_enabled:true,last_error:null});
    if(route==='/api/nx/telemetry')return reply({seq,device_uptime_sec:Date.now()/1000-openedAt,radar_phase_age_ms:12,csi_packets:seq*40,data_latency_ms:18,nx:{cpu_percent:28+4*Math.sin(seq/9),gpu_percent:19,ram_percent:42,temperature_c:46}});
    if(route==='/api/ai/capabilities')return reply({ready:true});
    if(route==='/api/ai/query'){
      const s=rawSnapshot().sample;
      const question=String(body.question||'');
      let answer='当前模拟状态：'+s.sleep_reason+'。\n你可以继续观察，也可以打开睡眠时间轴查看变化。';
      if(/风险/.test(question))answer='模拟模型给出的苏醒风险为 '+s.wake_risk.toFixed(0)+'%。这是演示指标，不是诊断结果。\n当前情境：'+s.sleep_reason+'。';
      else if(/缺失/.test(question))answer='此演示样本已提供心率、呼吸、体动和环境等字段，没有报告缺失项。真实设备连接后，缺失或过期的数据会明确标注。';
      else if(/状态|分析/.test(question))answer='我看到了这几项模拟数据：\n'+(s.heart_bpm==null?'当前离床，心率与呼吸不可用。':'心率 '+s.heart_bpm.toFixed(0)+' 次/分，呼吸 '+s.breath_bpm.toFixed(1)+' 次/分。')+'\n'+s.sleep_reason+'。\n这些数据来自离线演示，未调用真实模型。';
      else answer='我收到了你的问题：“'+question.slice(0,160)+'”。\n离线演示可以体验状态分析、灯光调暗、音量降低、暂停声音和睡前陪伴。开放式问答需要连接本地模型。';
      return reply({answer,missing_fields:[],data_source:'本次离线模拟 · 规则回复'});
    }
    if(route==='/api/control/state')return reply({online:true,device_state:{...device},scenes,robot_state:{online:true,busy:false}});
    if(route==='/api/control'&&method==='POST'){
      const {action,value}=body;
      if(action.startsWith('robot_')&&rawSnapshot().sample.sleep_locked)return reply({status:'error',message:'模拟安全锁：熟睡时禁止机械臂工作'},409);
      if(action==='set_brightness')device.brightness=clamp(Number(value)||0,0,100);
      else if(action==='set_volume')device.volume=clamp(Number(value)||0,0,100);
      else if(action==='set_light_power')device.brightness=value?45:0;
      else if(action==='set_mute')device.muted=!!value;
      else if(action==='set_scene'){const scene=scenes.find(s=>s.id===value);if(!scene)return reply({message:'未知场景'},400);device.scene_id=scene.id;device.scene_name=scene.name;}
      else if(['play','pause','stop'].includes(action))device.playing=action==='play';
      else if(!['robot_fetch_water','robot_fetch_item','robot_return_home'].includes(action))return reply({message:'未知模拟指令'},400);
      return reply({request_id:body.request_id,status:'success',device_state:{...device},message:'离线模拟回执 · 未发送真实设备命令'});
    }
    return reply({detail:'offline_demo_not_found'},404);
  };
  window.WebSocket=class OfflineWebSocket{
    static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
    constructor(){this.readyState=0;this.openTimer=setTimeout(()=>{if(this.readyState!==0)return;this.readyState=1;this.onopen?.({});this.timer=setInterval(()=>this.onmessage?.({data:JSON.stringify(snapshot())}),500);},20);}
    close(){clearTimeout(this.openTimer);clearInterval(this.timer);this.readyState=3;this.onclose?.({});}
    send(){}
  };
})();
