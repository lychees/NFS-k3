import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import colormapUrl from '../assets/models/Textures/colormap.png?url';
import raceUrl from '../assets/models/race.glb?url';
import raceFutureUrl from '../assets/models/race-future.glb?url';
import sedanSportsUrl from '../assets/models/sedan-sports.glb?url';
import hatchbackSportsUrl from '../assets/models/hatchback-sports.glb?url';
import sedanUrl from '../assets/models/sedan.glb?url';
import suvUrl from '../assets/models/suv.glb?url';
import taxiUrl from '../assets/models/taxi.glb?url';
import policeUrl from '../assets/models/police.glb?url';
import {
  makeGlowBlob,
  makeScratchTexture,
  type CarMetrics,
  type CarModel,
} from './carModel';
import { buildLiveryDecals } from './livery';
import type { AppearanceConfig, LiveryConfig, VehicleId } from '../garage/save';

const MODEL_URLS: Record<VehicleId, string> = {
  race: raceUrl,
  'race-future': raceFutureUrl,
  'sedan-sports': sedanSportsUrl,
  'hatchback-sports': hatchbackSportsUrl,
  sedan: sedanUrl,
  suv: suvUrl,
  taxi: taxiUrl,
  police: policeUrl,
};

/** Kenney 模型命名：四轮（suv 尾门备胎 "wheel-back" 不算） */
export const WHEEL_NODE_RE = /^wheel-(front|back)-(left|right)$/;

export interface Aabb {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export interface NormalizeParams {
  scale: number;
  offset: [number, number, number];
}

/**
 * 归一化（纯函数，可测）：按最长轴缩放到目标车长，
 * 包围盒水平居中、贴地。Kenney 车头已朝 +Z，无需旋转。
 */
export function computeNormalization(box: Aabb, targetLength = 4.4): NormalizeParams {
  const sx = box.max.x - box.min.x;
  const sz = box.max.z - box.min.z;
  const scale = targetLength / Math.max(sx, sz);
  return {
    scale,
    offset: [
      (-(box.min.x + box.max.x) / 2) * scale,
      -box.min.y * scale,
      (-(box.min.z + box.max.z) / 2) * scale,
    ],
  };
}

export interface GlbTemplate {
  id: VehicleId;
  /** 归一化包装（缩放/偏移已应用，含 steer-* 转向组） */
  scene: THREE.Group;
  /** 车身节点材质（共享贴图材质，克隆后做车漆换色） */
  bodyMaterial: THREE.MeshStandardMaterial;
  metrics: CarMetrics;
}

const templates = new Map<VehicleId, GlbTemplate>();

export function getTemplate(id: VehicleId): GlbTemplate | null {
  return templates.get(id) ?? null;
}

/** 预加载全部 GLB；单个失败只跳过该车型（回退程序化），不阻塞游戏 */
export async function preloadLibrary(): Promise<void> {
  // GLB 内部引用 Textures/colormap.png（外部相对路径），重定向到打包后的资源
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => (url.endsWith('.png') ? colormapUrl : url));
  const loader = new GLTFLoader(manager);
  const jobs = (Object.keys(MODEL_URLS) as VehicleId[]).map(async (id) => {
    try {
      const gltf = await loader.loadAsync(MODEL_URLS[id]);
      templates.set(id, processTemplate(id, gltf.scene));
    } catch (e) {
      console.warn(`[glbCar] ${id} 加载失败，回退程序化车模`, e);
    }
  });
  await Promise.all(jobs);
}

function processTemplate(id: VehicleId, scene: THREE.Group): GlbTemplate {
  const box = new THREE.Box3().setFromObject(scene);
  const { scale, offset } = computeNormalization({
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
  });

  // 车轮包转向组（命名 steer-fl/fr/rl/rr 供克隆后查找）
  const keys = ['fl', 'fr', 'rl', 'rr'] as const;
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) o.userData.fromLibrary = true;
  });
  scene.children.slice().forEach((node) => {
    if (!WHEEL_NODE_RE.test(node.name)) return;
    const idx =
      (node.name.includes('back') ? 2 : 0) + (node.name.includes('right') ? 1 : 0);
    const steer = new THREE.Group();
    steer.name = `steer-${keys[idx]}`;
    steer.position.copy(node.position);
    scene.add(steer);
    node.position.set(0, 0, 0);
    steer.add(node);
  });

  const wrap = new THREE.Group();
  wrap.scale.setScalar(scale);
  wrap.position.set(offset[0], offset[1], offset[2]);
  wrap.add(scene);

  const bodyNode = scene.getObjectByName('body') as THREE.Mesh;
  const size = new THREE.Vector3();
  box.getSize(size);
  const sx = size.x * scale;
  const metrics: CarMetrics = {
    halfWidth: sx / 2,
    frontZ: box.max.z * scale + offset[2],
    rearZ: box.min.z * scale + offset[2],
    roofY: box.max.y * scale + offset[1],
    hoodY: (box.max.y * 0.55) * scale + offset[1],
    tailY: (box.max.y * 0.6) * scale + offset[1],
    wheelR: 0.3 * scale,
  };

  return {
    id,
    scene: wrap,
    bodyMaterial: bodyNode.material as THREE.MeshStandardMaterial,
    metrics,
  };
}

