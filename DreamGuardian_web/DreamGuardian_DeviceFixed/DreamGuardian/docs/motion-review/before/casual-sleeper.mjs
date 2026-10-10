import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const base='/static/models/casual-man/';
export async function createAnatomicalSleeper(person,scene,pillow){
  const response=await fetch(base+'poses.json?v=smooth-20260924');if(!response.ok)throw new Error('人物睡姿文件加载失败');
  const poses=await response.json();const gltf=await new GLTFLoader().loadAsync(base+'SUPINE.gltf?v=smooth-20260924');
  return attachCasualSleeper(person,scene,pillow,gltf,poses);
}
export async function attachCasualSleeper(person,scene,pillow,gltf,poses){
  if(!person)throw new Error('卧室缺少人体定位对象');
  const bounds=new THREE.Box3().setFromObject(person),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
  const nodes=await Promise.all(poses[0].map((_,i)=>gltf.parser.getDependency('node',i)));
  const frames=poses.map(frame=>frame.map(m=>{const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();new THREE.Matrix4().fromArray(m).decompose(p,q,s);return {p,q,s}}));
  const group=new THREE.Group();group.name='PersonCasualSleeper';group.add(gltf.scene);scene.add(group);
  const meshes=[];gltf.scene.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;n.frustumCulled=false;meshes.push(n)}});
  group.updateMatrixWorld(true);const neutral=new THREE.Box3().setFromObject(group,true),neutralCenter=neutral.getCenter(new THREE.Vector3());
  const scale=size.z/neutral.getSize(new THREE.Vector3()).z;group.scale.setScalar(scale);
  const pillowCenter=pillow?new THREE.Box3().setFromObject(pillow).getCenter(new THREE.Vector3()):null;
  if(pillowCenter&&pillowCenter.z>center.z)group.rotation.y=Math.PI;
  const offset=new THREE.Vector3(-neutralCenter.x,0,-neutralCenter.z).multiplyScalar(scale).applyAxisAngle(new THREE.Vector3(0,1,0),group.rotation.y);
  const v=new THREE.Vector3();let last=Infinity;
  function pose(angle){
    if(!Number.isFinite(angle))return;angle=THREE.MathUtils.clamp(angle,-Math.PI*.4,Math.PI*.4);if(Math.abs(angle-last)<.0001)return;last=angle;
    const u=Math.min(1,Math.abs(angle)/(Math.PI*.4)),t=u*u*(3-2*u),f=frames[angle<0?1:2];
    nodes.forEach((n,i)=>{n.position.lerpVectors(frames[0][i].p,f[i].p,t);n.quaternion.slerpQuaternions(frames[0][i].q,f[i].q,t);n.scale.copy(frames[0][i].s);n.updateMatrix()});
    group.position.set(center.x+offset.x,bounds.min.y,center.z+offset.z);group.updateMatrixWorld(true);
    for(const m of meshes)if(m.isSkinnedMesh)m.skeleton.update();
    let floor=Infinity;
    for(const m of meshes)for(let i=0;i<m.geometry.attributes.position.count;i++){m.getVertexPosition(i,v);v.applyMatrix4(m.matrixWorld);floor=Math.min(floor,v.y)}
    if(!Number.isFinite(floor))throw new Error('人物骨骼位置无效');
    group.position.y+=bounds.min.y-floor+.001*scale;group.updateMatrixWorld(true);
    for(const m of meshes)if(m.isSkinnedMesh)m.skeleton.update();
  }
  pose(0);person.visible=false;
  return {group,pose};
}
