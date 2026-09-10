import * as THREE from 'three';
import type { AppearanceConfig, LiveryConfig, RimStyle, SpoilerStyle } from '../garage/save';
import { buildLiveryDecals } from './livery';

export interface CarModel {
  root: THREE.Group;
  /** 承载加速俯仰 / 过弯侧倾的车身内层 */
  body: THREE.Group;
  wheelFL: THREE.Group;
  wheelFR: THREE.Group;
  spinFL: THREE.Group;
  spinFR: THREE.Group;
  spinRL: THREE.Group;
  spinRR: THREE.Group;
  /** 尾灯材质（刹车时提亮） */
  brakeMaterial: THREE.MeshStandardMaterial;
  /** 前大灯材质（夜晚发光增强） */
  headMaterial: THREE.MeshStandardMaterial;
  /** 排气管尾焰锚点 */
  exhausts: THREE.Object3D[];
  // 损伤系统引用件
  paint: THREE.MeshPhysicalMaterial;
  spoilerGroup: THREE.Group;
  nose: THREE.Mesh;
  frontBumper: THREE.Mesh;
  rearBumper: THREE.Mesh;
  /** 划痕贴花组（损伤 tier>=1 可见） */
  damageScratches: THREE.Group;
}

/** 侧面轮廓挤压出车身主体（shape X = 车头方向，挤出轴 = 车宽） */
function extrudeProfile(profile: [number, number][], width: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  profile.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2, 0, 0);
  return geo;
}

function makePaint(color: number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.55,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
  });
}

/** 轮毂：轮辐样式 sport / mesh / dish，side = ±1（外侧朝向） */
function buildRim(style: RimStyle, side: number, parent: THREE.Group): void {
  const metal = new THREE.MeshStandardMaterial({
    color: 0xc9ced6,
    metalness: 0.85,
    roughness: 0.3,
  });
  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x3a3d44,
    metalness: 0.7,
    roughness: 0.45,
  });
  const face = side * 0.13;

  if (style === 'dish') {
    const diskGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.3, 14);
    diskGeo.rotateZ(Math.PI / 2);
    const disk = new THREE.Mesh(diskGeo, metal);
    parent.add(disk);
    const hubGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.34, 8);
    hubGeo.rotateZ(Math.PI / 2);
    parent.add(new THREE.Mesh(hubGeo, darkMetal));
    return;
  }

  const spokeCount = style === 'sport' ? 5 : 9;
  const spokeChord = style === 'sport' ? 0.09 : 0.045;
  for (let i = 0; i < spokeCount; i++) {
    const geo = new THREE.BoxGeometry(0.05, 0.2, spokeChord);
    geo.translate(0, 0.11, 0);
    const spoke = new THREE.Mesh(geo, metal);
    spoke.position.x = face;
    spoke.rotation.x = (i / spokeCount) * Math.PI * 2;
    parent.add(spoke);
  }
  const hubGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.08, 8);
  hubGeo.rotateZ(Math.PI / 2);
  const hub = new THREE.Mesh(hubGeo, darkMetal);
  hub.position.x = face;
  parent.add(hub);
}

function makeWheel(style: RimStyle, side: number): { yaw: THREE.Group; spin: THREE.Group } {
  const yaw = new THREE.Group();
  const spin = new THREE.Group();

  const tireGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.28, 14);
  tireGeo.rotateZ(Math.PI / 2);
  const tire = new THREE.Mesh(
    tireGeo,
    new THREE.MeshStandardMaterial({ color: 0x141419, roughness: 0.92 }),
  );
  tire.castShadow = true;
  spin.add(tire);

  buildRim(style, side, spin);
  yaw.add(spin);
  return { yaw, spin };
}

