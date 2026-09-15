import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lerp, smoothstep } from '../utils/math';
import { THEMES, themeOf } from './themes';
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

const heightFromGround = (g: GroundInfo, x: number, z: number, hillScale: number): number => {
  const far = Math.min(g.d / 160, 1);
  const hill = hills(x, z) * hillScale * (0.35 + 0.65 * far);
  const w = smoothstep(9, 80, g.d);
  return lerp(g.roadY - 0.35, hill, w);
};

export interface Terrain {
  mesh: THREE.Mesh;
  heightAt: (x: number, z: number) => number;
  groundInfo: GroundSampler;
  /** 地形覆盖范围（树木摆放用） */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** 起伏地形：靠近赛道处贴合路面高度，远处为低多边形丘陵；尺寸自适应赛道范围 */
export function createTerrain(track: Track): Terrain {
  const groundInfo = createGroundSampler(track);
  const hillScale = track.def.hills;
  const heightAt = (x: number, z: number): number =>
    heightFromGround(groundInfo(x, z), x, z, hillScale);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of track.samples) {
    minX = Math.min(minX, s.pos.x);
    maxX = Math.max(maxX, s.pos.x);
    minZ = Math.min(minZ, s.pos.z);
    maxZ = Math.max(maxZ, s.pos.z);
  }
  const margin = 480;
  minX -= margin;
  maxX += margin;
  minZ -= margin;
  maxZ += margin;
  const sizeX = Math.max(1500, maxX - minX);
  const sizeZ = Math.max(1500, maxZ - minZ);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const bounds = { minX: cx - sizeX / 2, maxX: cx + sizeX / 2, minZ: cz - sizeZ / 2, maxZ: cz + sizeZ / 2 };

  const segsX = Math.min(210, Math.ceil(sizeX / 10));
  const segsZ = Math.min(210, Math.ceil(sizeZ / 10));
  const geo = new THREE.PlaneGeometry(sizeX, sizeZ, segsX, segsZ);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const color = new THREE.Color();
  const palette = THEMES[themeOf(track.def.theme)];
  const dirt = new THREE.Color(palette.roadDirt);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx;
    const z = pos.getZ(i) + cz;
    const g = groundInfo(x, z);
    const y = heightFromGround(g, x, z, hillScale);
    pos.setY(i, y);

    const n = Math.sin(x * 0.11) * Math.cos(z * 0.13) * 0.5 + 0.5;
    color.setHSL(
      palette.groundH[0] + n * (palette.groundH[1] - palette.groundH[0]),
      palette.groundS,
      lerp(palette.groundL[0], palette.groundL[1], n) + Math.max(y, 0) * 0.004,
    );
    if (g.d < 16) color.lerp(dirt, smoothstep(16, 8, g.d) * 0.55);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, 0, cz);
  mesh.receiveShadow = true;
  return { mesh, heightAt, groundInfo, bounds };
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

interface PropPlacement {
  geo: THREE.BufferGeometry;
  mat: THREE.MeshStandardMaterial;
  castShadow: boolean;
}

