/* Six-sensor pillow estimate. Row-major: upper P1..P3, lower P4..P6.
 * Input is 0..100 pressure intensity, NOT calibrated physical pressure.
 * Gaussian radial-basis interpolation estimates unmeasured areas; fixed limits
 * keep a low-pressure frame blue rather than auto-stretching it to red. */
(function(root){
  'use strict';
  const positions=[[.2,.3],[.5,.3],[.8,.3],[.2,.7],[.5,.7],[.8,.7]];
  const stops=[[0,[16,51,115]],[.2,[34,104,210]],[.42,[29,192,201]],[.62,[133,218,129]],[.8,[255,206,77]],[1,[242,73,52]]];
  const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
  function values(input){
    if(!Array.isArray(input))return null;
    const flat=input.flat();
    if(flat.length!==6)return null;
    return flat.map(v=>v==null||v===''||typeof v==='boolean'||!Number.isFinite(Number(v))?null:clamp(Number(v),0,100));
  }
  const kernel=(x,y,cx,cy)=>Math.exp(-.5*(((x-cx)/.17)**2+((y-cy)/.23)**2));
  function fit(zones){
    const indices=zones.map((v,i)=>v==null?-1:i).filter(i=>i>=0),n=indices.length;
    const matrix=indices.map(i=>[...indices.map(j=>kernel(...positions[i],...positions[j])),zones[i]]);
    // Tiny pivoted solve; keep measured values exact rather than diluting a
    // single high sensor with its zero-valued neighbours. Missing rows omitted.
    for(let col=0;col<n;col++){
      let pivot=col;for(let row=col+1;row<n;row++)if(Math.abs(matrix[row][col])>Math.abs(matrix[pivot][col]))pivot=row;
      [matrix[col],matrix[pivot]]=[matrix[pivot],matrix[col]];
      const divisor=matrix[col][col];for(let k=col;k<=n;k++)matrix[col][k]/=divisor;
      for(let row=0;row<n;row++)if(row!==col){const factor=matrix[row][col];for(let k=col;k<=n;k++)matrix[row][k]-=factor*matrix[col][k];}
    }
    return {indices,coefficients:matrix.map(row=>row[n]),ceiling:Math.max(0,...zones.filter(v=>v!=null))};
  }
  function intensity(zones,x,y,field=fit(zones)){
    let sum=0;
    field.indices.forEach((i,k)=>{sum+=field.coefficients[k]*kernel(x,y,...positions[i]);});
    return clamp(sum,0,field.ceiling);
  }
  function color(value){
    const t=clamp(value/100,0,1);
    for(let i=1;i<stops.length;i++)if(t<=stops[i][0]){
      const [a,ca]=stops[i-1],[b,cb]=stops[i],p=(t-a)/(b-a);
      return ca.map((c,k)=>Math.round(c+(cb[k]-c)*p));
    }
    return stops[stops.length-1][1];
  }
  function raster(ctx,zones,width=180,height=108,feather=false){
    const data=ctx.createImageData(width,height);
    const field=fit(zones);
    for(let j=0;j<height;j++)for(let i=0;i<width;i++){
      const x=i/(width-1),y=j/(height-1),n=(j*width+i)*4;
      const c=color(intensity(zones,x,y,field));
      data.data[n]=c[0];data.data[n+1]=c[1];data.data[n+2]=c[2];
      const edge=clamp(Math.min(x,1-x,y,1-y)/.12,0,1);
      data.data[n+3]=feather?Math.round(220*edge*edge*(3-2*edge)):255;
    }
    ctx.putImageData(data,0,0);
  }
  root.DGPressureField={positions,values,intensity,color,raster};
  if(typeof module!=='undefined')module.exports=root.DGPressureField;
})(typeof window!=='undefined'?window:globalThis);
