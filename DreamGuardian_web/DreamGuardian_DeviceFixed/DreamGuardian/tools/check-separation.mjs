import assert from 'node:assert/strict';
import * as T from 'three';
import {createAnatomicalSleeper} from '../static/wooden-sleeper.mjs';
const scene=new T.Scene(),person=new T.Mesh(new T.BoxGeometry(.6,.3,1.83));scene.add(person);const r=createAnatomicalSleeper(person,scene);
let min=Infinity,where='',hand=0;
for(let f=0;f<=400;f++){
 const a=-Math.PI*.4+f/400*Math.PI*.8;r.pose(a);
 const p=n=>r.joints[n].getWorldPosition(new T.Vector3());
 for(const l of [['Hip','Knee',.077],['Knee','Foot',.054]])for(const q of [['Hip','Knee',.077],['Knee','Foot',.054]]){
 for(let i=2;i<=18;i++)for(let j=2;j<=18;j++){
 const d=p('left'+l[0]).lerp(p('left'+l[1]),i/20).distanceTo(p('right'+q[0]).lerp(p('right'+q[1]),j/20))-l[2]-q[2];if(d<min){min=d;where=[a,l[0],q[0],i,j].join(',')}
 }
 }
 hand=Math.max(hand,p('leftHand').y+.15,p('rightHand').y+.15);
}
console.log({min,where,hand});

assert.ok(min > 0, 'opposite thigh/calf envelopes must remain separated over the roll');
