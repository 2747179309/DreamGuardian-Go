"""Render the exact deformed web meshes, including the actual bed and pillow."""
import bpy,json,pathlib,sys
from mathutils import Vector
root=pathlib.Path(__file__).resolve().parents[1]
folder=root/(sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else 'docs/motion-review/after')
bpy.ops.wm.read_factory_settings(use_empty=True)
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=16
s.render.resolution_x=1100;s.render.resolution_y=800;s.render.resolution_percentage=100
s.world=bpy.data.worlds.new('Review world');s.world.use_nodes=True
s.world.node_tree.nodes['Background'].inputs[0].default_value=(.38,.38,.38,1)
bpy.ops.object.camera_add();cam=bpy.context.object;s.camera=cam;cam.data.type='ORTHO'
for loc,power in [((2,-1,5),550),((-3,2,3),300)]:
 bpy.ops.object.light_add(type='AREA',location=loc);bpy.context.object.data.energy=power;bpy.context.object.data.size=4
objects=[]
for deg in [-72,-36,0,36,72]:
 for o in objects:bpy.data.objects.remove(o,do_unlink=True)
 objects=[];bodypts=[]
 for i,row in enumerate(json.loads((folder/f'pose-{deg}.json').read_text())):
  v=row['position'];verts=[(v[j],-v[j+2],v[j+1]) for j in range(0,len(v),3)]
  ind=row['index'];faces=[ind[j:j+3] for j in range(0,len(ind),3)]
  m=bpy.data.meshes.new(row['name']);m.from_pydata(verts,[],faces);m.update()
  ob=bpy.data.objects.new(row['name'],m);s.collection.objects.link(ob);objects.append(ob)
  if i<10:bodypts.extend(Vector(p) for p in verts)
  mat=bpy.data.materials.new(row['name']);mat.use_nodes=True
  bs=mat.node_tree.nodes['Principled BSDF'];bs.inputs['Base Color'].default_value=tuple(row['color'])+(1,);bs.inputs['Roughness'].default_value=.8
  if row.get('texture'):
   tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(root/'static/models/casual-man'/row['texture']),check_existing=True)
   mat.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
  ob.data.materials.append(mat)
  if row['uv']:
   uv=m.uv_layers.new()
   for poly in m.polygons:
    poly.use_smooth=True
    for li in poly.loop_indices:
     vi=m.loops[li].vertex_index;uv.data[li].uv=row['uv'][2*vi:2*vi+2]
 lo=Vector([min(p[k] for p in bodypts) for k in range(3)]);hi=Vector([max(p[k] for p in bodypts) for k in range(3)]);center=(lo+hi)*.5
 for view,axis in [('oblique',(1,1,.85)),('top',(0,0,1))]:
  cam.location=center+Vector(axis).normalized()*5;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler()
  bpy.context.view_layer.update();R=cam.matrix_world.to_3x3();right=R@Vector((1,0,0));up=R@Vector((0,1,0))
  cam.data.ortho_scale=2*max(max(abs((p-center).dot(right)) for p in bodypts),max(abs((p-center).dot(up)) for p in bodypts)*1100/800)*1.18
  s.render.filepath=str(folder/f'pose-{deg}-{view}.png');bpy.ops.render.render(write_still=True)
