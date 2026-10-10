import json,pathlib,sys,gzip
from mathutils.bvhtree import BVHTree
root=pathlib.Path(__file__).resolve().parents[1]
folder=root/'docs/motion-review/after'
results=[]
samples=json.loads(gzip.decompress((folder.parent/'collision-samples.json.gz').read_bytes()))
for sample in samples:
 regions={k:[[],[]] for k in ['leftLeg','rightLeg','leftArm','rightArm','head']}
 for mesh in sample['meshes']:
  if not mesh.get('regions'):continue
  p=mesh['position'];verts=[p[i:i+3] for i in range(0,len(p),3)];idx=mesh['index'];labels=mesh['regions']
  for name,(v,f) in regions.items():
   offset=len(v);v.extend(verts)
   for i in range(0,len(idx),3):
    tri=idx[i:i+3]
    if all(labels[j]==name for j in tri):f.append([j+offset for j in tri])
 trees={k:BVHTree.FromPolygons(v,f,all_triangles=True) for k,(v,f) in regions.items()}
 for a,b in [('leftLeg','rightLeg'),('leftArm','rightArm'),('leftArm','head'),('rightArm','head')]:
  hits=trees[a].overlap(trees[b]);row={'pose':sample['name'],'pair':[a,b],'intersections':len(hits)}
  if hits:
   v,f=regions[a];pts=[v[j] for i,_ in hits for j in f[i]];row['bounds']=[[min(p[k] for p in pts) for k in range(3)],[max(p[k] for p in pts) for k in range(3)]]
  results.append(row)
print(json.dumps(results,indent=2));(folder.parent/'intersections.json').write_text(json.dumps(results,indent=2))
assert not any(r['intersections'] for r in results),'Intersecting limb triangles'
