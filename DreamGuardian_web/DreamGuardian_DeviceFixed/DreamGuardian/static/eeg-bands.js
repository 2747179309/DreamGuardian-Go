/* Causal bandpass display filters; waveforms never come from power values. */
(function(root){
  const bands=[['delta','δ Delta',.5,4,'#a885ff'],['theta','θ Theta',4,8,'#6b9cff'],['alpha','α Alpha',8,13,'#67e2f2'],['beta','β Beta',13,30,'#54d7a3'],['gamma','γ Gamma',30,45,'#f1c96d']];
  function biquad(rate,hz,highpass){
    const w=2*Math.PI*hz/rate,c=Math.cos(w),a=Math.sin(w)/Math.SQRT2,a0=1+a;
    const b0=(highpass?1+c:1-c)/2/a0,b1=(highpass?-(1+c):1-c)/a0,b2=b0,a1=-2*c/a0,a2=(1-a)/a0;
    let x1=0,x2=0,y1=0,y2=0;
    return x=>{const y=b0*x+b1*x1+b2*x2-a1*y1-a2*y2;x2=x1;x1=x;y2=y1;y1=y;return y};
  }
  function create(){
    let rate=0,unit='',device='',seq=null,lastAt=0,count=0,rows=[],filters=[];
    function reset(){count=0;rows=bands.map(()=>[]);filters=bands.map(b=>rate>0&&b[3]<rate/2?[biquad(rate,b[2],true),biquad(rate,b[3],false)]:null)}
    function push(esp,now=Date.now()){
      const eeg=esp?.eeg,r=Number(eeg?.sample_rate_hz),s=esp?.seq,values=eeg?.raw_samples;
      if(!eeg||esp.stale!==false||eeg.contact===false||!Array.isArray(values)||!values.length||!values.every(v=>typeof v==='number'&&Number.isFinite(v))||!(r>1&&r<=4000)){reset();seq=null;return}
      if(rate!==r||unit!==(eeg.unit||'未标定')||device!==esp.device_id){rate=r;unit=eeg.unit||'未标定';device=esp.device_id;seq=null;reset()}
      if(s!=null&&s===seq)return;
      if(s==null){reset()}else if(seq!=null&&(Number(s)!==Number(seq)+1||now-lastAt>Math.max(1500,values.length/r*2000))){reset()}
      seq=s;lastAt=now;
      for(const value of values){count++;filters.forEach((pair,i)=>{if(!pair)return;const filtered=pair[1](pair[0](value));if(count>rate*4)rows[i].push(filtered)})}
      rows.forEach(row=>{if(row.length>rate*6)row.splice(0,row.length-Math.round(rate*6))});
    }
    return {push,snapshot:()=>({rate,unit,bands,rows,count,lastAt,ready:count>=rate*6&&rate>0})};
  }
  root.DGEEGBands={create};if(typeof module!=='undefined')module.exports=root.DGEEGBands;
})(typeof window!=='undefined'?window:globalThis);
