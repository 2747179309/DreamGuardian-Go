import * as T from 'three';
import {createAnatomicalSleeper} from '../static/cartoon-sleeper.mjs';
const scene=new T.Scene(),person=new T.Mesh(new T.BoxGeometry(.5,.3,1.83));person.position.y=.15;scene.add(person);
const rig=createAnatomicalSleeper(person,scene,null),j=rig.joints;
const point=n=>j[n].getWorldPosition(new T.Vector3());
const pairs=[['leftElbow','leftHand','rightElbow','rightHand',.079],['leftKnee','leftFoot','rightKnee','rightFoot',.11],['leftHand','leftHand','rightHand','rightHand',.10]];
let worst=[],margins=pairs.map(()=>Infinity),lengthError=0;
function distance(a,b,c,d){if(a.distanceToSquared(b)<1e-10&&c.distanceToSquared(d)<1e-10)return a.distanceTo(c);if(c.distanceToSquared(d)<1e-10)return new T.Line3(a,b).closestPointToPoint(c,true,new T.Vector3()).distanceTo(c);let best=Infinity;const line=new T.Line3(c,d);for(let k=0;k<=80;k++){const p=a.clone().lerp(b,k/80);best=Math.min(best,p.distanceTo(line.closestPointToPoint(p,true,new T.Vector3())))}return best;}
for(let k=0;k<=400;k++){
 rig.pose((k/400*2-1)*Math.PI*.4);
 pairs.forEach((p,i)=>{const m=distance(...p.slice(0,4).map(point))-p[4];if(m<margins[i]){margins[i]=m;worst[i]=k}});
 for(const side of ['left','right'])for(const [a,b,l] of [['Shoulder','Elbow',.275],['Elbow','Hand',.245],['Hip','Knee',.38],['Knee','Foot',.36]])lengthError=Math.max(lengthError,Math.abs(point(side+a).distanceTo(point(side+b))-l));
}
console.log({margins,lengthError,worst});
if(margins.some(x=>!Number.isFinite(x)||x<0)||lengthError>1e-5)process.exitCode=1;
