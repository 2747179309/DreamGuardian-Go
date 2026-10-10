import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {attachCasualSleeper} from '../static/casual-sleeper.mjs';
import {enlargeBed} from '../static/bed-size.mjs';
export {THREE};
globalThis.ProgressEvent??=class {constructor(type,data){Object.assign(this,data)}};
function untextured(doc,binary){
  doc=structuredClone(doc);doc.buffers[0].uri='data:application/octet-stream;base64,'+binary.toString('base64');
  delete doc.images;delete doc.textures;delete doc.samplers;
  for(const mat of doc.materials||[]){
    for(const key of Object.keys(mat))if(key.toLowerCase().includes('texture'))delete mat[key];
    for(const key of Object.keys(mat.pbrMetallicRoughness||{}))if(key.includes('Texture'))delete mat.pbrMetallicRoughness[key];
    delete mat.extensions;
  }
  return doc;
}
export async function fixture(){
  const base='static/models/casual-man/',doc=JSON.parse(fs.readFileSync(base+'SUPINE.gltf'));
  const gltf=await new GLTFLoader().parseAsync(JSON.stringify(untextured(doc,fs.readFileSync(base+'scene.bin'))),'');
  const bytes=fs.readFileSync('static/models/bedroom.glb'),len=bytes.readUInt32LE(12);
  const roomDoc=JSON.parse(bytes.subarray(20,20+len));
  const room=(await new GLTFLoader().parseAsync(JSON.stringify(untextured(roomDoc,bytes.subarray(28+len))), '')).scene;
  let box=new THREE.Box3().setFromObject(room),size=box.getSize(new THREE.Vector3());
  room.scale.multiplyScalar(5.6/Math.max(size.x,size.z));room.updateMatrixWorld(true);
  box=new THREE.Box3().setFromObject(room);const c=box.getCenter(new THREE.Vector3());
  room.position.set(-c.x,-box.min.y,-c.z);room.updateMatrixWorld(true);
  enlargeBed(room);
  let person,pillow;const supports=[];
  room.traverse(o=>{const n=o.name.toLowerCase().replace(/[^a-z0-9]/g,'');
    if(n==='plane007')person=o;if(n==='pillow')pillow=o;
    if(o.isMesh&&(/^(cover_|bedSingle_2$)/.test(o.name)||n==='foldedfootthrow'))supports.push(o);
  });
  const scene=new THREE.Scene();scene.add(room);
  const poses=JSON.parse(fs.readFileSync(base+'poses.json'));
  const rig=await attachCasualSleeper(person,scene,pillow,gltf,poses,{supports});
  return {scene,room,person,pillow,supports,gltf,rig,doc};
}
