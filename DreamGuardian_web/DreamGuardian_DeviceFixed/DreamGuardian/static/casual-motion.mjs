import * as T from 'three';
const UP=new T.Vector3(0,1,0),rad=T.MathUtils.degToRad;
const smooth=x=>{x=T.MathUtils.clamp(x,0,1);return x*x*x*(x*(x*6-15)+10)};

// Conservative height cells from the actual pillow, quilt and mattress meshes.
// Built once, rather than raycasting the entire room for every animated vertex.
function supportField(objects,fallback){
  const box=new T.Box3();objects.forEach(o=>box.union(new T.Box3().setFromObject(o)));
  if(box.isEmpty())return ()=>fallback;
  const step=.025,nx=Math.ceil((box.max.x-box.min.x)/step)+1,nz=Math.ceil((box.max.z-box.min.z)/step)+1;
  const values=new Float32Array(nx*nz),ray=new T.Raycaster();ray.ray.direction.set(0,-1,0);
  for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
    ray.ray.origin.set(box.min.x+x*step,box.max.y+1,box.min.z+z*step);
    const hit=ray.intersectObjects(objects,true)[0];values[z*nx+x]=hit?hit.point.y:fallback;
  }
  return (x,z)=>{
    const i=Math.floor((x-box.min.x)/step),j=Math.floor((z-box.min.z)/step);
    if(i<0||j<0||i>=nx-1||j>=nz-1)return fallback;
    return Math.max(values[j*nx+i],values[j*nx+i+1],values[(j+1)*nx+i],values[(j+1)*nx+i+1]);
  };
}

