import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createAnatomicalSleeper} from '../static/wooden-sleeper.mjs';
const scene=new THREE.Scene(),person=new THREE.Mesh(new THREE.BoxGeometry(.6,.3,1.83));
person.position.set(1,.7,2);scene.add(person);
const floor=new THREE.Box3().setFromObject(person).min.y,rig=createAnatomicalSleeper(person,scene);
assert.equal(person.visible,false);assert.ok(Object.keys(rig.joints).length>40);
const initial=new THREE.Box3().setFromObject(rig.group),point=new THREE.Vector3();
let previous=null,maxStep=0;
for(let frame=0;frame<=240;frame++){
  const angle=Math.PI*.4*Math.sin(frame/240*Math.PI*2);rig.pose(angle);
  const box=new THREE.Box3().setFromObject(rig.group);
  assert.ok(Math.abs(box.min.y-floor)<1e-6,'support stays on bed');
  for(const s of ['left','right']){
    const shoulder=rig.joints[s+'Shoulder'].getWorldPosition(new THREE.Vector3()),elbow=rig.joints[s+'Elbow'].getWorldPosition(new THREE.Vector3()),wrist=rig.joints[s+'Hand'].getWorldPosition(new THREE.Vector3());
    assert.ok(Math.abs(shoulder.distanceTo(elbow)-.275)<1e-6);
    assert.ok(Math.abs(elbow.distanceTo(wrist)-.245)<1e-6);
    const hip=rig.joints[s+'Hip'].getWorldPosition(new THREE.Vector3()),knee=rig.joints[s+'Knee'].getWorldPosition(new THREE.Vector3()),ankle=rig.joints[s+'Foot'].getWorldPosition(new THREE.Vector3());
    assert.ok(Math.abs(hip.distanceTo(knee)-.38)<1e-6);assert.ok(Math.abs(knee.distanceTo(ankle)-.36)<1e-6);
    assert.ok(wrist.y-floor<.25,'hands remain near mattress');
  }
  rig.joints.leftHand.getWorldPosition(point);
  if(previous)maxStep=Math.max(maxStep,point.distanceTo(previous));previous=point.clone();
}
assert.ok(maxStep<.04,'no IK jumps through roll reversal');
rig.pose(0);const restored=new THREE.Box3().setFromObject(rig.group);assert.ok(restored.min.distanceTo(initial.min)<1e-6);
let vertices=0;rig.group.traverse(m=>{if(m.isMesh){vertices+=m.geometry.attributes.position.count;assert.ok(m.geometry.attributes.normal)}});
console.log('PASS: full left/right cycle, fixed limb lengths, bed support, low hands, continuous IK, neutral restoration. Vertices:',vertices,'max hand step:',maxStep.toFixed(4));
