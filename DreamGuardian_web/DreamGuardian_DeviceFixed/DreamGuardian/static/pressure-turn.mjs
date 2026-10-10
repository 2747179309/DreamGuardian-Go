import * as THREE from 'three';

// Pressure columns are pillow-local left/centre/right, not anatomical sides.
export class PressureTurn {
  constructor(){this.angle=0;this.velocity=0;this.balance=0;this.side=0;this.candidate=0;this.since=0;this.lastStamp=null;this.lastValid=0;this.status='等待六点枕压';this.valid=false;this.paused=false;}
  ingest(data, now=Date.now()){
    const sample=data?.sample||{},pillow=data?.pillow||{};
    const zones=(pillow.pressure_zones??sample.pressure_matrix)?.flat?.();
    const rawStamp=pillow.received_at??sample.unix_time??sample.timestamp;
    const stamp=typeof rawStamp==='number'?rawStamp*1000:Date.parse(rawStamp);
    const reason=sample.presence===false?'离床 · 暂停姿态推演':sample.connected===false?'设备离线 · 保持姿态':!Number.isFinite(stamp)||now-stamp>4500||stamp>now+2000?'枕压过期 · 保持姿态':!zones||zones.length!==6||zones.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>100)?'枕压不完整 · 保持姿态':zones.reduce((a,b)=>a+b,0)<12?'未检测到有效枕压':'',valid=!reason;
    if(!valid){this.valid=false;this.velocity=0;this.since=now;this.candidate=this.side;this.status=reason;return;}
    if(this.lastStamp===stamp)return;
    const elapsed=this.valid?Math.min(1,(now-this.lastValid)/1000):1;
    this.lastStamp=stamp;this.lastValid=now;this.valid=true;
    const left=zones[0]+zones[3],right=zones[2]+zones[5],total=zones.reduce((a,b)=>a+b,0);
    this.balance+=( (right-left)/total-this.balance)*(1-Math.exp(-elapsed/.35));
    let next=this.side;
    if(this.balance>.18)next=1;else if(this.balance<-.18)next=-1;else if(Math.abs(this.balance)<.08)next=0;
    if(next!==this.candidate){this.candidate=next;this.since=now;}
    else if(now-this.since>=650)this.side=next;
    this.status=this.side<0?'向枕头左侧翻身':this.side>0?'向枕头右侧翻身':'回到仰卧';
  }
  step(dt,now=Date.now(),reduced=false){
    if(!this.valid||now-this.lastValid>4500){if(this.valid){this.valid=false;this.status='枕压过期 · 保持姿态';}this.velocity=0;return this.angle;}
    if(this.paused){this.velocity=0;return this.angle;}
    const target=this.side*Math.PI*72/180;
    if(reduced){this.angle=target;this.velocity=0;return this.angle;}
    // Critically damped motion: no jump on reversal and no overshoot.
    dt=Math.min(Math.max(dt,0),.1);
    const omega=1.8,offset=this.angle-target,c=this.velocity+omega*offset,decay=Math.exp(-omega*dt);
    this.angle=target+(offset+c*dt)*decay;
    this.velocity=(this.velocity-omega*c*dt)*decay;
    return this.angle;
  }
}

export function createSleeperRig(person,scene){
  if(!person)return null;
  person.updateWorldMatrix(true,true);
  const bounds=new THREE.Box3().setFromObject(person),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
  const meshes=[];person.traverse(n=>{if(n.isMesh)meshes.push(n)});
  const group=new THREE.Group();group.name='PersonPressureAnimation';scene.add(group);
  const parts=meshes.map(mesh=>{
    const geometry=mesh.geometry.clone();geometry.applyMatrix4(mesh.matrixWorld);mesh.geometry=geometry;
    group.add(mesh);mesh.position.set(0,0,0);mesh.quaternion.identity();mesh.scale.set(1,1,1);mesh.frustumCulled=false;
    const position=geometry.attributes.position,normal=geometry.attributes.normal;
    return {mesh,position,normal,base:position.array.slice(),normals:normal?.array.slice()};
  });
  // Geometry is in scene coordinates. Z follows the bed length; all facial,
  // hair and clothing details use the same continuous deformation as the body.
  let previous=Infinity;
  function pose(angle){
    if(Math.abs(angle-previous)<.0001)return;
    previous=angle;let minY=Infinity;
    for(const p of parts){
      for(let i=0;i<p.position.count;i++){
        const k=i*3,x=p.base[k]-center.x,y=p.base[k+1]-center.y,z=p.base[k+2];
        const along=THREE.MathUtils.clamp((z-bounds.min.z)/size.z,0,1);
        const a=-angle*(.82+.18*THREE.MathUtils.smoothstep(along,.25,.8));
        const c=Math.cos(a),s=Math.sin(a),py=center.y+x*s+y*c;
        p.position.setXYZ(i,center.x+x*c-y*s,py,z);minY=Math.min(minY,py);
        if(p.normal){const nx=p.normals[k],ny=p.normals[k+1];p.normal.setXYZ(i,nx*c-ny*s,nx*s+ny*c,p.normals[k+2]);}
      }
      p.position.needsUpdate=true;if(p.normal)p.normal.needsUpdate=true;
      p.mesh.geometry.computeBoundingBox();p.mesh.geometry.computeBoundingSphere();
    }
    // Keep the lowest body surface on the original resting plane.
    group.position.y=bounds.min.y-minY;
    group.position.x=Math.sin(angle)*size.x*.10;
  }
  pose(0);return {group,pose};
}