/** 程序化划痕纹理：几道深色折线刮痕（损伤贴花用） */
function makeScratchTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 6; i++) {
    const x0 = 10 + Math.random() * 60;
    const y0 = 15 + Math.random() * 90;
    ctx.strokeStyle = `rgba(20,18,16,${0.5 + Math.random() * 0.35})`;
    ctx.lineWidth = 1 + Math.random() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    let x = x0;
    let y = y0;
    for (let k = 0; k < 4; k++) {
      x += 8 + Math.random() * 18;
      y += (Math.random() - 0.5) * 16;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildSpoiler(style: SpoilerStyle, paint: THREE.Material, dark: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  if (style === 'low') {
    const lip = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.32), paint);
    lip.position.set(0, 0.94, -2.12);
    lip.rotation.x = -0.12;
    g.add(lip);
  } else if (style === 'gt') {
    for (const sx of [0.55, -0.55]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.36, 0.12), dark);
      strut.position.set(sx, 1.04, -2.14);
      g.add(strut);
    }
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.45), paint);
    wing.position.set(0, 1.26, -2.18);
    wing.rotation.x = -0.14;
    g.add(wing);
    for (const sx of [0.87, -0.87]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.45), dark);
      plate.position.set(sx, 1.28, -2.18);
      g.add(plate);
    }
  }
  return g;
}

/** 底盘灯地面光斑：径向渐变 shader，无贴图 */
function makeGlowBlob(color: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float d = length((vUv - 0.5) * 2.0);
        float a = smoothstep(1.0, 0.2, d) * 0.7;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  });
  const geo = new THREE.PlaneGeometry(3.6, 4.8);
  geo.rotateX(-Math.PI / 2);
  const blob = new THREE.Mesh(geo, mat);
  blob.position.y = 0.04;
  return blob;
}

