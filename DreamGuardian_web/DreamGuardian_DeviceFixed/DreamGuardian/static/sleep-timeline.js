/* Time-proportional sleep blocks with event inspection and anchored zoom. */
(function(root){
  const stages={awake:['清醒',0,'#efa96c'],light:['浅睡',1,'#c667df'],deep:['深睡',2,'#8054dd'],away:['离床',0,'#68798f'],assist:['入睡过渡',0,'#648fab'],unstable:['不稳定',0,'#b78a79'],unknown:['未知 / 缺失',0,'#3c5368']};
  const kinds={turn:['翻身','#f6c76d'],intervention:['睡眠干预','#66e3cd'],snore:['鼾声','#ef91b4'],leave_bed:['离床','#a5b5ce'],return_bed:['回床','#72baf0']};
  function describeEvent(event){
    const actions=[
      [['mid_sleep_test_minor','mid_sleep.pink_noise','pink_noise'],'轻微扰动','播放 12% 音量的粉红噪声，不开启灯光'],
      [['mid_sleep_test_restless','mid_sleep.stereo_breathing','stereo_breathing'],'频繁翻身','播放 16% 音量的立体声呼吸引导，并开启低亮暖光'],
      [['mid_sleep_test_arousal','mid_sleep.reduce_arousal','reduce_arousal'],'高苏醒风险','播放 10% 音量的低刺激安抚声，并开启更弱的暖光'],
      [['mid_sleep_test_out_of_bed','mid_sleep.night_path','night_path'],'起夜离床','立即关闭声音，路径灯逐渐调亮']
    ];
    const values=[event.intervention,event.command,event.title,event.trigger].filter(x=>typeof x==='string');
    const match=actions.find(([codes])=>codes.some(code=>values.some(value=>value.split(/[^a-zA-Z0-9_.]+/).includes(code))));
    if(match)return {...event,title:'睡眠干预 · '+match[1],trigger:match[1],intervention:match[2]};
    const reasons={turn:'检测到翻身动作',snore:'检测到鼾声',leave_bed:'检测到用户离床',return_bed:'检测到用户回到床上',sleep_stage:'检测到睡眠阶段变化'};
    const clean=value=>typeof value==='string'&&/[\u4e00-\u9fff]/.test(value)&&!/(字段|回执|NX|MEMS|snore_active)/.test(value)?value:'';
    return {...event,title:clean(event.title)||({intervention:'睡眠干预',turn:'翻身',snore:'鼾声',leave_bed:'离床',return_bed:'回床',sleep_stage:'睡眠阶段变化'}[event.type]||'睡眠事件'),trigger:reasons[event.type]||clean(event.trigger),intervention:clean(event.intervention),recovery:clean(event.recovery)};
  }
  function timestamp(value){if(value==null||value==='')return NaN;if(typeof value==='number')return value<1e12?value*1000:value;return Date.parse(value)}
  function model(history,key){
    const rows=history.map(item=>({item,t:timestamp(item.timestamp??item.unix_time)})).filter(p=>Number.isFinite(p.t)).sort((a,b)=>a.t-b.t);
    const diffs=rows.slice(1).map((r,i)=>r.t-rows[i].t).filter(d=>d>0).sort((a,b)=>a-b);
    const cadence=diffs.length?diffs[Math.floor(diffs.length/2)]:1000,segments=[];
    rows.forEach((row,i)=>{
      const next=rows[i+1]?.t??row.t+cadence;if(next<=row.t)return;
      const end=Math.min(next,row.t+cadence*3),stage=row.item.connected===false?'unknown':key(row.item);
      const prev=segments.at(-1);if(prev&&prev.key===stage&&prev.end===row.t)prev.end=end;else segments.push({start:row.t,end,key:stage});
      if(end<next)segments.push({start:end,end:next,key:'unknown'});
    });
    return {segments,start:rows[0]?.t??0,end:segments.at(-1)?.end??0};
  }
  function create({canvas,onEvent,key}){
    const ctx=canvas.getContext('2d'),out=document.getElementById('timeline-inspect'),picker=document.getElementById('timeline-picker');
    let data={segments:[],start:0,end:0},events=[],zoom=1,offset=0,hits=[],drag=null,pointers=new Map(),pinch=null,selectedEvent=null;
    const dialog=document.createElement('dialog');dialog.className='timeline-event-dialog';dialog.setAttribute('aria-label','时间轴事件详情');document.body.append(dialog);
    function showEvent(item,group){
      selectedEvent=item;draw();
      onEvent(item.event);dialog.replaceChildren();
      const header=document.createElement('div');header.className='timeline-event-header';
      const title=document.createElement('h2');title.textContent=(kinds[item.kind]||['事件'])[0];title.style.color=(kinds[item.kind]||['事件','#72baf0'])[1];
      const close=document.createElement('button');close.type='button';close.textContent='关闭';close.onclick=()=>dialog.close();header.append(title,close);dialog.append(header);
      const time=document.createElement('p');time.textContent=new Date(item.t).toLocaleString('zh-CN',{hour12:false});dialog.append(time);
      const detail=document.createElement('h3');detail.textContent=item.event.title||'事件';dialog.append(detail);
      for(const [label,value] of [['发生原因',item.event.trigger],['干预措施',item.event.intervention],['恢复情况',item.event.recovery]]){
        if(!value||value==='--')continue;const p=document.createElement('p');p.textContent=label+'：'+value;dialog.append(p);
      }
      const metrics=item.event.metrics||{},grid=document.createElement('div');grid.className='assessment-stats event-vitals';
      for(const [label,value,unit,digits] of [['心率',metrics.heart_bpm,' bpm',1],['呼吸',metrics.breath_bpm,' 次/分',1],['体动',metrics.motion??metrics.csi_motion,'',3],['苏醒风险',metrics.wake_risk,'',2],['温度',metrics.temperature_c,' °C',1],['湿度',metrics.humidity_percent??metrics.humidity_pct,' %',1]]){
        const cell=document.createElement('div'),name=document.createElement('span'),number=document.createElement('strong');name.textContent=label;number.textContent=value!=null&&value!==''&&Number.isFinite(Number(value))?Number(value).toFixed(digits)+unit:'--';cell.append(name,number);grid.append(cell);
      }dialog.append(grid);
      if(group.length>1){const label=document.createElement('p');label.textContent='此处共有 '+group.length+' 条事件，可切换查看：';dialog.append(label);
        const list=document.createElement('div');list.className='timeline-event-options';
        group.forEach(other=>{const button=document.createElement('button');button.type='button';button.textContent=clock(other.t)+' · '+kinds[other.kind][0];button.setAttribute('aria-pressed',String(other===item));button.onclick=()=>showEvent(other,group);list.append(button)});dialog.append(list);
      }
      if(!dialog.open)dialog.showModal();
    }
    function range(){const total=Math.max(1,data.end-data.start),span=total/zoom;offset=Math.max(0,Math.min(offset,total-span));return {start:data.start+offset,end:data.start+offset+span,span,total}}

    const clock=t=>new Date(t).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
    function draw(){
      if(!canvas.clientWidth||!canvas.clientHeight)return;
      const dpr=Math.min(window.devicePixelRatio||1,2)*(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--display-scale"))||1),w=canvas.clientWidth,h=canvas.clientHeight;
      canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);hits=[];
      const r=range(),left=62,right=16,top=10,bottom=Math.min(65,h*.38),pw=w-left-right,ph=h-top-bottom,lane=ph/3;

      document.getElementById('timeline-start').textContent=data.segments.length?clock(r.start):'--';
      document.getElementById('timeline-end').textContent=data.segments.length?clock(r.end):'--';
      ctx.font='12px sans-serif';ctx.fillStyle='#9cb7ca';
      if(!data.segments.length){ctx.textAlign='center';ctx.fillText('暂无已结束的睡眠阶段记录',w/2,h/2);return}
      const x=t=>left+(t-r.start)/r.span*pw;
      ['awake','light','deep'].forEach(k=>{const row=stages[k],y=top+(row[1]+.5)*lane;ctx.textAlign='left';ctx.fillStyle=row[2];ctx.fillText(row[0],5,y+4);ctx.strokeStyle='rgba(153,183,211,.1)';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke()});
      ctx.save();ctx.beginPath();ctx.rect(left,top,pw,ph);ctx.clip();
      data.segments.forEach((s,index)=>{
        if(s.end<r.start||s.start>r.end)return;
        const stage=stages[s.key]||stages.unknown,a=Math.max(left,x(s.start)),b=Math.min(w-right,x(s.end)),bh=Math.max(8,lane*.64),y=top+(stage[1]+.5)*lane-bh/2;
        const prev=data.segments[index-1];
        if(prev&&prev.end===s.start&&s.start>=r.start&&prev.key!=='unknown'&&s.key!=='unknown'){
          const before=stages[prev.key]||stages.unknown;ctx.strokeStyle=stage[2];ctx.globalAlpha=.4;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x(s.start),top+(before[1]+.5)*lane);ctx.lineTo(x(s.start),top+(stage[1]+.5)*lane);ctx.stroke();
        }
        ctx.fillStyle=stage[2];ctx.globalAlpha=s.key==='unknown'?.4:.92;ctx.beginPath();ctx.roundRect(a,y,Math.max(.5,b-a),bh,Math.min(7,(b-a)/2));ctx.fill();ctx.globalAlpha=1;
        hits.push({x:a,y,width:Math.max(1,b-a),height:bh,segment:s});
      });
      ctx.restore();
      // A separate event lane keeps the sleep stages readable and hit targets local.
      const eventY=h-30,groups=[];
      ctx.fillStyle='rgba(30,61,78,.35)';ctx.beginPath();ctx.roundRect(left-4,eventY-18,pw+8,36,9);ctx.fill();
      ctx.strokeStyle='rgba(137,185,203,.18)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,eventY);ctx.lineTo(w-right,eventY);ctx.stroke();
      ctx.font='11px sans-serif';ctx.fillStyle='#8eacbd';ctx.textAlign='left';ctx.fillText('事件',5,eventY+4);
      events.filter(e=>e.t>=r.start&&e.t<=r.end).forEach(e=>{
        const px=Math.max(left+12,Math.min(w-right-12,x(e.t))),last=groups.at(-1);
        if(last&&px-last.x<30)last.events.push(e);else groups.push({x:px,events:[e]});
      });
      groups.forEach(g=>{
        const colors=[...new Set(g.events.map(e=>kinds[e.kind][1]))],multiple=g.events.length>1,radius=multiple?11:6;
        ctx.fillStyle='#102a3c';ctx.beginPath();ctx.arc(g.x,eventY,radius+3,0,Math.PI*2);ctx.fill();
        if(multiple){
          ctx.fillStyle='#193c50';ctx.beginPath();ctx.arc(g.x,eventY,radius,0,Math.PI*2);ctx.fill();
          colors.forEach((color,i)=>{const gap=colors.length>1?.12:0;ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(g.x,eventY,radius,-Math.PI/2+i*Math.PI*2/colors.length+gap,-Math.PI/2+(i+1)*Math.PI*2/colors.length-gap);ctx.stroke()});
          ctx.fillStyle='#e5f3f8';ctx.font='600 11px sans-serif';ctx.textAlign='center';ctx.fillText(g.events.length>99?'99+':String(g.events.length),g.x,eventY+4);
        }else{
          ctx.fillStyle=colors[0];ctx.beginPath();ctx.arc(g.x,eventY,radius,0,Math.PI*2);ctx.fill();
          ctx.fillStyle='#ffffff88';ctx.beginPath();ctx.arc(g.x-1,eventY-1,2,0,Math.PI*2);ctx.fill();
        }
        hits.push({x:g.x-15,y:eventY-18,width:30,height:36,events:g.events,center:g.x});
      });
      if(!groups.length){ctx.fillStyle='#7896a8';ctx.font='11px sans-serif';ctx.textAlign='center';ctx.fillText('当前时段暂无事件',left+pw/2,eventY+4)}
      if(selectedEvent&&selectedEvent.t>=r.start&&selectedEvent.t<=r.end){
        const selectedX=x(selectedEvent.t),color=(kinds[selectedEvent.kind]||['事件','#a8dfe8'])[1];
        const group=groups.find(g=>g.events.some(e=>e.t===selectedEvent.t&&e.kind===selectedEvent.kind));
        ctx.save();ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.globalAlpha=.85;ctx.setLineDash([4,5]);
        ctx.beginPath();ctx.moveTo(selectedX,top);ctx.lineTo(selectedX,eventY-16);ctx.stroke();ctx.setLineDash([]);
        if(group){
          ctx.beginPath();ctx.moveTo(selectedX,eventY-16);ctx.lineTo(group.x,eventY-13);ctx.stroke();
          ctx.globalAlpha=1;ctx.lineWidth=2;ctx.beginPath();ctx.arc(group.x,eventY,15,0,Math.PI*2);ctx.stroke();
        }
        ctx.fillStyle=color;ctx.beginPath();ctx.arc(selectedX,top,3,0,Math.PI*2);ctx.fill();ctx.restore();
      }
      ctx.font='10px sans-serif';ctx.fillStyle='#89a5b9';
      for(let i=0;i<=4;i++){ctx.textAlign=i===0?'left':i===4?'right':'center';ctx.fillText(clock(r.start+r.span*i/4),left+pw*i/4,h-7)}
      canvas.setAttribute('aria-label','睡眠阶段时间轴，'+clock(r.start)+'至'+clock(r.end)+'，'+zoom.toFixed(1)+'倍；事件可通过下方列表查看');
    }
    function inspect(e){
      const rect=canvas.getBoundingClientRect(),x=(e.clientX-rect.left)*canvas.clientWidth/rect.width,y=(e.clientY-rect.top)*canvas.clientHeight/rect.height;
      const candidates=hits.filter(p=>x>=p.x&&x<=p.x+p.width&&y>=p.y&&y<=p.y+p.height);
      const hit=candidates.filter(p=>p.events).sort((a,b)=>Math.abs(a.center-x)-Math.abs(b.center-x))[0]||candidates.at(-1);picker.replaceChildren();
      if(!hit)return;
      if(hit.events){out.textContent=hit.events.length+' 条事件 · 在详情中切换查看';showEvent(hit.events[0],hit.events)}
      else{const s=hit.segment;out.textContent=(stages[s.key]||stages.unknown)[0]+' · '+clock(s.start)+'—'+clock(s.end)+' · '+Math.round((s.end-s.start)/1000)+' 秒'}
    }
    canvas.addEventListener('click',inspect);
    new ResizeObserver(draw).observe(canvas);
    return {update(history,allEvents,bounds){
      zoom=1;offset=0;const next=model(history,key);
      const start=timestamp(bounds?.started_unix),end=timestamp(bounds?.ended_unix);
      if(Number.isFinite(start)&&Number.isFinite(end)&&end>start){
        next.segments=next.segments.filter(s=>s.end>start&&s.start<end).map(s=>({...s,start:Math.max(start,s.start),end:Math.min(end,s.end)}));
        if(next.segments.length){
          if(next.segments[0].start>start)next.segments.unshift({start,end:next.segments[0].start,key:'unknown'});
          if(next.segments.at(-1).end<end)next.segments.push({start:next.segments.at(-1).end,end,key:'unknown'});
        }
        next.start=start;next.end=end;
      }
      if(next.start!==data.start){selectedEvent=null}data=next;
      const seen=new Set();events=allEvents.map(event=>({event,kind:event.type,t:timestamp(event.timestamp)})).filter(e=>{const id=e.kind+':'+e.t;if(!kinds[e.kind]||!Number.isFinite(e.t)||seen.has(id))return false;seen.add(id);return true}).sort((a,b)=>a.t-b.t);draw();
    },draw,openEvent(event){showEvent({event,kind:event.type,t:timestamp(event.timestamp)},[])}};
  }
  root.DGSleepTimeline={create,model,timestamp,describeEvent};if(typeof module!=='undefined')module.exports=root.DGSleepTimeline;
})(typeof window!=='undefined'?window:globalThis);