function emptyMesh(): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshBasicMaterial({ visible: false }));
}

/** 用模板构建 CarModel（克隆共享几何；车漆换色克隆材质；灯组/decal 按 metrics 挂载） */
export function buildGlbCarModel(
  cfg: AppearanceConfig,
  livery: LiveryConfig,
  template: GlbTemplate,
): CarModel {
  const m = template.metrics;
  const wrapper = template.scene.clone(true);

  // 车漆：车身节点材质克隆后乘色（贴图白色区域 -> 车漆色；共享材质不动）
  const bodyClone = wrapper.getObjectByName('body') as THREE.Mesh;
  const paint = template.bodyMaterial.clone();
  paint.userData.cloned = true;
  paint.color.set(cfg.paint);
  bodyClone.material = paint;

  const body = new THREE.Group();
  body.add(wrapper);
  const root = new THREE.Group();
  root.add(body);

  const findSteer = (name: string): THREE.Group =>
    (wrapper.getObjectByName(name) as THREE.Group) ?? new THREE.Group();

  // 前大灯（发光贴片，位置按包围盒）
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff6d8,
    emissive: 0xfff2c8,
    emissiveIntensity: 2.4,
  });
  for (const sx of [m.halfWidth * 0.5, -m.halfWidth * 0.5]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.11, 0.08), headMat);
    head.position.set(sx, m.hoodY, m.frontZ - 0.02);
    body.add(head);
  }

  // 尾灯条（刹车提亮）
  const brakeMaterial = new THREE.MeshStandardMaterial({
    color: 0x300404,
    emissive: 0xff1a1a,
    emissiveIntensity: 0.9,
  });
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(m.halfWidth * 1.5, 0.1, 0.06),
    brakeMaterial,
  );
  tail.position.set(0, m.tailY, m.rearZ - 0.02);
  body.add(tail);

  // 排气管尾焰锚点（按包围盒尾部）
  const exhausts: THREE.Object3D[] = [];
  for (const sx of [m.halfWidth * 0.35, -m.halfWidth * 0.35]) {
    const anchor = new THREE.Object3D();
    anchor.position.set(sx, m.wheelR * 0.9, m.rearZ - 0.1);
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
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(m.halfWidth * 1.6, 0.05, (m.frontZ - m.rearZ) * 0.8),
      glowMat,
    );
    strip.position.y = 0.17;
    body.add(strip);
    root.add(makeGlowBlob(cfg.underglow));
  }

  // 损伤划痕贴花（预建隐藏，tier>=1 可见）
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
  const damageScratches = new THREE.Group();
  const hoodScratch = new THREE.Mesh(new THREE.PlaneGeometry(m.halfWidth * 1.1, m.frontZ * 0.35), scratchMat);
  hoodScratch.rotation.x = -Math.PI / 2 + 0.08;
  hoodScratch.position.set(m.halfWidth * 0.2, m.hoodY + 0.02, m.frontZ * 0.5);
  const sideScratch = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.35), scratchMat);
  sideScratch.rotation.y = -Math.PI / 2;
  sideScratch.position.set(-(m.halfWidth + 0.005), m.roofY * 0.45, 0);
  damageScratches.add(hoodScratch, sideScratch);
  damageScratches.visible = false;
  body.add(damageScratches);

  // 涂装拉花贴片（按包围盒定位）
  body.add(buildLiveryDecals(livery, m));

  // 损伤退化件：车头/保险杠的几何变换无法映射到 GLB 节点，用空占位（仅划痕+烟尘生效）
  const nose = emptyMesh();
  const frontBumper = emptyMesh();
  const rearBumper = emptyMesh();
  const spoilerNode = wrapper.getObjectByName('spoiler');
  const spoilerGroup = (spoilerNode ?? new THREE.Group()) as THREE.Group;

  return {
    root,
    body,
    wheelFL: findSteer('steer-fl'),
    wheelFR: findSteer('steer-fr'),
    spinFL: findSteer('steer-fl').children[0] as THREE.Group,
    spinFR: findSteer('steer-fr').children[0] as THREE.Group,
    spinRL: findSteer('steer-rl').children[0] as THREE.Group,
    spinRR: findSteer('steer-rr').children[0] as THREE.Group,
    brakeMaterial,
    headMaterial: headMat,
    exhausts,
    paint: paint as unknown as CarModel['paint'],
    spoilerGroup,
    nose,
    frontBumper,
    rearBumper,
    damageScratches,
    metrics: m,
  };
}