/** 低模跑车：楔形挤压车身 + 外观改装件（车漆/尾翼/轮毂/底盘灯） + 涂装贴片 */
export function buildCarModel(cfg: AppearanceConfig, livery: LiveryConfig): CarModel {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const paint = makePaint(cfg.paint);
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161c, metalness: 0.4, roughness: 0.55 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0d1218,
    metalness: 0.9,
    roughness: 0.08,
    clearcoat: 1,
  });

  // 车身主体（侧面轮廓挤压）
  const lowerGeo = extrudeProfile(
    [
      [-2.3, 0.3],
      [2.25, 0.3],
      [2.32, 0.5],
      [1.55, 0.68],
      [-0.1, 0.8],
      [-1.75, 0.88],
      [-2.32, 0.8],
    ],
    1.76,
  );
  const nose = new THREE.Mesh(lowerGeo, paint);
  body.add(nose);

  const cabinGeo = extrudeProfile(
    [
      [0.42, 0.8],
      [-0.3, 1.18],
      [-1.3, 1.2],
      [-1.8, 0.84],
    ],
    1.36,
  );
  body.add(new THREE.Mesh(cabinGeo, glass));

  // 保险杠 / 侧裙 / 前铲
  const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.26, 0.42), paint);
  frontBumper.position.set(0, 0.34, 2.18);
  body.add(frontBumper);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.06, 0.3), dark);
  splitter.position.set(0, 0.24, 2.3);
  body.add(splitter);
  const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.28, 0.36), paint);
  rearBumper.position.set(0, 0.36, -2.24);
  body.add(rearBumper);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 0.2), dark);
  diffuser.position.set(0, 0.26, -2.34);
  body.add(diffuser);
  for (const sx of [0.9, -0.9]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 2.4), dark);
    skirt.position.set(sx, 0.26, 0);
    body.add(skirt);
  }

  const spoilerGroup = buildSpoiler(cfg.spoiler, paint, dark);
  body.add(spoilerGroup);

  // 损伤划痕贴花（预建隐藏，tier>=1 可见）：引擎盖 + 左侧身
  const damageScratches = new THREE.Group();
  const scratchTex = makeScratchTexture();
  const scratchMat = new THREE.MeshStandardMaterial({
    map: scratchTex,
    transparent: true,
    roughness: 0.8,
    metalness: 0.1,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    depthWrite: false,
  });
  const hoodScratch = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.7), scratchMat);
  hoodScratch.rotation.x = -Math.PI / 2 + Math.atan2(0.3, 2.42);
  hoodScratch.position.set(0.25, 0.672, 1.1);
  const sideScratch = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.35), scratchMat);
  sideScratch.rotation.y = -Math.PI / 2;
  sideScratch.position.set(-0.885, 0.56, 0.4);
  damageScratches.add(hoodScratch, sideScratch);
  damageScratches.visible = false;
  body.add(damageScratches);

  // 前大灯（发光贴片）
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff6d8,
    emissive: 0xfff2c8,
    emissiveIntensity: 2.4,
  });
  for (const sx of [0.58, -0.58]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.12, 0.1), headMat);
    head.position.set(sx, 0.56, 2.31);
    head.rotation.x = -0.25;
    body.add(head);
  }

  // 尾灯条（刹车提亮）
  const brakeMaterial = new THREE.MeshStandardMaterial({
    color: 0x300404,
    emissive: 0xff1a1a,
    emissiveIntensity: 0.9,
  });
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.12, 0.07), brakeMaterial);
  tail.position.set(0, 0.72, -2.34);
  body.add(tail);

  // 排气管 + 尾焰锚点
  const exhausts: THREE.Object3D[] = [];
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.9, roughness: 0.35 });
  const tipMat = new THREE.MeshStandardMaterial({
    color: 0x1a0d08,
    emissive: 0xff5a20,
    emissiveIntensity: 1.4,
  });
  for (const sx of [0.36, -0.36]) {
    const pipeGeo = new THREE.CylinderGeometry(0.075, 0.06, 0.3, 10);
    pipeGeo.rotateX(Math.PI / 2);
    const pipe = new THREE.Mesh(pipeGeo, pipeMat);
    pipe.position.set(sx, 0.32, -2.38);
    body.add(pipe);
    const tip = new THREE.Mesh(new THREE.CircleGeometry(0.055, 10), tipMat);
    tip.position.set(sx, 0.32, -2.54);
    tip.rotation.y = Math.PI;
    body.add(tip);
    const anchor = new THREE.Object3D();
    anchor.position.set(sx, 0.32, -2.55);
    body.add(anchor);
    exhausts.push(anchor);
  }

  // 霓虹底盘灯
  if (cfg.underglow !== null) {
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a,
      emissive: cfg.underglow,
      emissiveIntensity: 2.2,
    });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 3.7), glowMat);
    strip.position.y = 0.17;
    body.add(strip);
    root.add(makeGlowBlob(cfg.underglow));
  }

  // 涂装拉花贴片（只贴车身，不影响玻璃/尾灯）
  body.add(buildLiveryDecals(livery));

  body.traverse((o) => {
    if (o instanceof THREE.Mesh && o.renderOrder === 0) o.castShadow = true;
  });

  const fl = makeWheel(cfg.rims, -1);
  const fr = makeWheel(cfg.rims, 1);
  const rl = makeWheel(cfg.rims, -1);
  const rr = makeWheel(cfg.rims, 1);
  fl.yaw.position.set(-0.88, 0.34, 1.45);
  fr.yaw.position.set(0.88, 0.34, 1.45);
  rl.yaw.position.set(-0.88, 0.34, -1.45);
  rr.yaw.position.set(0.88, 0.34, -1.45);
  root.add(fl.yaw, fr.yaw, rl.yaw, rr.yaw);

  return {
    root,
    body,
    wheelFL: fl.yaw,
    wheelFR: fr.yaw,
    spinFL: fl.spin,
    spinFR: fr.spin,
    spinRL: rl.spin,
    spinRR: rr.spin,
    brakeMaterial,
    headMaterial: headMat,
    exhausts,
    paint,
    spoilerGroup,
    nose,
    frontBumper,
    rearBumper,
    damageScratches,
  };
}

export function disposeCarModel(model: CarModel): void {
  model.root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial;
        std.map?.dispose();
        std.emissiveMap?.dispose();
        m.dispose();
      }
    }
  });
}
