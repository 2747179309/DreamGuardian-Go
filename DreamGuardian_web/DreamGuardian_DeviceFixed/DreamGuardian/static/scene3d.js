import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { refineBedroom } from './bedroom-detail.js';
import { PressureTurn } from './pressure-turn.mjs';
import { createAnatomicalSleeper } from './casual-sleeper.mjs';
import { enlargeBed } from './bed-size.mjs';

const container = document.getElementById('twin-canvas');

if (!container) {
  console.warn('DreamGuardian 3D: #twin-canvas not found');
} else {
  const ui = {
    loading: document.getElementById('twin-loading'),
    status: document.getElementById('twin-status'),
    title: document.getElementById('twin-title'),
    description: document.getElementById('twin-description'),
    labels: [1, 2, 3].map(index => document.getElementById(`twin-metric-label-${index}`)),
    values: [1, 2, 3].map(index => document.getElementById(`twin-metric-value-${index}`)),
    zoneBlock: document.getElementById('twin-zone-block'),
    zoneSummary: document.getElementById('twin-zone-summary'),
    lightControl: document.getElementById('twin-light-control'),
    lightSlider: document.getElementById('twin-light-slider'),
    lightValue: document.getElementById('twin-light-value')
  };

  if (location.protocol === 'file:') {
    ui.status.textContent = '请使用启动Windows离线演示.bat';
    ui.status.className = 'twin-status error';
    const message = ui.loading.querySelector('span');
    if (message) message.textContent = '浏览器禁止 file:// 加载 GLB 和模块';
    throw new Error('3D preview requires HTTP; run 启动Windows离线演示.bat');
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  const constrainedRenderer = /Firefox\//.test(navigator.userAgent);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: !constrainedRenderer, alpha: true, powerPreference: 'high-performance' });
  } catch (error) {
    ui.status.textContent = '浏览器不支持 WebGL';
    ui.status.className = 'twin-status error';
    const message = ui.loading.querySelector('span');
    if (message) message.textContent = '请启用硬件加速或更换 Chrome/Edge';
    console.error('DreamGuardian 3D WebGL initialization failed', error);
    throw error;
  }
  renderer.setPixelRatio(constrainedRenderer ? 0.8 : Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = !constrainedRenderer;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', '卧室三维模型，拖动旋转，滚轮或双指缩放，点击对象查看状态');
  container.prepend(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.minPolarAngle = Math.PI * 0.15;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.zoomToCursor = true;

  scene.add(new THREE.HemisphereLight(0xe5eaf0, 0x938779, 1.25));
  scene.add(new THREE.AmbientLight(0xfff4e7, 0.20));
  const keyLight = new THREE.DirectionalLight(0xfff0db, 2.5);
  // Illuminate through the open side, not through the rear wall, which would
  // cast the whole interior into shadow in the furnished bedroom model.
  keyLight.position.set(4, 8, -5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.radius = 3;
  keyLight.shadow.bias = -0.0001;
  keyLight.shadow.normalBias = 0.012;
  keyLight.shadow.camera.near = 0.1;
  keyLight.shadow.camera.far = 30;
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xe6edf5, 0.80);
  fillLight.position.set(-2, 4, -4);
  scene.add(fillLight);
  const lampMaxIntensity = 2.4;
  const lampPreview = new THREE.PointLight(0xffcf99, Number(ui.lightSlider.value) / 100 * lampMaxIntensity, 6, 2);
  scene.add(lampPreview);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const targets = new Map();
  const heatSpots = [];
  const heatMaterials = [];
  let modelRoot = null;
  let pillowObject = null;
  let selectionHelper = null;
  let selectedType = 'room';
  let latestData = window.__dreamguardianLatest || null;
  let homeView = null;
  let cameraTween = null;
  let pointerStart = null;
  const pressureTurn = new PressureTurn();
  let sleeperRig = null, lastMotionFrame = 0, lastMotionLabel = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const motionPanel = document.createElement('div');
  motionPanel.className='twin-turn-panel';
  motionPanel.innerHTML='<strong>枕压驱动 · 翻身模拟</strong><p id="twin-turn-state">等待六点枕压</p><div class="twin-turn-track" aria-hidden="true"><i></i></div><small>枕头左侧 ← 压力重心 → 右侧</small><button type="button" aria-pressed="false">暂停动画</button><small>根据压力分布估计姿态，不代表实际体位识别。</small>';
  ui.zoneBlock.before(motionPanel);
  const turnLabel=motionPanel.querySelector('p'),turnMarker=motionPanel.querySelector('i');
  motionPanel.querySelector('button').onclick=event=>{pressureTurn.paused=!pressureTurn.paused;event.currentTarget.textContent=pressureTurn.paused?'继续动画':'暂停动画';event.currentTarget.setAttribute('aria-pressed',String(pressureTurn.paused));};

  const sleepStateNames = {
    awake: '清醒', transition: '入睡过渡', light_trend: '浅睡趋势',
    deep_trend: '深睡趋势', out_of_bed: '离床'
  };

  function classifyObject(name = '') {
    const normalized = name.toLowerCase();
    const compact = normalized.replace(/[^a-z0-9]/g, '');
    if (compact.includes('xiaomeng') || compact.includes('dreamguardianbedsideunit') || compact === 'deviceface' || compact === 'deviceindicator') return 'xiaomeng';
    if (normalized.includes('pillow')) return 'pillow';
    if (normalized.includes('light_stand') || normalized.includes('lamp')) return 'lamp';
    // The human mesh keeps Blender's exported name in bedroom.glb.
    // GLTFLoader may sanitize Plane.007 to Plane007, so match both forms.
    if (compact === 'plane007' || normalized.includes('person') || normalized.includes('human')) return 'person';
    return null;
  }

  function setMetric(index, label, value) {
    ui.labels[index].textContent = label;
    ui.values[index].textContent = value;
  }

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function fixed(value, digits = 1, suffix = '') {
    const number = finite(value);
    return number == null ? '--' : `${number.toFixed(digits)}${suffix}`;
  }

  function pressurePercent(value) {
    const number = finite(value);
    if (number == null) return null;
    return THREE.MathUtils.clamp(number <= 1 ? number * 100 : number, 0, 100);
  }

  function heatColor(ratio) {
    const value = THREE.MathUtils.clamp(ratio, 0, 1);
    if (value < 0.4) return new THREE.Color(0x2e77e6).lerp(new THREE.Color(0x22d3c5), value / 0.4);
    if (value < 0.7) return new THREE.Color(0x22d3c5).lerp(new THREE.Color(0xffd95b), (value - 0.4) / 0.3);
    return new THREE.Color(0xffd95b).lerp(new THREE.Color(0xef5147), (value - 0.7) / 0.3);
  }

  let heatCanvas=null,heatTexture=null;
  function updatePressureHeatmap(pillow) {
    if (!pillowObject || !heatSpots.length) return;
    const zones=window.DGPressureField.values(pillow?.pressure_zones??latestData?.sample?.pressure_matrix);
    const valid=zones&&zones.some(v=>v!=null);
    heatSpots[0].visible=!!valid;
    if(valid){DGPressureField.raster(heatCanvas.getContext('2d'),zones,180,108,true);heatTexture.needsUpdate=true;}
    heatMaterials.forEach(material=>{if(material.emissive)material.emissiveIntensity=0;});
    ui.zoneSummary.textContent=valid?'上排 '+zones.slice(0,3).map((v,i)=>'P'+(i+1)+' '+(v==null?'--':Math.round(v)+'%')).join(' · ')+'\n下排 '+zones.slice(3).map((v,i)=>'P'+(i+4)+' '+(v==null?'--':Math.round(v)+'%')).join(' · '):'等待六点压力数据';
  }

  function updateInspector() {
    const sample = latestData && latestData.sample || {};
    const pillow = latestData && latestData.pillow || null;
    ui.lightControl.hidden = selectedType !== 'lamp';
    document.getElementById('twin-volume-control').hidden = selectedType !== 'xiaomeng';
    ui.zoneBlock.hidden = selectedType === 'lamp' || selectedType === 'xiaomeng';

    if (selectedType === 'xiaomeng') {
      ui.title.textContent = '小梦 · 床头设备';
      ui.description.textContent = '调节助眠音量，与设备控制页同步。';
      setMetric(0, '控制对象', '小梦音频设备');
      setMetric(1, '调节范围', '0–100%');
      setMetric(2, '控制方式', '设备回执确认');
    } else if (selectedType === 'pillow') {
      const receivedAt = finite(pillow && pillow.received_at);
      const isFresh = receivedAt != null && Date.now() / 1000 - receivedAt < 5;
      ui.title.textContent = '智能枕头';
      ui.description.textContent = '上下各 3 个测点，平滑估算接触热区；头部运动由 IMU 提供。';
      setMetric(0, '枕头连接', pillow ? (isFresh ? '在线' : '数据延迟') : '等待数据');
      setMetric(1, '压力接触', pillow ? fixed(pressurePercent(pillow.pressure_contact), 0, '%') : '--');
      setMetric(2, '头部运动', pillow ? fixed(pillow.imu_motion, 3) : '--');
    } else if (selectedType === 'person') {
      ui.title.textContent = '睡眠床体';
      ui.description.textContent = '汇总 DreamGuardian 的非接触生命体征与当前睡眠状态。';
      setMetric(0, '睡眠状态', sleepStateNames[sample.sleep_state] || sample.sleep_state || '--');
      setMetric(1, '心率', fixed(sample.heart_bpm, 1, ' BPM'));
      setMetric(2, '呼吸率', fixed(sample.breath_bpm, 1, ' 次/分'));
    } else if (selectedType === 'lamp') {
      ui.title.textContent = '床头灯光';
      ui.description.textContent = '拖动滑块预览灯光；真实设备需通过控制页操作。';
      setMetric(0, '灯光预览', `${ui.lightSlider.value}%`);
      setMetric(1, '干预动作', sample.intervention_action || 'none');
      setMetric(2, '真实输出', sample.intervention_action === 'night_path' ? '夜灯模式' : '待机');
    } else {
      ui.title.textContent = '卧室全景';
      ui.description.textContent = '点击枕头、人体或床头灯，查看对应传感器与设备状态。';
      setMetric(0, '模型状态', modelRoot ? '已加载' : '加载中');
      setMetric(1, '实时数据', sample.connected === true ? '设备在线' : '等待连接');
      setMetric(2, '交互对象', modelRoot ? '枕头 · 人体 · 灯光' : '--');
    }
    if (selectedType === 'person') {
      ui.title.textContent = '睡眠用户';
      ui.description.textContent = '六点枕压驱动连续翻身；头肩与下半身平滑跟随，显示压力变化对应的模拟姿态。';
    }
    updatePressureHeatmap(pillow);
  }

  function makeHeatSpots() {
    if(!pillowObject)return;
    pillowObject.updateWorldMatrix(true,true);
    const box=new THREE.Box3().setFromObject(pillowObject),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
    heatCanvas=document.createElement('canvas');heatCanvas.width=180;heatCanvas.height=108;
    heatTexture=new THREE.CanvasTexture(heatCanvas);heatTexture.colorSpace=THREE.SRGBColorSpace;
    const material=new THREE.MeshBasicMaterial({map:heatTexture,transparent:true,depthWrite:false,side:THREE.DoubleSide,toneMapped:false});
    const field=new THREE.Mesh(new THREE.PlaneGeometry(size.x*.98,size.z*.98),material);
    field.name='PillowSixSensorPressureEstimate';field.rotation.x=-Math.PI/2;
    field.position.set(center.x,box.max.y+Math.max(.006,size.y*.025),center.z);
    field.renderOrder=5;field.raycast=()=>{};field.visible=false;
    heatSpots.push(field);scene.add(field);
  }

  function fitHomeView() {
    const box = new THREE.Box3().setFromObject(modelRoot);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.48, 2.5);
    const position = center.clone().add(new THREE.Vector3(radius * 0.9, radius * 0.72, -radius * 1.05));
    const target = center.clone().add(new THREE.Vector3(0, size.y * 0.08, 0));
    homeView = { position, target };
    camera.position.copy(position);
    controls.target.copy(target);
    controls.minDistance = Math.max(0.7, radius * 0.22);
    controls.maxDistance = radius * 2.8;
    camera.near = Math.max(0.01, radius / 100);
    camera.far = radius * 20;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function startCameraTween(position, target) {
    cameraTween = {
      startedAt: performance.now(),
      duration: 620,
      fromPosition: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPosition: position.clone(),
      toTarget: target.clone()
    };
    controls.enabled = false;
  }

  function focusObject(object) {
    if (!object) return;
    const box = new THREE.Box3().setFromObject(object);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const type = classifyObject(object.name);
    const distance = Math.max(sphere.radius * (type === 'person' ? 3.5 : 4.2), type === 'person' ? 1.45 : 1.25);
    const direction = new THREE.Vector3(1, 0.90, -1).normalize();
    startCameraTween(sphere.center.clone().add(direction.multiplyScalar(distance)), sphere.center);
  }

  function selectTarget(type, focus = true) {
    selectedType = targets.has(type) || type === 'room' ? type : 'room';
    if (selectionHelper) {
      scene.remove(selectionHelper);
      selectionHelper.geometry.dispose();
      selectionHelper.material.dispose();
      selectionHelper = null;
    }
    const object = targets.get(selectedType);
    if (object) {
      selectionHelper = new THREE.BoxHelper(object, selectedType === 'pillow' ? 0x4ce6ee : selectedType === 'lamp' ? 0xffce70 : 0x66bfff);
      selectionHelper.material.transparent = true;
      selectionHelper.material.opacity = 0.8;
      if(selectedType!=='person')scene.add(selectionHelper);
      if (focus) focusObject(object);
    } else if (focus && homeView) {
      startCameraTween(homeView.position, homeView.target);
    }
    document.querySelectorAll('[data-twin-focus]').forEach(button => {
      button.classList.toggle('active', button.dataset.twinFocus === selectedType);
    });
    updateInspector();
  }

  function targetFromIntersection(object) {
    let current = object;
    while (current && current !== modelRoot) {
      const type = classifyObject(current.name);
      if (type) return type;
      current = current.parent;
    }
    return null;
  }

  function pick(clientX, clientY) {
    if (!modelRoot) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const intersections = [...raycaster.intersectObject(modelRoot, true), ...(sleeperRig ? raycaster.intersectObject(sleeperRig.group, true) : [])].sort((a,b)=>a.distance-b.distance);
    for (const intersection of intersections) {
      const type = targetFromIntersection(intersection.object);
      if (type) {
        selectTarget(type, true);
        return;
      }
    }
  }

  renderer.domElement.addEventListener('pointerdown', event => {
    pointerStart = { x: event.clientX, y: event.clientY, time: performance.now() };
    if (cameraTween) {
      cameraTween = null;
      controls.enabled = true;
    }
  });
  renderer.domElement.addEventListener('pointerup', event => {
    if (!pointerStart) return;
    const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
    const duration = performance.now() - pointerStart.time;
    if (distance < 8 && duration < 600) pick(event.clientX, event.clientY);
    pointerStart = null;
  });
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    ui.status.textContent = '3D 渲染暂时中断';
    ui.status.className = 'twin-status error';
  });

  document.querySelectorAll('[data-twin-focus]').forEach(button => {
    button.addEventListener('click', () => selectTarget(button.dataset.twinFocus, true));
  });
  ui.lightSlider.addEventListener('input', () => {
    const brightness = Number(ui.lightSlider.value);
    lampPreview.intensity = brightness / 100 * lampMaxIntensity;
    ui.lightValue.textContent = `${brightness}%`;
    if (selectedType === 'lamp') setMetric(0, '灯光预览', `${brightness}%`);
  });

  const loader = new GLTFLoader();
  const modelUrl = '/static/models/bedroom.glb?v=realistic-resting-arms-1';
  const onModelLoaded = async gltf => {
    modelRoot = gltf.scene;
    modelRoot.name = 'DreamGuardianBedroom';
    scene.add(modelRoot);

    const initialBox = new THREE.Box3().setFromObject(modelRoot);
    const initialSize = initialBox.getSize(new THREE.Vector3());
    const scale = 5.6 / Math.max(initialSize.x, initialSize.z, 0.001);
    modelRoot.scale.multiplyScalar(scale);
    modelRoot.updateWorldMatrix(true, true);
    const scaledBox = new THREE.Box3().setFromObject(modelRoot);
    const center = scaledBox.getCenter(new THREE.Vector3());
    modelRoot.position.x -= center.x;
    modelRoot.position.z -= center.z;
    modelRoot.position.y -= scaledBox.min.y;
    modelRoot.updateWorldMatrix(true, true);

    enlargeBed(modelRoot);
    scene.environment = refineBedroom(modelRoot, renderer);
    scene.environmentIntensity = 0.25;

    const deviceParts = [];
    modelRoot.traverse(object => { if (classifyObject(object.name) === 'xiaomeng') deviceParts.push(object); });
    if (deviceParts.length) {
      const deviceGroup = new THREE.Group(); deviceGroup.name = 'Xiaomeng';
      modelRoot.add(deviceGroup); modelRoot.updateWorldMatrix(true, true);
      deviceParts.forEach(object => deviceGroup.attach(object));
      // Seat the complete device on the top book, in world coordinates.
      const books=[];
      modelRoot.traverse(object=>{if(object.isMesh&&/^bookcover/i.test(object.name.replace(/[^a-z0-9]/gi,'')))books.push(new THREE.Box3().setFromObject(object));});
      books.sort((a,b)=>b.max.y-a.max.y);
      if(books.length){
        const support=books[0],deviceBox=new THREE.Box3().setFromObject(deviceGroup);
        const topCenter=support.getCenter(new THREE.Vector3()),deviceCenter=deviceBox.getCenter(new THREE.Vector3());
        const delta=new THREE.Vector3(topCenter.x-deviceCenter.x,support.max.y-deviceBox.min.y,topCenter.z-deviceCenter.z);
        const worldOrigin=deviceGroup.getWorldPosition(new THREE.Vector3()).add(delta);
        deviceGroup.position.copy(modelRoot.worldToLocal(worldOrigin));
        deviceGroup.updateWorldMatrix(true,true);
      }

    }

    modelRoot.traverse(object => {
      // Blender exports a ~870 cd bulb. Avoid adding that unscaled light to
      // the dashboard's own lighting; the slider controls the single preview bulb.
      if (object.isLight) object.visible = false;
      if (object.isMesh) {
        object.castShadow = !constrainedRenderer;
        object.receiveShadow = !constrainedRenderer;
      }
      const type = classifyObject(object.name);
      if (type && !targets.has(type)) targets.set(type, object);
    });

    // Prefer the original complete objects over new seams, facial details or
    // glTF punctual lights whose names can also contain pillow/person/lamp.
    modelRoot.traverse(object => {
      const name = object.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (name === 'plane007') targets.set('person', object);
      if (name === 'pillow') targets.set('pillow', object);
      if (name === 'lightstand1') targets.set('lamp', object);
    });

    // Blender commonly previews both sides of a surface, while Three.js culls
    // back faces by default. Render the human mesh double-sided so a top-down
    // view does not look as if the body was cut by a transparent plane.
    const personObject = targets.get('person');
    if (personObject) {
      personObject.traverse(object => {
        if (!object.isMesh) return;
        object.material = Array.isArray(object.material)
          ? object.material.map(material => material.clone())
          : object.material.clone();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => {
          material.side = THREE.DoubleSide;
          material.depthTest = true;
          material.depthWrite = true;
          material.needsUpdate = true;
        });
      });
    }

    pillowObject = targets.get('pillow') || null;
    if (pillowObject) {
      pillowObject.traverse(object => {
        if (!object.isMesh) return;
        object.material = Array.isArray(object.material)
          ? object.material.map(material => material.clone())
          : object.material.clone();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => {
          if (material.emissive) heatMaterials.push(material);
        });
      });
      makeHeatSpots();
    }

    const lampObject = targets.get('lamp');
    if (lampObject) {
      const lampBox = new THREE.Box3().setFromObject(lampObject);
      lampBox.getCenter(lampPreview.position);
      lampPreview.position.y += lampBox.getSize(new THREE.Vector3()).y * 0.6;
    } else {
      lampPreview.position.set(1.8, 1.8, -1.2);
    }

    // Lift only the sleeper and bedding by 16%, without spilling light onto
    // the room or changing the global exposure. Preserve texture/shadow detail.
    modelRoot.traverse(object => {
      if (!object.isMesh) return;
      let current = object;
      let brighten = false;
      let isPillow = false;
      while (current && current !== modelRoot) {
        const name = current.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (current === pillowObject) isPillow = true;
        if (name === 'plane007' || name === 'bedsingle' || name === 'cover' ||
            current === pillowObject || name === 'foldedfootthrow') brighten = true;
        current = current.parent;
      }
      if (!brighten) return;
      // Pillow materials are already unique and referenced by the live heatmap.
      const adjust = source => {
        const material = isPillow ? source : source.clone();
        material.onBeforeCompile = shader => {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <opaque_fragment>',
            'outgoingLight *= 1.16;\n#include <opaque_fragment>'
          );
        };
        material.customProgramCacheKey = () => 'dg-bed-person-lift-116';
        material.needsUpdate = true;
        return material;
      };
      object.material = Array.isArray(object.material) ? object.material.map(adjust) : adjust(object.material);
    });

    sleeperRig=await createAnatomicalSleeper(targets.get('person'),scene,targets.get('pillow'));
    if(sleeperRig)targets.set('person',sleeperRig.group);
    const credit=document.createElement('a');credit.href='/static/models/casual-man/license.txt';credit.target='_blank';credit.rel='noopener';credit.textContent='人物：NABEEL619 · CC BY 4.0';credit.style.cssText='position:absolute;left:10px;bottom:8px;font-size:10px;color:#78909a;z-index:3';credit.addEventListener('pointerdown',e=>e.stopPropagation());container.append(credit);
    if(latestData)pressureTurn.ingest(latestData);
    fitHomeView();
    ui.loading.classList.add('ready');
    ui.status.textContent = '模型已连接';
    ui.status.className = 'twin-status ready';
    selectTarget('room', false);
  };

  const onModelError = error => {
    console.error('DreamGuardian 3D model load failed', error);
    const detail = error && error.message ? error.message : String(error || 'unknown error');
    ui.loading.querySelector('strong').textContent = '卧室模型加载失败';
    ui.loading.querySelector('span').textContent = detail.slice(0, 160);
    ui.status.textContent = '模型加载失败';
    ui.status.className = 'twin-status error';
    ui.status.title = `${modelUrl} · ${detail}`;
    setMetric(0, '模型状态', '加载失败');
  };

  async function loadModel() {
    try {
      ui.status.textContent = '正在读取 bedroom.glb';
      const response = await fetch(modelUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength < 20) throw new Error(`文件过小：${buffer.byteLength} bytes`);
      const bytes = new Uint8Array(buffer, 0, 4);
      const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
      if (magic !== 'glTF') throw new Error(`文件头错误：${magic || 'empty'}，可能返回了网页而不是 GLB`);
      ui.status.textContent = `正在解析模型 ${(buffer.byteLength / 1024).toFixed(0)} KB`;
      await new Promise((resolve, reject) => {
        loader.parse(buffer, '/static/models/', gltf => {
          try {
            onModelLoaded(gltf).then(resolve,reject);
          } catch (error) {
            reject(error);
          }
        }, reject);
      });
    } catch (error) {
      onModelError(error);
    }
  }
  loadModel();

  function resize() {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    const pixelRatio = constrainedRenderer ? 0.8 : Math.min(window.devicePixelRatio || 1, 1.75);
    const expectedWidth = Math.floor(width * pixelRatio);
    const expectedHeight = Math.floor(height * pixelRatio);
    if (renderer.domElement.width !== expectedWidth || renderer.domElement.height !== expectedHeight) {
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }

  let lastRenderedAt = 0;
  function animate(now) {
    if(!container.getClientRects().length){requestAnimationFrame(animate);return;}
    if (constrainedRenderer && now-lastRenderedAt<32){requestAnimationFrame(animate);return;}
    lastRenderedAt=now;
    const angle=pressureTurn.step(lastMotionFrame?(now-lastMotionFrame)/1000:0);lastMotionFrame=now;
    if(sleeperRig)sleeperRig.pose(reducedMotion.matches?pressureTurn.step(0,Date.now(),true):angle);
    if(now-lastMotionLabel>120){
      lastMotionLabel=now;
      const degrees=Math.round(Math.abs(pressureTurn.angle)*180/Math.PI);
      turnLabel.textContent=pressureTurn.paused?'动画已暂停':pressureTurn.valid?pressureTurn.status+' · '+degrees+'°':pressureTurn.status;
      turnMarker.style.left=(50+pressureTurn.balance*45)+'%';
      motionPanel.dataset.valid=String(pressureTurn.valid);
    }
    resize();
    if (cameraTween) {
      const linear = Math.min(1, (now - cameraTween.startedAt) / cameraTween.duration);
      const eased = 1 - Math.pow(1 - linear, 3);
      camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, eased);
      controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
      if (linear >= 1) {
        cameraTween = null;
        controls.enabled = true;
      }
    }
    controls.update();
    if (selectionHelper) selectionHelper.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  window.addEventListener('dreamguardian:telemetry', event => {
    latestData = event.detail || null;
    pressureTurn.ingest(latestData);
    updateInspector();
  });
  if (latestData) updateInspector();
}