export async function attachCasualSleeper(person,scene,pillow,gltf,poses,{supports=[]}={}){
  if(!person)throw new Error('卧室缺少人体定位对象');
  person.updateWorldMatrix(true,true);
  const bounds=new T.Box3().setFromObject(person),size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());
  const nodes=await Promise.all(poses[0].map((_,i)=>gltf.parser.getDependency('node',i)));
  const frames=poses.map(frame=>frame.map(m=>{const p=new T.Vector3(),q=new T.Quaternion(),s=new T.Vector3();new T.Matrix4().fromArray(m).decompose(p,q,s);return {p,q,s}}));
  const group=new T.Group();group.name='PersonCasualSleeper';group.add(gltf.scene);scene.add(group);
  const meshes=[],joints={};
  gltf.scene.traverse(n=>{if(n.isBone)joints[n.name.replace(/_\d+$/,'')]=n;if(n.isMesh){n.castShadow=true;n.receiveShadow=true;n.frustumCulled=false;meshes.push(n)}});
  const update=()=>{group.updateMatrixWorld(true);for(const m of meshes)if(m.isSkinnedMesh)m.skeleton.update()};
  update();const neutral=new T.Box3().setFromObject(group,true),neutralCenter=neutral.getCenter(new T.Vector3());
  // Preserve breathing room at the foot end after the shoulders move down-bed.
  const scale=size.z/neutral.getSize(new T.Vector3()).z*(pillow ? 0.96 : 1);group.scale.setScalar(scale);
  const pillowBox=pillow?new T.Box3().setFromObject(pillow):null,pillowCenter=pillowBox?.getCenter(new T.Vector3());
  if(pillowCenter&&pillowCenter.z>center.z)group.rotation.y=Math.PI;
  const headSign=group.rotation.y?1:-1;
  const offset=new T.Vector3(-neutralCenter.x,0,-neutralCenter.z).multiplyScalar(scale).applyAxisAngle(UP,group.rotation.y);
  const origin=new T.Vector3(center.x+offset.x,bounds.min.y,center.z+offset.z);
  const bedHeight=supportField(supports,bounds.min.y),allHeight=supportField([...supports,...(pillow?[pillow]:[])],bounds.min.y);
  const sets={all:[],trunk:[],pelvis:[],head:[],leftLeg:[],rightLeg:[],leftArm:[],rightArm:[]};
  for(const mesh of meshes)for(let i=0;i<mesh.geometry.attributes.position.count;i++){
    const ref={mesh,i},g=mesh.geometry;sets.all.push(ref);if(!mesh.isSkinnedMesh)continue;
    const w={trunk:0,pelvis:0,head:0,leftLeg:0,rightLeg:0,leftArm:0,rightArm:0};
    for(let c=0;c<4;c++){
      const bone=mesh.skeleton.bones[g.attributes.skinIndex.getComponent(i,c)]?.name||'',weight=g.attributes.skinWeight.getComponent(i,c);
      if(/^(Hips|Spine)/.test(bone))w.trunk+=weight;if(/^Head/.test(bone))w.head+=weight;
      if(/^Hips/.test(bone))w.pelvis+=weight;
      for(const [side,label] of [['Left','left'],['Right','right']]){
        if(new RegExp('^'+side+'(UpLeg|Leg|Foot|Toe)').test(bone))w[label+'Leg']+=weight;
        if(new RegExp('^'+side+'(Arm|ForeArm|Hand)').test(bone))w[label+'Arm']+=weight;
      }
    }
    // The shirt's shoulder cap is a support surface too, including vertices
    // weighted to the upper arm. Omitting it makes a low shoulder sink first.
    if(mesh.material?.name==='Wolf3D_Outfit_Top')w.trunk=1;
    for(const key of Object.keys(w))if(w[key]>.5)sets[key].push(ref);
  }
  const vertex=new T.Vector3();
  function clearance(refs,height=allHeight){
    let min=Infinity;
    for(const {mesh,i} of refs){mesh.getVertexPosition(i,vertex);vertex.applyMatrix4(mesh.matrixWorld);min=Math.min(min,vertex.y-height(vertex.x,vertex.z))}
    return min;
  }
  function worldTurn(bone,axis,angle){
    const parent=bone.parent.getWorldQuaternion(new T.Quaternion());
    const localAxis=axis.clone().applyQuaternion(parent.invert());
    bone.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(localAxis,angle));update();
  }
  function liftChain(bone,end,refs,maxDegrees=16){
    const a=bone.getWorldPosition(new T.Vector3()),track=end.getWorldPosition(new T.Vector3()).sub(a);track.y=0;
    if(track.lengthSq()<1e-8)return 0;
    const axis=track.normalize().cross(UP).normalize(),q=bone.quaternion.clone();
    const at=angle=>{bone.quaternion.copy(q);worldTurn(bone,axis,angle);return clearance(refs)};
    if(clearance(refs)>=.002)return 0;
    let lo=0,hi=rad(maxDegrees);if(at(hi)<.002)return hi;
    for(let n=0;n<9;n++){const mid=(lo+hi)/2;if(at(mid)<.002)lo=mid;else hi=mid}
    at(hi);return hi;
  }
  function basePose(angle){
    const u=Math.abs(angle)/(Math.PI*.4),sign=angle<0?-1:1,target=frames[sign<0?1:2];
    nodes.forEach((n,i)=>{
      let t=smooth(u);
      if(i===0)t*=.86; // Rest partly on the back of the shoulder, not its sharp lateral cap.
      // Reach/flex precedes rolling; individual segments do not move in lockstep.
      if(/(Arm|Hand|Shoulder)/.test(n.name))t=smooth(u/.88);
      else if(/(UpLeg|Leg|Foot|Toe)/.test(n.name))t=smooth(u/.95);
      n.position.lerpVectors(frames[0][i].p,target[i].p,t);n.quaternion.slerpQuaternions(frames[0][i].q,target[i].q,t);n.scale.copy(frames[0][i].s);n.updateMatrix();
    });
    group.position.copy(origin);update();
    const pulse=Math.sin(Math.PI*u)**2;
    for(const [name,deg] of [['Spine',2.5],['Spine1',2],['Spine2',1.5]])joints[name]?.quaternion.multiply(new T.Quaternion().setFromAxisAngle(UP,rad(sign*deg*pulse)));
    update();return {u,sign};
  }
  basePose(0);
  if(pillowBox&&joints.LeftArm&&joints.RightArm){
    const shoulderZ=(joints.LeftArm.getWorldPosition(new T.Vector3()).z+joints.RightArm.getWorldPosition(new T.Vector3()).z)/2;
    const pillowEdge=headSign>0?pillowBox.min.z:pillowBox.max.z;
    origin.z+=(pillowEdge-headSign*.075)-shoulderZ;
    origin.x+=pillowCenter.x-joints.Head.getWorldPosition(new T.Vector3()).x;
  }
  let last=Infinity;const diagnostics={};
  function legGap(){
    const samples=side=>{
      const p=['UpLeg','Leg','Foot','ToeBase'].map(n=>joints[side+n].getWorldPosition(new T.Vector3()));
      const out=[];
      for(let segment=0;segment<3;segment++)for(let i=segment===0?2:0;i<=10;i++){
        const t=i/10,r=segment===0?T.MathUtils.lerp(.102,.072,t):segment===1?T.MathUtils.lerp(.072,.060,t):.12;
        out.push({p:p[segment].clone().lerp(p[segment+1],t),r});
      }return out;
    };
    let min=Infinity;for(const a of samples('Left'))for(const b of samples('Right'))min=Math.min(min,a.p.distanceTo(b.p)-a.r-b.r);return min;
  }
  function pose(angle){
    if(!Number.isFinite(angle))return;angle=T.MathUtils.clamp(angle,-Math.PI*.4,Math.PI*.4);if(Math.abs(angle-last)<.00001)return;last=angle;
    const {u,sign}=basePose(angle);
    // The back/pelvis establish support. A shoe must not lift the whole torso.
    group.position.y+=.003-clearance(sets.trunk,bedHeight);update();
    group.position.y-=Math.min(Math.max(0,clearance(sets.pelvis,bedHeight)-.003),T.MathUtils.lerp(.025,.045,smooth(u)));update();
    // Settle the pelvis independently; gently curve the back so the shoulder
    // can rest on the quilt without suspending the hips above the mattress.
    diagnostics.backAdjustment=liftChain(joints.Spine,joints.Neck,sets.trunk,22);
    const upper=sign>0?'Left':'Right',hip=joints[upper+'UpLeg'],ankle=joints[upper+'Foot'];
    // Advance the upper leg as one chain, keeping its knee and ankle aligned.
    worldTurn(hip,UP,-sign*headSign*rad(15+10*smooth((u-.5)/.5))*smooth(u/.65));
    const track=ankle.getWorldPosition(new T.Vector3()).sub(hip.getWorldPosition(new T.Vector3()));track.y=0;
    worldTurn(hip,track.clone().normalize().cross(UP).normalize(),rad(22)*Math.sin(Math.PI*u)**2+rad(5)*Math.sin(2*Math.PI*u)**2-rad(13)*smooth((u-.25)/.75));
    for(const [name,key] of [['Left','left'],['Right','right']]){
      diagnostics[key+'LegLift']=liftChain(joints[name+'UpLeg'],joints[name+'Foot'],sets[key+'Leg']);
      diagnostics[key+'ArmLift']=liftChain(joints[name+'Arm'],joints[name+'Hand'],sets[key+'Arm'],20);
    }
    const q=hip.quaternion.clone(),liftAxis=track.normalize().cross(UP).normalize();
    const separate=angle=>{hip.quaternion.copy(q);worldTurn(hip,liftAxis,angle);return legGap()};
    if(legGap()<.004){let lo=0,hi=rad(25);if(separate(hi)>=.004){for(let i=0;i<9;i++){const mid=(lo+hi)/2;if(separate(mid)<.004)lo=mid;else hi=mid}}separate(hi)}
    diagnostics.legGap=legGap();
    if(pillowBox&&joints.Neck&&joints.Head){
      const neck=joints.Neck,head=joints.Head,nq=neck.quaternion.clone(),hq=head.quaternion.clone(),axis=new T.Vector3(-headSign,0,0);
      const headShare=T.MathUtils.lerp(-.35,.15,smooth(u));
      const at=angle=>{neck.quaternion.copy(nq);head.quaternion.copy(hq);update();worldTurn(neck,axis,angle);worldTurn(head,axis,angle*headShare);return clearance(sets.head)};
      let lo=rad(-38),hi=rad(22);
      if(at(lo)>.003)hi=lo;else if(at(hi)<.003)lo=hi;
      else for(let n=0;n<10;n++){const mid=(lo+hi)/2;if(at(mid)<.003)lo=mid;else hi=mid}
      at(hi);diagnostics.neckAdjustment=hi;
    }
    // Last-resort non-penetration guard includes hands, shoes, hair and glasses.
    const residual=Math.max(0,.0015-clearance(sets.all));group.position.y+=residual;update();
    diagnostics.safetyLift=residual;diagnostics.bedClearance=clearance(sets.all);diagnostics.headClearance=clearance(sets.head);
  }
  pose(0);person.visible=false;
  return {group,pose,joints,diagnostics,contactHeight:allHeight};
}
