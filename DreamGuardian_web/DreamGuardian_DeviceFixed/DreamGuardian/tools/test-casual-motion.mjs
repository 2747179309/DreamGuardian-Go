import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fixture,THREE as T} from './casual-motion-fixture.mjs';
const {rig,person}=await fixture();
const names=['Head','Neck','LeftArm','RightArm','LeftUpLeg','RightUpLeg','LeftLeg','RightLeg','LeftFoot','RightFoot','LeftToeBase','RightToeBase'];
const lengths=new Map(),saved=new Map();let previous,maxStep=0,minClearance=Infinity,maxHeadGap=0,maxSafetyLift=0;
const start=performance.now();
for(let degree=-72;degree<=72;degree++){
 rig.pose(degree*Math.PI/180);
 const points=names.map(name=>rig.joints[name].getWorldPosition(new T.Vector3()));
 points.forEach((p,i)=>{assert(p.toArray().every(Number.isFinite));if(previous)maxStep=Math.max(maxStep,p.distanceTo(previous[i]))});
 for(const side of ['Left','Right'])for(const [a,b] of [['UpLeg','Leg'],['Leg','Foot'],['Foot','ToeBase']]){
  const key=side+a+b,length=rig.joints[side+a].getWorldPosition(new T.Vector3()).distanceTo(rig.joints[side+b].getWorldPosition(new T.Vector3()));
  if(!lengths.has(key))lengths.set(key,length);assert(Math.abs(length-lengths.get(key))<1e-6,'Leg/foot segment stretched');
 }
 assert(rig.diagnostics.bedClearance>=.00149,'Bed or pillow penetration');
 assert(rig.diagnostics.legGap>=.0039,'Leg contact envelopes overlap');
 minClearance=Math.min(minClearance,rig.diagnostics.bedClearance);maxHeadGap=Math.max(maxHeadGap,rig.diagnostics.headClearance);maxSafetyLift=Math.max(maxSafetyLift,rig.diagnostics.safetyLift);
 saved.set(degree,points);previous=points;
}
const elapsed=performance.now()-start;
for(let degree=72;degree>=-72;degree--){rig.pose(degree*Math.PI/180);names.forEach((name,i)=>assert(rig.joints[name].getWorldPosition(new T.Vector3()).distanceTo(saved.get(degree)[i])<1e-8,'Reverse motion drift'))}
assert(!person.visible);assert(maxStep<.04,'Abrupt joint jump');assert(maxHeadGap<.012,'Head floats above pillow');
const result={sampledPoses:145,reversePoses:145,minClearance,maxHeadGap,maxSafetyLift,maxJointStepPerDegree:maxStep,averagePoseMs:elapsed/145};
fs.writeFileSync('docs/motion-review/validation.json',JSON.stringify(result,null,2));console.log(result);
