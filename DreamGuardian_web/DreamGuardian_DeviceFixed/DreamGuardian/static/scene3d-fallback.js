/* Lightweight Jetson/Firefox digital-twin renderer. Keeps the full GLB path
   available for hardware-WebGL browsers while avoiding an endless loader. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),stage=$('twin-canvas');if(!stage)return;
const loading=$('twin-loading'),status=$('twin-status'),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
canvas.setAttribute('aria-label','卧室数字孪生兼容视图，可点击枕头、人体和床头灯');canvas.tabIndex=0;stage.prepend(canvas);
let selected='room',latest=window.__dreamguardianLatest||null,angle=-.08,drag=null;
const hit={pillow:{x:.32,y:.43,w:.18,h:.12},person:{x:.43,y:.45,w:.30,h:.18},lamp:{x:.76,y:.32,w:.15,h:.35}};
function size(){const d=Math.min(devicePixelRatio||1,1.5),w=Math.max(stage.clientWidth,1),h=Math.max(stage.clientHeight,1);if(canvas.width!==w*d||canvas.height!==h*d){canvas.width=w*d;canvas.height=h*d;canvas.style.width=w+'px';canvas.style.height=h+'px';ctx.setTransform(d,0,0,d,0,0)}return{w,h}}
function poly(points,fill,stroke='#477486'){ctx.beginPath();points.forEach((p,i)=>(i?ctx.lineTo(...p):ctx.moveTo(...p)));ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=1.2;ctx.stroke()}
function round(x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke()}}
function draw(){const {w,h}=size(),sx=w/900,sy=h/540;ctx.clearRect(0,0,w,h);ctx.save();ctx.scale(sx,sy);ctx.translate(angle*55,0);
  const glow=ctx.createRadialGradient(450,260,20,450,260,470);glow.addColorStop(0,'#204d5c');glow.addColorStop(1,'#071620');ctx.fillStyle=glow;ctx.fillRect(-80,0,1060,540);
  poly([[90,105],[510,35],[828,126],[416,213]],'#173746');poly([[90,105],[416,213],[416,482],[90,385]],'#102a37');poly([[416,213],[828,126],[828,390],[416,482]],'#0c2330');
  poly([[90,385],[416,482],[828,390],[416,302]],'#143544','#315c6b');
  // rug and bed frame
  poly([[175,365],[425,438],[700,374],[452,314]],'#1a6670','#42a6aa');poly([[252,290],[468,350],[696,297],[480,240]],'#594b45','#806c61');
  poly([[252,290],[468,350],[468,408],[252,347]],'#3d3432');poly([[468,350],[696,297],[696,354],[468,408]],'#302a29');
  // mattress and duvet
  poly([[264,267],[470,323],[681,278],[478,225]],'#d7d5cd','#eae6dd');poly([[333,290],[478,329],[646,292],[501,253]],selected==='person'?'#8acbd2':'#6f9da8','#b8e4e7');
  // pillows
  round(302,250,105,45,18,selected==='pillow'?'#67e8ef':'#c7d4d5',selected==='pillow'?'#fff':'#dce7e8');
  // sleeping person
  ctx.save();ctx.translate(478,287);ctx.rotate(-.24);ctx.fillStyle='#efc3ad';ctx.beginPath();ctx.arc(-66,-13,19,0,Math.PI*2);ctx.fill();round(-49,-27,142,43,21,selected==='person'?'#68d7e1':'#294f68',selected==='person'?'#d7ffff':null);ctx.restore();
  // night stand + lamp
  poly([[700,292],[761,307],[818,292],[756,278]],'#6c5040');poly([[700,292],[761,307],[761,367],[700,351]],'#49372e');poly([[761,307],[818,292],[818,350],[761,367]],'#392d29');
  ctx.strokeStyle='#bda47f';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(759,282);ctx.lineTo(759,221);ctx.stroke();ctx.fillStyle=selected==='lamp'?'#ffe489':'#e8c783';ctx.shadowColor='#ffd36a';ctx.shadowBlur=selected==='lamp'?34:12;ctx.beginPath();ctx.moveTo(718,225);ctx.lineTo(800,225);ctx.lineTo(784,188);ctx.lineTo(736,188);ctx.closePath();ctx.fill();ctx.shadowBlur=0;
  // live pulse rings
  const sample=latest?.sample||{};if(sample.connected!==false&&sample.presence!==false){ctx.strokeStyle='#68edf488';ctx.lineWidth=2;for(let i=0;i<3;i++){ctx.beginPath();ctx.arc(472,284,60+i*13+(Date.now()/45)%13,0,Math.PI*2);ctx.stroke()}}
  ctx.restore();requestAnimationFrame(draw)}
function metric(i,label,value){const l=$('twin-metric-label-'+i),v=$('twin-metric-value-'+i);if(l)l.textContent=label;if(v)v.textContent=value}
function inspect(type){selected=type;const s=latest?.sample||{},p=latest?.pillow||{};document.querySelectorAll('[data-twin-focus]').forEach(b=>b.classList.toggle('active',b.dataset.twinFocus===type));
  if(type==='pillow'){$('twin-title').textContent='智能枕头';$('twin-description').textContent='显示六点枕压估算与头部运动数据。';metric(1,'压力接触',p.pressure_contact==null?'等待数据':Math.round(Number(p.pressure_contact)*(Number(p.pressure_contact)<=1?100:1))+'%');metric(2,'头部运动',p.imu_motion??'--')}
  else if(type==='person'){$('twin-title').textContent='睡眠用户';$('twin-description').textContent='毫米波雷达生命体征与睡眠状态映射。';metric(1,'心率',s.heart_bpm==null?'--':Number(s.heart_bpm).toFixed(1)+' BPM');metric(2,'呼吸率',s.breath_bpm==null?'--':Number(s.breath_bpm).toFixed(1)+' 次/分')}
  else if(type==='lamp'){$('twin-title').textContent='床头灯光';$('twin-description').textContent='灯光兼容预览；真实控制仍经过 NX 白名单。';metric(1,'灯光状态',s.intervention_action||'待机');metric(2,'控制方式','NX 安全白名单')}
  else{$('twin-title').textContent='卧室全景';$('twin-description').textContent='点击枕头、人体或床头灯查看实时状态。';metric(1,'实时数据',s.connected===true?'设备在线':'等待连接');metric(2,'交互对象','枕头 · 人体 · 灯光')}
  metric(0,'模型状态','兼容渲染已加载')}
canvas.addEventListener('pointerdown',e=>drag={x:e.clientX,a:angle});canvas.addEventListener('pointermove',e=>{if(drag)angle=Math.max(-.5,Math.min(.5,drag.a+(e.clientX-drag.x)/700))});canvas.addEventListener('pointerup',e=>{if(!drag)return;const moved=Math.abs(e.clientX-drag.x);drag=null;if(moved>8)return;const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;for(const [k,b] of Object.entries(hit))if(x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h){inspect(k);return}});canvas.addEventListener('pointerleave',()=>drag=null);
document.querySelectorAll('[data-twin-focus]').forEach(b=>b.addEventListener('click',()=>inspect(b.dataset.twinFocus)));
window.addEventListener('dreamguardian:telemetry',e=>{latest=e.detail||null;inspect(selected)});
loading.classList.add('ready');status.textContent='模型已连接 · NX兼容渲染';status.className='twin-status ready';inspect('room');requestAnimationFrame(draw);
})();
