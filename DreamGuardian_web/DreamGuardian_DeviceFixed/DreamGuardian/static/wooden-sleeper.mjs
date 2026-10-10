import * as THREE from 'three';

// Carved beech mannequin. Metres, head towards -Z; fixed-length two-bone IK.
function woodTexture(){
  const width=128,height=256,data=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const grain=Math.sin(x*.65+Math.sin(y*.035)*1.3+Math.sin(y*.013+x*.035)*2.2);
    const tone=.93+.045*grain+Math.sin(x*2.75+y*.028)*.018,i=(y*width+x)*4;
    data[i]=255*tone;data[i+1]=246*tone;data[i+2]=224*tone;data[i+3]=255;
  }
  const texture=new THREE.DataTexture(data,width,height);texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;
}
export function createAnatomicalSleeper(person,scene,pillow){
  if(!person)return null;
  person.updateWorldMatrix(true,true);
  const bounds=new THREE.Box3().setFromObject(person),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
  const group=new THREE.Group();group.name='PersonArticulatedSleeper';scene.add(group);
  const scale=size.z/1.83;group.scale.setScalar(scale);
  const pillowCenter=pillow?new THREE.Box3().setFromObject(pillow).getCenter(new THREE.Vector3()):null;
  if(pillowCenter&&pillowCenter.z>center.z)group.rotation.y=Math.PI;
  group.position.set(center.x,bounds.min.y,center.z);person.visible=false;
  const wood=new THREE.MeshStandardMaterial({color:'#cba77b',map:woodTexture(),roughness:.53});
  const endWood=new THREE.MeshStandardMaterial({color:'#9c7957',roughness:.64});
  const brass=new THREE.MeshStandardMaterial({color:'#a48a62',metalness:.65,roughness:.4});
  const dark=new THREE.MeshStandardMaterial({color:'#554638',roughness:.74});
  const sphere=new THREE.SphereGeometry(1,32,24),joints={},limbs=[],contactMeshes=[];
  function mesh(parent,name,geometry,material){
    const m=new THREE.Mesh(geometry,material);m.name=name;m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
  }
  function egg(parent,name,at,radii,material=wood){
    const m=mesh(parent,name,sphere,material);m.position.set(...at);m.scale.set(...radii);return m;
  }
  function joint(parent,name,at,radius){
    const n=new THREE.Group();n.name=name;n.position.set(...at);parent.add(n);joints[name]=n;
    if(radius)egg(n,name+' ball',[0,0,0],[radius,radius,radius],endWood);
    return n;
  }
  // Cubic anatomical cross-sections, smooth normals, UV grain and rounded ends.
  function carve(parent,name,rings,material=wood){
    const pos=[],uv=[],indices=[],sides=40,steps=(rings.length-1)*6;
    const interp=(a,b,c,d,t)=>.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t);
    for(let j=0;j<=steps;j++){
      const q=j/steps*(rings.length-1),k=Math.min(rings.length-2,Math.floor(q)),t=q-k;
      const row=Array.from({length:4},(_,axis)=>interp(rings[Math.max(0,k-1)][axis],rings[k][axis],rings[k+1][axis],rings[Math.min(rings.length-1,k+2)][axis],t));
      for(let i=0;i<=sides;i++){
        const a=i/sides*Math.PI*2;
        pos.push(Math.cos(a)*Math.max(.0001,row[1]),row[3]+Math.sin(a)*Math.max(.0001,row[2]),row[0]);uv.push(i/sides,j/steps);
      }
    }
    for(let j=0;j<steps;j++)for(let i=0;i<sides;i++){const a=j*(sides+1)+i,b=a+sides+1;indices.push(a,a+1,b,b,a+1,b+1)}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();
    return mesh(parent,name,geometry,material);
  }
  function pin(parent,radius){
    const m=mesh(parent,'brass hinge pin',new THREE.CylinderGeometry(radius*.43,radius*.43,radius*1.92,24),brass);m.rotation.z=Math.PI/2;
    for(const s of [-1,1]){
      egg(parent,'recessed hinge cap',[s*radius*.98,0,0],[.002,radius*.34,radius*.34],dark);
      egg(parent,'pin centre',[s*radius*1.015,0,0],[.002,radius*.16,radius*.16],brass);
    }
  }
  const pelvis=joint(group,'pelvis',[0,.12,.025]);
  carve(pelvis,'carved pelvic shell',[[-.125,.001,.001,0],[-.10,.095,.07,0],[-.025,.137,.096,0],[.055,.145,.09,0],[.115,.106,.068,0],[.137,.001,.001,0]]);
  const waist=joint(pelvis,'waist',[0,0,-.125],.065);
  const chest=joint(waist,'spine',[0,0,-.025]);
  carve(chest,'anatomical torso',[[-.365,.001,.001,0],[-.35,.069,.056,0],[-.305,.163,.08,.004],[-.235,.174,.102,.008],[-.16,.15,.096,.008],[-.075,.111,.07,0],[-.015,.076,.056,0],[0,.001,.001,0]]);
  const neck=joint(chest,'neck',[0,0,-.385],.038);
  const head=joint(neck,'head',[0,.018,-.105]);
  carve(head,'carved head',[[-.125,.001,.001,0],[-.109,.058,.066,-.005],[-.067,.085,.1,0],[-.005,.079,.099,.008],[.046,.062,.077,.016],[.086,.035,.045,.008],[.096,.001,.001,0]]);
  egg(head,'nose',[0,.1,.021],[.013,.018,.031]);
  for(const s of [-1,1])egg(head,'ear',[s*.079,0,.01],[.012,.027,.017]);
  function handShape(parent,s){
    carve(parent,'palm',[[0,.023,.017,0],[.026,.034,.021,0],[.065,.034,.019,0],[.082,.026,.012,0]]);
    for(let f=0;f<4;f++){
      let base=joint(parent,'finger '+s+' '+f,[(-1.5+f)*.017,0,.072]);
      const lengths=[.028,.023,.018].map(n=>n*(f===3?.78:f===1?1.06:1));
      for(let k=0;k<3;k++){
        base.rotation.x=.14+k*.07;const length=lengths[k];
        carve(base,'finger phalanx',[[0,.007,.007,0],[length*.3,.008,.008,0],[length*.85,.006,.006,0],[length,.003,.003,0]]);
        if(k<2)base=joint(base,'knuckle '+s+' '+f+' '+k,[0,0,length],.006);
      }
    }
    const thumb=joint(parent,'thumb '+s,[-s*.032,0,.023],.01);thumb.rotation.y=-s*.65;thumb.rotation.x=.25;
    carve(thumb,'thumb',[[0,.011,.01,0],[.022,.012,.011,0],[.045,.008,.008,0],[.055,.001,.001,0]]);
  }
  function segment(parent,name,length,width,depth){
    return carve(parent,name,[[.008,width*.48,depth*.48,0],[length*.14,width*.88,depth*.9,0],[length*.36,width,depth,0],[length*.65,width*.84,depth*.87,0],[length-.023,width*.53,depth*.57,0],[length-.006,width*.4,depth*.4,0]]);
  }
  for(const s of [-1,1]){
    const id=s<0?'left':'right';
    const shoulder=joint(chest,id+'Shoulder',[s*.176,0,-.281],.042);
    segment(shoulder,'upper arm',.275,.047,.05);
    const elbow=joint(shoulder,id+'Elbow',[0,0,.275],.03);pin(elbow,.031);
    segment(elbow,'forearm',.245,.037,.039);
    const hand=joint(elbow,id+'Hand',[0,0,.245],.02);handShape(hand,s);
    const hip=joint(pelvis,id+'Hip',[s*.083,0,.10],.055);
    segment(hip,'thigh',.38,.072,.077);
    const knee=joint(hip,id+'Knee',[0,0,.38],.044);pin(knee,.043);
    segment(knee,'calf',.36,.048,.054);
    const foot=joint(knee,id+'Foot',[0,0,.36],.027);
    carve(foot,'carved foot',[[-.025,.012,.014,0],[0,.033,.03,0],[.06,.041,.029,.014],[.135,.043,.023,.014],[.175,.035,.018,.01],[.186,.001,.001,.01]]);
    limbs.push({s,shoulder,elbow,hand,hip,knee,foot});
  }
  group.traverse(n=>{if(n.isMesh){n.geometry.computeBoundingBox();contactMeshes.push(n)}});
  const zAxis=new THREE.Vector3(0,0,1),v=new THREE.Vector3(),parentQ=new THREE.Quaternion(),desiredQ=new THREE.Quaternion();
  function aim(node,from,to){
    desiredQ.setFromUnitVectors(zAxis,to.clone().sub(from).normalize());
    node.parent.getWorldQuaternion(parentQ);node.quaternion.copy(parentQ.invert().multiply(desiredQ));node.updateWorldMatrix(false,true);
  }
  function solve(a,b,end,l1,l2,target,pole){
    const start=a.getWorldPosition(new THREE.Vector3()),goal=group.localToWorld(new THREE.Vector3(...target));
    const bend=group.localToWorld(new THREE.Vector3(...pole)).sub(start);
    const delta=goal.clone().sub(start),distance=THREE.MathUtils.clamp(delta.length(),Math.abs(l1-l2)*scale+.001,(l1+l2)*scale-.001),direction=delta.normalize();
    const along=(l1*l1*scale*scale-l2*l2*scale*scale+distance*distance)/(2*distance);
    bend.addScaledVector(direction,-bend.dot(direction)).normalize();
    const height=Math.sqrt(Math.max(0,l1*l1*scale*scale-along*along));
    // Resolve the bend on the mattress-facing hemisphere; a low pole must
    // never send an elbow or knee underneath the mattress mid-transition.
    const up=new THREE.Vector3(0,1,0).addScaledVector(direction,-direction.y),upLength=up.length();
    if(height>1e-7&&upLength>1e-7){
      up.normalize();
      const minimum=(group.position.y+.055*scale-start.y-along*direction.y)/height;
      if(bend.y<minimum){
        const ratio=THREE.MathUtils.clamp(minimum/upLength,0,1);
        const lateral=new THREE.Vector3().crossVectors(direction,up).normalize();
        if(lateral.dot(bend)<0)lateral.negate();
        bend.copy(up).multiplyScalar(ratio).addScaledVector(lateral,Math.sqrt(1-ratio*ratio));
      }
    }
    const middle=start.clone().addScaledVector(direction,along).addScaledVector(bend,height);
    aim(a,start,middle);aim(b,middle,start.clone().addScaledVector(direction,distance));
    return end.getWorldPosition(new THREE.Vector3());
  }
  const mix=(a,b,t)=>a.map((n,i)=>THREE.MathUtils.lerp(n,b[i],t));
  let previous=Infinity;
  function pose(angle){
    if(!Number.isFinite(angle)||Math.abs(angle-previous)<1e-5)return;
    previous=angle;
    const amount=THREE.MathUtils.clamp(Math.abs(angle)/(Math.PI*.4),0,1),s=Math.sign(angle)||1,e=amount*amount*(3-2*amount),lead=Math.sin(amount*Math.PI);
    group.position.set(center.x+Math.sin(angle)*.045*scale,bounds.min.y,center.z);
    pelvis.position.y=.12+.043*e;pelvis.rotation.z=-angle;waist.rotation.z=-s*.075*lead;chest.rotation.z=s*.16*lead;
    neck.rotation.z=s*.08*e;head.rotation.z=s*.075*e;group.updateWorldMatrix(true,true);
    for(const part of limbs){
      const upper=part.s===-s;
      // Hands stay in front of the chest rather than swinging above the face.
      solve(part.shoulder,part.elbow,part.hand,.275,.245,mix([part.s*.235,.072,.035],[s*(upper?.34:.30),upper?.19:.065,upper?-.22:-.58],e).map((v,i)=>i===1&&upper?v+.025*lead:v),mix([part.s*.34,.055,-.18],[s*(upper?.38:.32),upper?.21:.07,upper?-.06:-.32],e).map((v,i)=>i===1&&upper?v+.025*lead:v));
      const handQ=new THREE.Quaternion().setFromEuler(new THREE.Euler(0,s*Math.PI*e,part.s*.09));
      group.getWorldQuaternion(parentQ);handQ.premultiply(parentQ);part.hand.parent.getWorldQuaternion(parentQ);part.hand.quaternion.copy(parentQ.invert().multiply(handQ));
      // Stagger upper/lower legs vertically and longitudinally. The transient lift
      // keeps their paths apart midway through rolling, not just at the end pose.
      solve(part.hip,part.knee,part.foot,.38,.36,mix([part.s*.14,.055,.855],[s*(upper?.28:-.04),upper?.21:.055,upper?.54:.83],e).map((v,i)=>i===1&&upper?v+.13*lead:v),mix([part.s*.22,.12,.46],[s*(upper?.43:.23),upper?.29:.075,.40],e).map((v,i)=>i===1&&upper?v+.18*lead:v));
      const footQ=new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI*.38*(1-e),s*.18*e,-angle*.3));
      group.getWorldQuaternion(parentQ);footQ.premultiply(parentQ);part.foot.parent.getWorldQuaternion(parentQ);part.foot.quaternion.copy(parentQ.invert().multiply(footQ));
    }
    group.updateWorldMatrix(true,true);
    // Bound support cost by part count, independent of the dense carved surfaces.
    let minY=Infinity;
    for(const m of contactMeshes){const b=m.geometry.boundingBox;for(let i=0;i<8;i++){v.set(i&1?b.max.x:b.min.x,i&2?b.max.y:b.min.y,i&4?b.max.z:b.min.z).applyMatrix4(m.matrixWorld);minY=Math.min(minY,v.y)}}
    group.position.y+=bounds.min.y-minY;group.updateWorldMatrix(true,true);
  }
  pose(0);return {group,pose,joints};
}
