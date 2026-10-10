import * as THREE from 'three';

// Enlarge the bed in room coordinates, retaining its head end and surface height.
export function enlargeBed(room) {
  if (room.userData.bedEnlarged) return;
  room.updateWorldMatrix(true, true);
  let bed;
  const parts=[];
  room.traverse(object=>{
    const name=object.name.toLowerCase().replace(/[^a-z0-9]/g,'');
    if(name==='bedsingle')bed=object;
    if(['bedsingle','cover','foldedfootthrow'].includes(name))parts.push(object);
  });
  if(!bed)return;
  const box=new THREE.Box3().setFromObject(bed),pivot=box.getCenter(new THREE.Vector3());
  pivot.y=0;pivot.z=box.max.z;
  const transform=new THREE.Matrix4().makeTranslation(pivot.x,0,pivot.z)
    .multiply(new THREE.Matrix4().makeScale(1.20,1,1.10))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x,0,-pivot.z));
  const seen=new Set();
  for(const part of parts)part.traverse(mesh=>{
    if(!mesh.isMesh||seen.has(mesh))return;seen.add(mesh);
    const local=mesh.matrixWorld.clone().invert().multiply(transform).multiply(mesh.matrixWorld);
    mesh.geometry=mesh.geometry.clone().applyMatrix4(local);
    mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
  });
  room.userData.bedEnlarged=true;
}
