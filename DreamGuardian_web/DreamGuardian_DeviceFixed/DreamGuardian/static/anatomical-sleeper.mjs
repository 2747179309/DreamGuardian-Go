import * as THREE from 'three';

// Adult proportions in metres, lying face-up, with the head towards local -Z.
// Articulated joints preserve limb lengths; pressure determines only roll direction.
export function createAnatomicalSleeper(person,scene,pillow){
  if(!person)return null;
  person.updateWorldMatrix(true,true);
  const bounds=new THREE.Box3().setFromObject(person),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
  const group=new THREE.Group();group.name='PersonArticulatedSleeper';scene.add(group);
  const scale=size.z/1.83;group.scale.setScalar(scale);
  const pillowCenter=pillow?new THREE.Box3().setFromObject(pillow).getCenter(new THREE.Vector3()):null;
  if(pillowCenter&&pillowCenter.z>center.z)group.rotation.y=Math.PI;
  group.position.set(center.x,bounds.min.y,center.z);
  person.visible=false;
  const skin=new THREE.MeshStandardMaterial({color:'#c9987d',roughness:.68});
  const cloth=new THREE.MeshStandardMaterial({color:'#688c9c',roughness:.94});
  const trim=new THREE.MeshStandardMaterial({color:'#a4bdc7',roughness:.95});
  const hair=new THREE.MeshStandardMaterial({color:'#302824',roughness:.88});
  const dark=new THREE.MeshStandardMaterial({color:'#61483e',roughness:.9});
  const sphere=new THREE.SphereGeometry(1,32,24),joints={};
  function ellipsoid(parent,name,at,radii,material=cloth){
    const mesh=new THREE.Mesh(sphere,material);mesh.name=name;mesh.position.set(...at);mesh.scale.set(...radii);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  function joint(parent,name,at){const node=new THREE.Group();node.name=name;node.position.set(...at);parent.add(node);joints[name]=node;return node}
  // Smooth rings describe chest/waist/hips instead of a stack of primitive balls.
  function profile(parent,name,rings,material){
    const vertices=[],indices=[],sides=40;
    rings.forEach(([z,width,depth,y])=>{for(let i=0;i<=sides;i++){const a=i/sides*Math.PI*2;vertices.push(Math.cos(a)*width,y+Math.sin(a)*depth,z)}});
    for(let j=0;j<rings.length-1;j++)for(let i=0;i<sides;i++){const a=j*(sides+1)+i,b=a+sides+1;indices.push(a,a+1,b,b,a+1,b+1)}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setIndex(indices);geo.computeVertexNormals();
    const mesh=new THREE.Mesh(geo,material);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  const pelvis=joint(group,'pelvis',[0,.15,.02]);
  profile(pelvis,'tailored pelvis',[[-.13,.105,.07,0],[-.09,.14,.092,0],[.02,.158,.105,0],[.12,.14,.09,0],[.15,.095,.06,0]],cloth);
  const chest=joint(pelvis,'spine',[0,0,-.12]);
  profile(chest,'anatomical torso',[[-.43,.065,.055,0],[-.40,.14,.073,0],[-.35,.205,.095,0],[-.27,.183,.114,0],[-.16,.155,.1,0],[-.06,.127,.077,0],[.03,.13,.085,0]],cloth);
  // Collar, button placket and small buttons retain readable clothing detail.
  ellipsoid(chest,'collar',[0,.047,-.418],[.072,.025,.023],trim);
  ellipsoid(chest,'shirt placket',[0,.103,-.235],[.006,.008,.155],trim);
  for(let i=0;i<4;i++)ellipsoid(chest,'shirt button',[0,.114,-.34+i*.075],[.005,.003,.005],dark);
  const neck=joint(chest,'neck',[0,0,-.455]);
  ellipsoid(neck,'neck surface',[0,0,-.018],[.055,.059,.075],skin);
  const head=joint(neck,'head',[0,.014,-.12]);
  ellipsoid(head,'cranium',[0,0,-.025],[.087,.105,.111],skin);
  ellipsoid(head,'jaw',[0,.025,.043],[.068,.069,.065],skin);
  ellipsoid(head,'hair cap',[0,-.02,-.061],[.09,.101,.092],hair);
  ellipsoid(head,'nose bridge',[0,.098,.015],[.015,.029,.033],skin);
  ellipsoid(head,'nose tip',[0,.12,.033],[.018,.017,.018],skin);
  for(const side of [-1,1]){
    ellipsoid(head,'ear',[side*.086,0,.005],[.015,.035,.022],skin);
    ellipsoid(head,'closed eyelid',[side*.034,.097,-.011],[.022,.003,.004],dark);
    ellipsoid(head,'brow',[side*.034,.094,-.031],[.025,.004,.004],hair);
  }
  ellipsoid(head,'lips',[0,.088,.067],[.025,.003,.004],dark);
  function limb(parent,name,length,width,depth,material){
    profile(parent,name,[[0,width*.85,depth*.85,0],[length*.12,width,depth,0],[length*.45,width*.88,depth*.94,0],[length*.85,width*.69,depth*.73,0],[length,width*.64,depth*.67,0]],material);
    ellipsoid(parent,name+' joint',[0,0,0],[width*.86,depth*.86,width*.75],material);
  }
  for(const side of [-1,1]){
    const suffix=side<0?'left':'right';
    const shoulder=joint(chest,suffix+'Shoulder',[side*.187,0,-.345]);
    limb(shoulder,'upper arm',.265,.057,.059,cloth);
    const elbow=joint(shoulder,suffix+'Elbow',[0,0,.265]);limb(elbow,'forearm',.235,.043,.046,skin);
    ellipsoid(elbow,'sleeve cuff',[0,0,.014],[.05,.051,.025],trim);
    const hand=joint(elbow,suffix+'Hand',[0,0,.235]);
    ellipsoid(hand,'palm',[0,0,.041],[.039,.022,.065],skin);
    for(let f=0;f<4;f++)ellipsoid(hand,'finger',[(-1.5+f)*.017,0,.103+(f===1?.007:0)],[.009,.011,.033-(f===3?.008:0)],skin);
    const thumb=ellipsoid(hand,'thumb',[-side*.037,.006,.034],[.013,.015,.035],skin);thumb.rotation.y=side*.45;
    const hip=joint(pelvis,suffix+'Hip',[side*.087,0,.12]);limb(hip,'thigh',.38,.083,.084,cloth);
    const knee=joint(hip,suffix+'Knee',[0,0,.38]);limb(knee,'calf',.36,.057,.061,cloth);
    const foot=joint(knee,suffix+'Foot',[0,0,.36]);ellipsoid(foot,'ankle',[0,0,0],[.034,.039,.055],skin);
    ellipsoid(foot,'foot',[0,.051,.045],[.046,.085,.056],skin);
    for(let t=0;t<5;t++)ellipsoid(foot,'toe',[(t-2)*.016,.113,.055],[.012,.024-t*.002,.018],skin);
  }
  const meshes=[];group.traverse(n=>{if(n.isMesh)meshes.push(n)});
  const v=new THREE.Vector3();
  let previous=Infinity;
  function pose(angle){
    if(!Number.isFinite(angle)||Math.abs(angle-previous)<1e-5)return;
    previous=angle;const amount=THREE.MathUtils.clamp(Math.abs(angle)/(Math.PI*.4),0,1),side=Math.sign(angle);
    const ease=amount*amount*(3-2*amount);
    // Pelvis initiates, chest follows; the head has a smaller relative rotation.
    pelvis.rotation.z=-angle;
    chest.rotation.z=side*.14*Math.sin(amount*Math.PI);
    neck.rotation.z=side*.09*ease;
    head.rotation.z=side*.10*ease;
    for(const s of [-1,1]){
      const suffix=s<0?'left':'right',upper=s===-side?1:0;
      const hip=joints[suffix+'Hip'],knee=joints[suffix+'Knee'],shoulder=joints[suffix+'Shoulder'],elbow=joints[suffix+'Elbow'];
      hip.rotation.x=-(.28+upper*.28)*ease;
      hip.rotation.y=s*(.045+.035*ease);
      knee.rotation.x=(.48+upper*.34)*ease;
      shoulder.rotation.x=-(.08+upper*.12)*ease;
      shoulder.rotation.y=s*(.09+.07*ease);
      elbow.rotation.x=-(.12+(1.25+upper*.25)*ease);
      joints[suffix+'Hand'].rotation.y=-s*.12*ease;
      joints[suffix+'Foot'].rotation.x=-.1*ease;
    }
    group.position.x=center.x+Math.sin(angle)*.065*scale;
    group.position.y=bounds.min.y;
    group.updateWorldMatrix(true,true);
    // Exact vertex support prevents bent knees and hands penetrating the mattress.
    let minY=Infinity;
    for(const mesh of meshes){const positions=mesh.geometry.attributes.position;for(let i=0;i<positions.count;i++){v.fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld);minY=Math.min(minY,v.y)}}
    group.position.y+=bounds.min.y-minY;
    group.updateWorldMatrix(true,true);
  }
  pose(0);
  return {group,pose,joints};
}
