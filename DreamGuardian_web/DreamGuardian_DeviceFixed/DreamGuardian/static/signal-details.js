/* Separate views reuse the same rolling samples as the dashboard. */
(function(root){
 let source=null,context=null,loop=null;
 const dialog=document.createElement('dialog');dialog.id='signal-details';dialog.className='signal-details';dialog.setAttribute('aria-labelledby','signal-details-title');
 dialog.innerHTML='<header><div><h2 id="signal-details-title">实时趋势 · 查看详情</h2><p>近 30 秒 · 各图独立刻度</p></div><button type="button" id="signal-details-close">关闭</button></header><div class="signal-detail-grid"></div>';
 document.body.append(dialog);
 const signals=[['heart','心率','BPM','#ff938a',6,1],['breath','呼吸','次/分','#77efff',2,1],['motion','体动','强度','#ffda78',.05,3]];
 signals.forEach(([key,name,unit])=>{const card=document.createElement('figure');card.innerHTML='<figcaption><span>'+name+' <small>'+unit+'</small></span><strong id="split-'+key+'-value">--</strong></figcaption><canvas id="split-'+key+'" aria-label="最近30秒'+name+'独立趋势图"></canvas>';dialog.querySelector('.signal-detail-grid').append(card)});
 function draw(){if(!dialog.open||!source)return;const {start,end}=source.range();
  signals.forEach(([key,name,unit,color,minSpan,digits])=>{
   const target=context('split-'+key);if(!target)return;const{ctx,width,height}=target;
   const points=source.points(key),visible=points.filter(p=>p.t>=start&&p.t<=end),valid=visible.filter(p=>Number.isFinite(p.value));
   const values=valid.map(p=>p.value);let min=0,max=minSpan;
   if(values.length){const low=Math.min(...values),high=Math.max(...values),span=Math.max(high-low,minSpan);min=Math.max(0,(high+low-span)/2-span*.1);max=Math.max(min+minSpan,(high+low+span)/2+span*.1)}
   const l=55,t=8,w=Math.max(1,width-l-14),h=Math.max(1,height-t-23),x=p=>l+(p.t-start)/(end-start)*w,y=p=>t+(max-p.value)/(max-min)*h;
   ctx.clearRect(0,0,width,height);ctx.font='11px sans-serif';ctx.lineWidth=1;
   for(let i=0;i<=2;i++){const yy=t+h*i/2;ctx.strokeStyle='#9cb7ca22';ctx.beginPath();ctx.moveTo(l,yy);ctx.lineTo(l+w,yy);ctx.stroke();ctx.fillStyle='#9cb7ca';ctx.textAlign='right';ctx.fillText((max-(max-min)*i/2).toFixed(digits),l-7,yy+4)}
   for(let i=0;i<=3;i++){ctx.textAlign=i===0?'left':i===3?'right':'center';ctx.fillText(i===3?'现在':String(-30+i*10)+'s',l+w*i/3,height-4)}
   ctx.save();ctx.beginPath();ctx.rect(l,t,w,h);ctx.clip();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();let pen=false;
   for(const p of visible){if(!Number.isFinite(p.value)){pen=false;continue}if(pen)ctx.lineTo(x(p),y(p));else ctx.moveTo(x(p),y(p));pen=true}ctx.stroke();
   if(valid.length===1){ctx.fillStyle=color;ctx.beginPath();ctx.arc(x(valid[0]),y(valid[0]),2,0,Math.PI*2);ctx.fill()}ctx.restore();
   if(!valid.length){ctx.textAlign='center';ctx.fillStyle='#9cb7ca';ctx.fillText('等待有效数据',l+w/2,t+h/2)}
   const last=points.at(-1);document.getElementById('split-'+key+'-value').textContent=Number.isFinite(last?.value)?last.value.toFixed(digits):'--';
  });
 }
 document.getElementById('signal-details-close').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{clearInterval(loop);loop=null;document.getElementById('signal-details-open').focus()});
 root.DGSignalDetails={init(waveform,canvasContext){source=waveform;context=canvasContext;document.getElementById('signal-details-open').onclick=()=>{if(!dialog.open)dialog.showModal();draw();clearInterval(loop);loop=setInterval(draw,200)};new ResizeObserver(draw).observe(dialog)}};
})(window);
