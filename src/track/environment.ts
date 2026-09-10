import * as THREE from 'three';
import { lerp, smoothstep } from '../utils/math';
import type { Track } from './track';

export interface GroundInfo {
  /** 到赛道中心线的水平距离 */
  d: number;
  /** 最近点的路面高度 */
  roadY: number;
}

type GroundSampler = (x: number, z: number) => GroundInfo;

/** 基于赛道采样点的最近距离查询（地形 / 植被共用） */
function createGroundSampler(track: Track): GroundSampler {
  const n = track.samples.length;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const zs = new Float32Array(n);
  track.samples.forEach((s, i) => {
    xs[i] = s.pos.x;
    ys[i] = s.pos.y;
    zs[i] = s.pos.z;
  });
  return (x, z) => {
    let bestD = Infinity;
    let bestY = 0;
    for (let i = 0; i < n; i++) {
      const dx = x - xs[i];
      const dz = z - zs[i];
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        bestY = ys[i];
      }
    }
    return { d: Math.sqrt(bestD), roadY: bestY };
  };
}

function hills(x: number, z: number): number {
  return (
    10 * Math.sin(x * 0.008 + 2) * Math.cos(z * 0.009 - 1) +
    5 * Math.sin(x * 0.02) * Math.cos(z * 0.017 + 3) +
    2 * Math.sin(x * 0.05) * Math.cos(z * 0.043)
  );
}

const heightFromGround = (g: GroundInfo, x: number, z: number): number => {
  const far = Math.min(g.d / 160, 1);
  const hill = hills(x, z) * (0.35 + 0.65 * far);
  const w = smoothstep(9, 80, g.d);
  return lerp(g.roadY - 0.35, hill, w);
};

export interface Terrain {
  mesh: THREE.Mesh;
  heightAt: (x: number, z: number) => number;
  groundInfo: GroundSampler;
}

/** 起伏地形：靠近赛道处贴合路面高度，远处为低多边形丘陵 */
export function createTerrain(track: Track): Terrain {
  const groundInfo = createGroundSampler(track);
  const heightAt = (x: number, z: number): number =>
    heightFromGround(groundInfo(x, z), x, z);

  const size = 1500;
  const segs = 150;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const g = groundInfo(x, z);
    const y = heightFromGround(g, x, z);
    pos.setY(i, y);

    const n = Math.sin(x * 0.11) * Math.cos(z * 0.13) * 0.5 + 0.5;
    color.setHSL(0.27 + n * 0.05, 0.42, 0.24 + n * 0.08 + Math.max(y, 0) * 0.004);
    if (g.d < 16) color.lerp(new THREE.Color(0x5a5a3c), smoothstep(16, 8, g.d) * 0.55);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return { mesh, heightAt, groundInfo };
}

/** 渐变天穹 */
export function createSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1600, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x2a5f9e) },
      horizon: { value: new THREE.Color(0xbfd9e8) },
      bottom: { value: new THREE.Color(0x6b7a5a) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 bottom;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 col = h >= 0.0
          ? mix(horizon, top, pow(clamp(h * 1.6, 0.0, 1.0), 0.7))
          : mix(horizon, bottom, clamp(-h * 3.0, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  return new THREE.Mesh(geo, mat);
}

/** 确定性伪随机（树木摆放可复现） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 路边植被：树干 / 树冠 / 灌木三个 InstancedMesh 控制 draw call */
export function createVegetation(terrain: Terrain): THREE.Group {
  const rand = mulberry32(1995);
  const group = new THREE.Group();

  const treeCount = 240;
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.4, 6);
  trunkGeo.translate(0, 1.2, 0);
  const leafGeo = new THREE.ConeGeometry(1.8, 4.4, 7);
  leafGeo.translate(0, 4.2, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1, flatShading: true });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, treeCount);
  trunks.castShadow = true;
  leaves.castShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const c = new THREE.Color();

  let placed = 0;
  let attempts = 0;
  while (placed < treeCount && attempts < 6000) {
    attempts++;
    const x = (rand() - 0.5) * 1300;
    const z = (rand() - 0.5) * 1300;
    const g = terrain.groundInfo(x, z);
    if (g.d < 17 || g.d > 500) continue;
    const s = 0.8 + rand() * 0.9;
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    p.set(x, terrain.heightAt(x, z) - 0.1, z);
    sc.set(s, s, s);
    m.compose(p, q, sc);
    trunks.setMatrixAt(placed, m);
    leaves.setMatrixAt(placed, m);
    c.setHSL(0.29 + rand() * 0.06, 0.5, 0.24 + rand() * 0.1);
    leaves.setColorAt(placed, c);
    placed++;
  }
  trunks.count = placed;
  leaves.count = placed;
  trunks.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;

  const bushCount = 130;
  const bushGeo = new THREE.IcosahedronGeometry(0.9, 0);
  const bushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const bushes = new THREE.InstancedMesh(bushGeo, bushMat, bushCount);
  bushes.castShadow = true;
  let bPlaced = 0;
  attempts = 0;
  while (bPlaced < bushCount && attempts < 4000) {
    attempts++;
    const x = (rand() - 0.5) * 1200;
    const z = (rand() - 0.5) * 1200;
    const g = terrain.groundInfo(x, z);
    if (g.d < 13 || g.d > 60) continue;
    const s = 0.6 + rand() * 1.1;
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    p.set(x, terrain.heightAt(x, z) + 0.1, z);
    sc.set(s, s * 0.7, s);
    m.compose(p, q, sc);
    bushes.setMatrixAt(bPlaced, m);
    c.setHSL(0.27 + rand() * 0.05, 0.45, 0.2 + rand() * 0.08);
    bushes.setColorAt(bPlaced, c);
    bPlaced++;
  }
  bushes.count = bPlaced;
  bushes.instanceMatrix.needsUpdate = true;
  if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;

  group.add(trunks, leaves, bushes);
  return group;
}
