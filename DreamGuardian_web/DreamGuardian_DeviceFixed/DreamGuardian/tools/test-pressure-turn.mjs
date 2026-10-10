import assert from 'node:assert/strict';
import * as THREE from 'three';
import {PressureTurn,createSleeperRig} from '../static/pressure-turn.mjs';
const turn=new PressureTurn();let now=100000;
// The main movement should take roughly three seconds, with a gentle start.
const paced=new PressureTurn();paced.valid=true;paced.side=1;paced.lastValid=0;
for(let i=1;i<=60;i++)paced.step(1/60,i*1000/60);
assert(paced.angle>.4*Math.PI*.4&&paced.angle<.6*Math.PI*.4,'gentle first second');
for(let i=61;i<=180;i++)paced.step(1/60,i*1000/60);
assert(paced.angle>.96*Math.PI*.4&&paced.angle<Math.PI*.4,'settles without overshoot');
function feed(zones,frames=300,extra={}){for(let i=0;i<frames;i++){now+=1000/60;if(i%15===0)turn.ingest({sample:{connected:true,presence:true,...extra},pillow:{received_at:now/1000,pressure_zones:zones}},now);turn.step(1/60,now)}}
feed([80,25,5,80,25,5]);assert.equal(turn.side,-1);assert.ok(turn.angle<-.85);
const left=turn.angle;feed([5,25,80,5,25,80],15);assert.ok(Math.abs(turn.angle-left)<.1,'no instant reversal');
feed([5,25,80,5,25,80]);assert.equal(turn.side,1);assert.ok(turn.angle>.85);
feed([30,70,30,30,70,30]);assert.equal(turn.side,0);assert.ok(Math.abs(turn.angle)<.03);
for(let i=0;i<10;i++)feed(i%2?[31,70,29,31,70,29]:[29,70,31,29,70,31],15);
assert.equal(turn.side,0,'small fluctuations do not turn the body');
feed([80,25,5,80,25,5]);const frozen=turn.angle;feed([0,0,0,0,0,0]);assert.equal(turn.angle,frozen);assert.equal(turn.valid,false);
feed([5,25,80,5,25,80],60,{presence:false});assert.equal(turn.angle,frozen);
feed([5,25,null,5,25,80]);assert.equal(turn.valid,false);
feed([5,25,80,5,25,80]);turn.step(.02,now+5000);assert.equal(turn.valid,false);
feed([5,25,80,5,25,80]);turn.paused=true;const paused=turn.angle;feed([80,25,5,80,25,5]);assert.equal(turn.angle,paused);
const scene=new THREE.Scene(),person=new THREE.Mesh(new THREE.BoxGeometry(.6,.3,1.8),new THREE.MeshStandardMaterial());person.position.set(-1,.7,0);scene.add(person);
const face=new THREE.Mesh(new THREE.SphereGeometry(.08),new THREE.MeshStandardMaterial());face.position.set(0,.13,.8);person.add(face);
const original=new THREE.Box3().setFromObject(person);const rig=createSleeperRig(person,scene);assert.equal(rig.group.children.length,2);
for(const a of [-.96,0,.96,0]){rig.pose(a);const b=new THREE.Box3().setFromObject(rig.group);assert.ok(Math.abs(b.min.y-original.min.y)<1e-5,'body stays on resting plane');assert.ok(Number.isFinite(b.max.x));}
assert.ok(new THREE.Box3().setFromObject(rig.group).min.distanceTo(original.min)<1e-5,'neutral pose restores without drift');
console.log('PASS: left/right/neutral animation, reversal smoothing, noise, no contact, away, missing, stale, pause, attached details, bed contact and neutral restoration');
