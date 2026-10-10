import * as T from 'three';
import {createAnatomicalSleeper} from '../static/cartoon-sleeper.mjs';
const scene=new T.Scene(),person=new T.Mesh(new T.BoxGeometry(.5,.3,1.83));person.position.y=.15;scene.add(person);
const rig=createAnatomicalSleeper(person,scene,null),j=rig.joints;
let min=Infinity,worst,handMin=Infinity;
for(let k=0;k<=400;k++){
 rig.pose((k/400*2-1)*Math.PI*.4);
 for(const side of ['left','right']){
  const a=j[side+'Elbow'].getWorldPosition(new T.Vector3()),b=j[side+'Hand'].getWorldPosition(new T.Vector3());
  for(const z of [.025,.06,.10]){
   const p=j.spine.worldToLocal(j[side+'Hand'].localToWorld(new T.Vector3(0,0,z)));
   handMin=Math.min(handMin,(p.x/.215)**2+((p.y-.008)/.15)**2+((p.z+.19)/.21)**2);
  }
  for(let i=0;i<=30;i++){
   const p=j.spine.worldToLocal(a.clone().lerp(b,i/30));
   const q=(p.x/.216)**2+((p.y-.008)/.15)**2+((p.z+.19)/.21)**2;
   if(q<min){min=q;worst=[k,side,i]}
  }
 }
}
console.log({forearmTorsoEnvelope:min,handTorsoEnvelope:handMin,worst});if(min<1||handMin<1)process.exitCode=1;
