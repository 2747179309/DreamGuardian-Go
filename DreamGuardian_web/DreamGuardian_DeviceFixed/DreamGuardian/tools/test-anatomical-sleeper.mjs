import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createAnatomicalSleeper} from '../static/anatomical-sleeper.mjs';
const scene=new THREE.Scene(),person=new THREE.Mesh(new THREE.BoxGeometry(.6,.3,1.83));
person.position.set(1,.7,2);scene.add(person);
const plane=new THREE.Box3().setFromObject(person).min.y;
const rig=createAnatomicalSleeper(person,scene);
assert.equal(person.visible,false);
assert.ok(Object.keys(rig.joints).length>=16);
const initial=new THREE.Box3().setFromObject(rig.group);
const v=new THREE.Vector3();
for(const angle of [-.96,-.6,0,.6,.96,0]){
  rig.pose(angle);rig.group.updateWorldMatrix(true,true);
  let minimum=Infinity;
  rig.group.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const p=mesh.geometry.attributes.position;
    for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);assert.ok(Number.isFinite(v.x+v.y+v.z));minimum=Math.min(minimum,v.y)}
  });
  assert.ok(Math.abs(minimum-plane)<1e-6,'mesh rests on mattress at every pose');
  for(const name of ['leftKnee','rightKnee'])assert.equal(rig.joints[name].position.z,.38,'thigh length remains fixed');
  if(angle!==0){assert.ok(rig.joints.leftKnee.rotation.x>0);assert.notEqual(rig.joints.leftKnee.rotation.x,rig.joints.rightKnee.rotation.x,'side lying legs are staggered')}
}
const final=new THREE.Box3().setFromObject(rig.group);
assert.ok(final.min.distanceTo(initial.min)<1e-6&&final.max.distanceTo(initial.max)<1e-6,'neutral pose restores');
const torso=rig.group.getObjectByName('anatomical torso');
assert.ok(torso.geometry.attributes.normal.getX(0)>0,'surface normals point outwards');
console.log('PASS: anatomy joints, fixed limb lengths, asymmetric side poses, mattress support, finite vertices, restoration, normals');