/** 主题对应的植被/点缀物：InstancedMesh 控制 draw call，密度滑块决定强度 */
export function createVegetation(track: Track, terrain: Terrain): THREE.Group {
  const rand = mulberry32(1995);
  const group = new THREE.Group();
  const theme = themeOf(track.def.theme);
  const density = track.def.vegetation;
  const b = terrain.bounds;
  const spanX = b.maxX - b.minX;
  const spanZ = b.maxZ - b.minZ;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const c = new THREE.Color();

  /** 通用摆放器：在 [minD, maxD] 距路范围内撒 count 个实例 */
  const scatter = (
    props: PropPlacement[],
    count: number,
    minD: number,
    maxD: number,
    colorFn: (i: number) => THREE.Color | null,
    scaleFn: () => [number, number, number],
    yOff = 0,
  ): void => {
    if (props.length === 0 || count <= 0) return;
    const meshes = props.map((pr) => {
      const mesh = new THREE.InstancedMesh(pr.geo, pr.mat, count);
      mesh.castShadow = pr.castShadow;
      group.add(mesh);
      return mesh;
    });
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < count * 40) {
      attempts++;
      const x = b.minX + rand() * spanX;
      const z = b.minZ + rand() * spanZ;
      const g = terrain.groundInfo(x, z);
      if (g.d < minD || g.d > maxD) continue;
      const [sx, sy, sz] = scaleFn();
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      p.set(x, terrain.heightAt(x, z) + yOff, z);
      sc.set(sx, sy, sz);
      m.compose(p, q, sc);
      const col = colorFn(placed);
      for (const mesh of meshes) {
        mesh.setMatrixAt(placed, m);
        if (col) mesh.setColorAt(placed, col);
      }
      placed++;
    }
    for (const mesh of meshes) {
      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  };

  const std = (color: number, roughness = 1): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });
  const white = (): THREE.MeshStandardMaterial =>
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const cyl = (r0: number, r1: number, h: number, seg: number, ty: number): THREE.CylinderGeometry => {
    const g = new THREE.CylinderGeometry(r0, r1, h, seg);
    g.translate(0, ty, 0);
    return g;
  };
  const one = (s: number): [number, number, number] => [s, s, s];
  const flat = (s: number): [number, number, number] => [s, s * 0.7, s];

  if (theme === 'grass') {
    // 草原：阔叶树 + 灌木
    scatter(
      [
        { geo: cyl(0.22, 0.32, 2.4, 6, 1.2), mat: std(0x6b4a2f), castShadow: true },
        { geo: cyl(0, 1.8, 4.4, 7, 4.2), mat: white(), castShadow: true },
      ],
      Math.round(240 * density), 17, 500,
      () => c.clone().setHSL(0.29 + rand() * 0.06, 0.5, 0.24 + rand() * 0.1),
      () => one(0.8 + rand() * 0.9),
      -0.1,
    );
    scatter(
      [{ geo: new THREE.IcosahedronGeometry(0.9, 0), mat: white(), castShadow: true }],
      Math.round(130 * density), 13, 60,
      () => c.clone().setHSL(0.27 + rand() * 0.05, 0.45, 0.2 + rand() * 0.08),
      () => flat(0.6 + rand() * 1.1),
      0.1,
    );
    return group;
  }

  if (theme === 'desert') {
    // 沙漠：仙人掌（柱+臂合并）/ 岩石 / 枯木
    const cactusGeo = mergeGeometries([
      cyl(0.22, 0.28, 1.8, 7, 0.9),
      new THREE.CylinderGeometry(0.12, 0.14, 0.7, 6).rotateZ(Math.PI / 2).translate(0.35, 1.0, 0),
      new THREE.CylinderGeometry(0.1, 0.12, 0.5, 6).translate(0.62, 1.3, 0),
    ])!;
    scatter(
      [{ geo: cactusGeo, mat: std(0x3e7a3a), castShadow: true }],
      Math.round(90 * density), 15, 350,
      () => c.clone().setHSL(0.3 + rand() * 0.04, 0.45, 0.3 + rand() * 0.08),
      () => one(0.7 + rand() * 1.0),
    );
    scatter(
      [{ geo: new THREE.IcosahedronGeometry(0.9, 0), mat: white(), castShadow: true }],
      Math.round(110 * density), 13, 200,
      () => c.clone().setHSL(0.08 + rand() * 0.03, 0.3, 0.35 + rand() * 0.12),
      () => flat(0.5 + rand() * 1.6),
      0.05,
    );
    const deadGeo = mergeGeometries([
      cyl(0.12, 0.2, 2.6, 5, 1.3),
      new THREE.BoxGeometry(1.4, 0.12, 0.12).rotateZ(0.5).translate(0.5, 2.1, 0),
      new THREE.BoxGeometry(1.1, 0.1, 0.1).rotateZ(-0.6).translate(-0.4, 1.7, 0.1),
    ])!;
    scatter(
      [{ geo: deadGeo, mat: std(0x5a4632), castShadow: true }],
      Math.round(45 * density), 18, 300,
      () => c.clone().setHSL(0.07, 0.35, 0.25 + rand() * 0.08),
      () => one(0.8 + rand() * 0.8),
    );
    return group;
  }

  if (theme === 'snow') {
    // 雪地：雪顶针叶树 + 雪灌木
    const pineGeo = mergeGeometries([
      cyl(0, 1.7, 3.8, 7, 1.9),
      new THREE.ConeGeometry(1.1, 1.7, 7).translate(0, 3.6, 0),
    ])!;
    scatter(
      [
        { geo: cyl(0.2, 0.28, 2.0, 6, 1.0), mat: std(0x4a3828), castShadow: true },
        { geo: pineGeo, mat: white(), castShadow: true },
      ],
      Math.round(170 * density), 16, 300,
      () => c.clone().setHSL(0.36 + rand() * 0.03, 0.45, 0.2 + rand() * 0.08),
      () => one(0.8 + rand() * 0.9),
      -0.1,
    );
    scatter(
      [{ geo: new THREE.IcosahedronGeometry(0.8, 0), mat: white(), castShadow: true }],
      Math.round(70 * density), 12, 50,
      () => c.clone().setHSL(0.55, 0.1, 0.82 + rand() * 0.1),
      () => flat(0.6 + rand() * 0.9),
      0.1,
    );
    return group;
  }

  // city（工业区）：路灯杆（杆+发光头）/ 集装箱 / 筒仓
  const poleGeo = cyl(0.08, 0.1, 4.5, 6, 2.25);
  const headGeo = new THREE.BoxGeometry(0.5, 0.14, 0.26).translate(0, 4.55, 0);
  scatter(
    [
      { geo: poleGeo, mat: std(0x2c2f36, 0.6), castShadow: true },
      {
        geo: headGeo,
        mat: new THREE.MeshStandardMaterial({ color: 0x141410, emissive: 0xffd98a, emissiveIntensity: 2.4 }),
        castShadow: false,
      },
    ],
    Math.round(45 * density), 12, 18,
    () => null,
    () => one(1),
  );
  scatter(
    [{ geo: new THREE.BoxGeometry(2.4, 1.2, 1.2).translate(0, 0.6, 0), mat: white(), castShadow: true }],
    Math.round(55 * density), 16, 70,
    () => {
      const hues = [0.0, 0.6, 0.32, 0.08];
      return c.clone().setHSL(hues[Math.floor(rand() * hues.length)], 0.55, 0.3 + rand() * 0.12);
    },
    () => one(0.9 + rand() * 0.5),
  );
  scatter(
    [{ geo: cyl(1.2, 1.2, 3.5, 10, 1.75), mat: std(0x7a7f86, 0.7), castShadow: true }],
    Math.round(22 * density), 20, 80,
    () => c.clone().setHSL(0.55, 0.08, 0.4 + rand() * 0.15),
    () => one(0.8 + rand() * 0.6),
  );
  return group;
}
