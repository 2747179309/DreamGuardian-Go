import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Deterministic, local textures: no remote image dependency or per-frame work.
function surface(kind){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const context=canvas.getContext('2d'),pixels=context.createImageData(512,512);
  for(let y=0;y<512;y++)for(let x=0;x<512;x++){
    const noise=((Math.sin(x*127.1+y*311.7)*43758.5453)%1+1)%1;
    const grain=kind==='wood'?Math.sin(y*.27+Math.sin(x*.014)*2+Math.sin(x*.037)*.5)*.5+.5:((x%4<2?1:-1)+(y%4<2?1:-1))*.13+.5;
    const v=kind==='wood'? .77+grain*.18+noise*.05:.88+grain*.08+noise*.04;
    const i=(y*512+x)*4;pixels.data[i]=v*255;pixels.data[i+1]=v*255;pixels.data[i+2]=v*255;pixels.data[i+3]=255;
  }
  context.putImageData(pixels,0,0);const texture=new THREE.CanvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(kind==='wood'?2:5,kind==='wood'?2:5);return texture;
}

export function refineBedroom(root,renderer){
  const environment=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer),env=pmrem.fromScene(environment,.06);environment.dispose();pmrem.dispose();
  const fabric=surface('fabric'),wood=surface('wood');
  const anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());fabric.anisotropy=wood.anisotropy=anisotropy;
  const replacements=new Map(),seams=[];
  root.traverse(object=>{
    if(!object.isMesh)return;
    const refine=source=>{
      if(replacements.has(source))return replacements.get(source);
      const material=source.clone(),name=source.name.toLowerCase();
      if(/linen|cotton|sleepwear/.test(name)){
        material.map=null;material.normalMap=null;material.bumpMap=fabric;material.bumpScale=.0015;material.roughness=.92;material.metalness=0;
        material.color.set(/sage/.test(name)?'#91a79d':/sleepwear/.test(name)?'#647e8b':/lampshade/.test(name)?'#e5d5b3':'#e4dfd1');
      }
      if(/oak|walnut/.test(name)){
        material.map=wood;material.normalMap=null;material.bumpMap=wood;material.bumpScale=.002;material.roughness=.53;material.metalness=0;material.color.set(/walnut/.test(name)?'#735441':'#a28a69');
      }
      if(/plaster/.test(name)){material.bumpMap=fabric;material.bumpScale=.0006;material.color.set('#d5cec1')}
      if(/porcelain|brass|phone|tea/.test(name)){material.envMap=env.texture;material.envMapIntensity=.45}
      if(material.map)material.map.anisotropy=anisotropy;
      replacements.set(source,material);return material;
    };
    object.material=Array.isArray(object.material)?object.material.map(refine):refine(object.material);
    const name=object.name.toLowerCase().replace(/[^a-z0-9]/g,'');
    // Move the hanging fabric and its rail together in front of the deep sill.
    // Original fabric min X -4.577; sill front X -4.450 (model metres).
    if(name.startsWith('linencurtain')||name==='curtainrail')object.position.x+=.16;
    // Keep the original object and transforms: sensor anchors and picking survive.
    if(name==='pillow'||name==='cover'||name==='foldedfootthrow'){
      object.geometry.computeBoundingBox();const bounds=object.geometry.boundingBox,size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
      const min=Math.min(size.x,size.y,size.z);if(min<=0)return;
      const geometry=new RoundedBoxGeometry(size.x,size.y,size.z,6,min*.35),position=geometry.attributes.position;
      // The thinnest local axis is cloth thickness (Blender's up axis varies).
      const axes=['x','y','z'].sort((a,b)=>size[a]-size[b]),thin=axes[0],u=axes[1],v=axes[2];
      const point=new THREE.Vector3();
      for(let i=0;i<position.count;i++){
        point.fromBufferAttribute(position,i);const a=point[u]/size[u],b=point[v]/size[v],edge=Math.max(0,1-4*a*a)*Math.max(0,1-4*b*b);
        if(name==='pillow')point[thin]+=Math.sign(point[thin])*min*.18*edge;
        else point[thin]+=min*.13*(Math.sin(a*21+b*8)+.5*Math.sin(b*37-a*5))*edge;
        point.add(center);position.setXYZ(i,point.x,point.y,point.z);
      }
      geometry.computeVertexNormals();object.geometry=geometry;
      const perimeter=[[-.42,-.47],[.42,-.47],[.48,-.40],[.48,.40],[.42,.47],[-.42,.47],[-.48,.40],[-.48,-.40]].map(([a,b])=>{const p=center.clone();p[u]+=size[u]*a;p[v]+=size[v]*b;p[thin]+=min*.06;return p});
      const seam=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(perimeter,true),96,min*.017,5,true),new THREE.MeshStandardMaterial({color:name==='pillow'?'#b9b4a8':'#6e8479',roughness:1}));
      seam.name=object.name+' tailored seam';seams.push([object,seam]);
    }
  });
  seams.forEach(([parent,seam])=>parent.add(seam));
  return env.texture;
}
