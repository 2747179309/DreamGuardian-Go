/* Shared by production and offline pages; only the mock emits demo states. */
(()=>{
  const names={wait:'安静待机',wake:'挥手招呼',listen:'侧耳倾听',think:'专注思考',answer:'温柔回应'};
  const images=Array.from(document.querySelectorAll('img.xiaomeng, .ai-intro img'));
  const cache=Object.keys(names).map(mode=>{const img=new Image();img.src='/static/xiaomeng/'+mode+'.png?v=transparent-1';return img;});
  window.DGXiaomeng={render(mode){
    if(!Object.hasOwn(names,mode))mode='wait';
    images.forEach(img=>{
      if(img.dataset.pose===mode)return;
      img.dataset.pose=mode;img.src='/static/xiaomeng/'+mode+'.png?v=transparent-1';
      img.alt='小梦 · '+names[mode];
    });
    document.querySelectorAll('.avatar-stage').forEach(stage=>stage.dataset.mode=mode);
  }};
  window.DGXiaomeng.render('wait');
  if(document.body.dataset.offline!=='true')return;
  const host=document.querySelector('#monitor-avatar-stage');
  if(!host)return;
  const control=document.createElement('label');control.className='xiaomeng-demo-control';
  const title=document.createElement('span');title.textContent='形象演示';
  const select=document.createElement('select');select.setAttribute('aria-label','小梦离线交互状态');
  Object.entries({auto:'自动轮播',...names}).forEach(([value,label])=>{
    const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);
  });
  select.addEventListener('change',()=>window.dispatchEvent(new CustomEvent('xiaomeng-demo-mode',{detail:select.value})));
  control.append(title,select);host.after(control);
})();
