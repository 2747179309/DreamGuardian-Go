import fs from 'node:fs';import * as T from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {attachCasualSleeper} from '../static/casual-sleeper.mjs';
globalThis.ProgressEvent=class{constructor(type,p){Object.assign(this,p)}};
const path='static/models/casual-man/',doc=JSON.parse(fs.readFileSync(path+'SUPINE.gltf'));
// Geometry-only loader test: texture bytes are separately checked by the pack audit.
doc.buffers[0].uri='data:application/octet-stream;base64,'+fs.readFileSync(path+'scene.bin').toString('base64');delete doc.images;delete doc.textures;delete doc.materials;for(const m of doc.meshes)for(const p of m.primitives)delete p.material;
const gltf=await new GLTFLoader().parseAsync(JSON.stringify(doc),'');const scene=new T.Scene(),person=new T.Mesh(new T.BoxGeometry(.5,.2,1.8));person.position.y=.1;scene.add(person);const rig=await attachCasualSleeper(person,scene,null,gltf,JSON.parse(fs.readFileSync(path+'poses.json')));
let min=Infinity,max=0;for(let i=0;i<=120;i++){rig.pose((i/120*2-1)*Math.PI*.4);const box=new T.Box3().setFromObject(rig.group,true);min=Math.min(min,box.min.y);max=Math.max(max,box.max.y);if(!Number.isFinite(box.min.x)||box.min.y<-.00001)throw Error('invalid pose / mattress intersection')}
if(person.visible)throw Error('old model visible');console.log('121 poses: finite deformed bounds, mattress clearance, old model hidden.',{min,max});
