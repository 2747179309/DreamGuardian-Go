/* Rolling 30-second measurements; missing data is never filled with zeroes. */
(function(root){
  function create(now=()=>performance.now()/1000){
    const samples=[];let first=null;
    function push(values){const t=now();if(first===null)first=t;samples.push({t,...values});prune(t);}
    function prune(t){while(samples.length>1&&samples[1].t<t-30)samples.shift();}
    function points(key){
      const end=now(),start=end-30;prune(end);const result=[];
      if(first===null)return [];
      for(let i=0;i<samples.length;i++){
        const sample=samples[i];
        if(i&&sample.t-samples[i-1].t>1.5)result.push({t:samples[i-1].t+1.5,value:null});
        result.push({t:sample.t,value:sample[key]??null});
      }
      const last=samples[samples.length-1];
      if(last&&end-last.t<=1.5)result.push({t:end,value:last[key]??null});
      else if(last)result.push({t:Math.min(end,last.t+1.5),value:null});
      return result;
    }
    return {push,points,range:()=>({start:now()-30,end:now()})};
  }
  root.DGWaveform={create};if(typeof module!=='undefined')module.exports=root.DGWaveform;
})(typeof window!=='undefined'?window:globalThis);
