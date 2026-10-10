import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {attachCasualSleeper} from './casual-motion.mjs';
export {attachCasualSleeper};
const base='/static/models/casual-man/',version='supported-roll-20260924';
export async function createAnatomicalSleeper(person,scene,pillow){
  const response=await fetch(base+'poses.json?v='+version);if(!response.ok)throw new Error('人物睡姿文件加载失败');
  const poses=await response.json(),gltf=await new GLTFLoader().loadAsync(base+'SUPINE.gltf?v='+version);
  const supports=[];
  scene.traverse(o=>{if(o.isMesh&&(/^(cover_|bedSingle_2$)/.test(o.name)||o.name==='Folded_foot_throw'))supports.push(o)});
  return attachCasualSleeper(person,scene,pillow,gltf,poses,{supports});
}
