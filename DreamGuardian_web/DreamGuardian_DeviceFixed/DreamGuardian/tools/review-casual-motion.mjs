import fs from 'node:fs';
import {gzipSync} from 'node:zlib';
import {fixture,THREE as T} from './casual-motion-fixture.mjs';
const f=await fixture();const folder=process.argv[2]||'docs/motion-review/after';fs.mkdirSync(folder,{recursive:true});
const V=new T.Vector3();
function bake(mesh,character=false){
  const g=mesh.geometry,position=[],uv=g.attributes.uv?Array.from(g.attributes.uv.array):[];
  for(let i=0;i<g.attributes.position.count;i++){mesh.getVertexPosition(i,V);V.applyMatrix4(mesh.matrixWorld);position.push(V.x,V.y,V.z)}
  const m=Array.isArray(mesh.material)?mesh.material[0]:mesh.material;
  const result={name:mesh.name,position,uv,index:g.index?Array.from(g.index.array):Array.from({length:g.attributes.position.count},(_,i)=>i),color:m.color?.toArray()||[.6,.6,.6]};
  if(character){
    result.regions=[];
    for(let i=0;i<g.attributes.position.count;i++){
      const weights={leftLeg:0,rightLeg:0,leftArm:0,rightArm:0,head:0};
      for(let c=0;c<4;c++){
        const bone=mesh.skeleton?.bones[g.attributes.skinIndex?.getComponent(i,c)]?.name||'',w=g.attributes.skinWeight?.getComponent(i,c)||0;
        for(const [side,key] of [['Left','left'],['Right','right']]){if(new RegExp('^'+side+'(UpLeg|Leg|Foot|Toe)').test(bone))weights[key+'Leg']+=w;if(new RegExp('^'+side+'(ForeArm|Hand)').test(bone))weights[key+'Arm']+=w}
        if(/^Head/.test(bone))weights.head+=w;
      }
      result.regions.push(Object.keys(weights).find(k=>weights[k]>.9)||'other');
    }
    const mat=f.doc.materials?.find(x=>x.name===m.name);
    const tex=mat?.pbrMetallicRoughness?.baseColorTexture?.index;
    if(tex!==undefined)result.texture=f.doc.images[f.doc.textures[tex].source].uri;
  }
  return result;
}
const joints=[];
for(const degrees of [-72,-36,0,36,72]){
 f.rig.pose(degrees*Math.PI/180);
 const meshes=[];f.rig.group.traverse(o=>{if(o.isMesh)meshes.push(bake(o,true))});
 f.pillow.traverse(o=>{if(o.isMesh)meshes.push(bake(o))});
 for(const o of f.supports)meshes.push(bake(o));
 fs.writeFileSync(`${folder}/pose-${degrees}.json`,JSON.stringify(meshes));
 const row={degrees,person:new T.Box3().setFromObject(f.person).toJSON?.(),pillow:{min:new T.Box3().setFromObject(f.pillow).min.toArray(),max:new T.Box3().setFromObject(f.pillow).max.toArray()},joints:{}};
 f.rig.group.traverse(o=>{if(/^(Hips|Spine\d?|Neck|Head|Left(UpLeg|Leg|Foot|Arm|ForeArm|Hand)|Right(UpLeg|Leg|Foot|Arm|ForeArm|Hand))_\d+$/.test(o.name))row.joints[o.name]=o.getWorldPosition(new T.Vector3()).toArray()});
 joints.push(row);
}
fs.writeFileSync(`${folder}/joints.json`,JSON.stringify(joints,null,2));
console.log('Review snapshots:',folder);console.log(JSON.stringify(joints.map(x=>({degrees:x.degrees,pillow:x.pillow,joints:x.joints})),null,2));
if(process.argv.includes('--audit')){
 const samples=[];
 for(let degrees=-72;degrees<=72;degrees+=3){
  f.rig.pose(degrees*Math.PI/180);const meshes=[];
  f.rig.group.traverse(o=>{if(o.isMesh){const m=bake(o,true);delete m.uv;delete m.texture;meshes.push(m)}});
  samples.push({name:'pose-'+degrees,meshes});
 }
 fs.writeFileSync('docs/motion-review/collision-samples.json.gz',gzipSync(JSON.stringify(samples)));
}
