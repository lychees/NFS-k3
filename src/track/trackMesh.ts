import * as THREE from 'three';
import { headingFromTangent, type Track } from './track';

/** 程序生成的沥青贴图：噪点 + 白边线 + 中央虚线 */
function makeAsphaltTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#3a3d42';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 2600; i++) {
    const g = 50 + Math.random() * 40;
    ctx.fillStyle = `rgb(${g},${g},${g + 4})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }

  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(size * 0.02, 0, size * 0.025, size);
  ctx.fillRect(size * 0.955, 0, size * 0.025, size);

  ctx.fillStyle = '#ffd320';
  ctx.fillRect(size * 0.487, 0, size * 0.026, size * 0.5);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 沿样条的路面 ribbon 几何（闭合回绕 / 开放止于一端） */
export function buildRoad(track: Track, anisotropy: number): THREE.Mesh {
  const n = track.samples.length;
  const segs = track.closed ? n : n - 1;
  const hw = track.halfWidth;
  const tileCount = Math.round(track.length / 8);

  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i < n; i++) {
    const s = track.samples[i];
    const o = i * 6;
    positions[o] = s.pos.x + s.left.x * hw;
    positions[o + 1] = s.pos.y;
    positions[o + 2] = s.pos.z + s.left.z * hw;
    positions[o + 3] = s.pos.x - s.left.x * hw;
    positions[o + 4] = s.pos.y;
    positions[o + 5] = s.pos.z - s.left.z * hw;

    const v = (i / n) * tileCount;
    uvs[i * 4] = 0;
    uvs[i * 4 + 1] = v;
    uvs[i * 4 + 2] = 1;
    uvs[i * 4 + 3] = v;
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = ((i + 1) % n) * 2;
    const d = ((i + 1) % n) * 2 + 1;
    indices.push(a, b, c, b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const tex = makeAsphaltTexture();
  tex.anisotropy = anisotropy;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/** 红白相间的路缘石（顶点着色，每 1.5m 左右换色） */
export function buildCurbs(track: Track): THREE.Mesh {
  const n = track.samples.length;
  const segs = track.closed ? n : n - 1;
  const hw = track.halfWidth;
  const red = new THREE.Color(0xc02a20);
  const white = new THREE.Color(0xe8e6df);

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  // 每侧每行 3 个顶点：内沿(与路面齐平) / 外沿(抬高) / 外裙(下沉到地形)
  for (const side of [1, -1]) {
    const rowStart = positions.length / 3;
    for (let i = 0; i < n; i++) {
      const s = track.samples[i];
      const col = i % 2 === 0 ? red : white;
      const latIn = side * (hw - 0.4);
      const latOut = side * (hw + 0.85);
      positions.push(
        s.pos.x + s.left.x * latIn, s.pos.y + 0.02, s.pos.z + s.left.z * latIn,
        s.pos.x + s.left.x * latOut, s.pos.y + 0.1, s.pos.z + s.left.z * latOut,
        s.pos.x + s.left.x * latOut, s.pos.y - 0.6, s.pos.z + s.left.z * latOut,
      );
      for (let k = 0; k < 3; k++) colors.push(col.r, col.g, col.b);
    }
    for (let i = 0; i < segs; i++) {
      const r0 = rowStart + i * 3;
      const r1 = rowStart + ((i + 1) % n) * 3;
      if (side > 0) {
        indices.push(r0, r1, r0 + 1, r0 + 1, r1, r1 + 1);
        indices.push(r0 + 1, r1 + 1, r0 + 2, r0 + 2, r1 + 1, r1 + 2);
      } else {
        indices.push(r0, r0 + 1, r1, r0 + 1, r1 + 1, r1);
        indices.push(r0 + 1, r0 + 2, r1 + 1, r0 + 2, r1 + 2, r1 + 1);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/** 道路两侧的护栏（硬边界可视化） */
export function buildGuardrails(track: Track): THREE.Mesh {
  const n = track.samples.length;
  const segs = track.closed ? n : n - 1;
  const lat = track.halfWidth + track.runoffWidth;

  const positions: number[] = [];
  const indices: number[] = [];

  for (const side of [1, -1]) {
    const rowStart = positions.length / 3;
    for (let i = 0; i < n; i++) {
      const s = track.samples[i];
      const x = s.pos.x + s.left.x * side * lat;
      const z = s.pos.z + s.left.z * side * lat;
      positions.push(x, s.pos.y + 0.02, z, x, s.pos.y + 0.95, z);
    }
    for (let i = 0; i < segs; i++) {
      const a = rowStart + i * 2;
      const b = rowStart + ((i + 1) % n) * 2;
      if (side > 0) indices.push(a, b, a + 1, a + 1, b, b + 1);
      else indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: 0xb9c0c7,
    roughness: 0.5,
    metalness: 0.6,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

/** 起点/终点拱门：双立柱霓虹 + 横幅（终点带格子旗） */
export function buildGantry(
  track: Track,
  t: number,
  label: string,
  checkered: boolean,
): THREE.Group {
  const s = track.sampleAt(t);
  const hw = track.halfWidth;
  const span = (hw + 1.6) * 2;

  const group = new THREE.Group();
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.6, metalness: 0.4 });
  for (const side of [1, -1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 6.4, 0.7), pillarMat);
    pillar.position.set(side * (hw + 1.6), 3.2, 0);
    pillar.castShadow = true;
    group.add(pillar);

    // 立柱霓虹条
    const neon = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 5.6, 0.74),
      new THREE.MeshStandardMaterial({
        color: 0x0a0a0a,
        emissive: checkered ? 0x58ff5a : side > 0 ? 0xff2fd4 : 0x18e0ff,
        emissiveIntensity: 2.4,
      }),
    );
    neon.position.set(side * (hw + 1.6), 3.0, 0);
    group.add(neon);
  }

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 80;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#14141c';
  ctx.fillRect(0, 0, 512, 80);
  if (checkered) {
    const cells = 16;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < cells; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#e8e8e8' : '#14141c';
        ctx.fillRect(c * (512 / cells), r * 12, 512 / cells, 12);
        ctx.fillRect(c * (512 / cells), 80 - 12 + r * 12 - 12, 512 / cells, 12);
      }
    }
  }
  ctx.fillStyle = checkered ? '#58ff5a' : '#ffd320';
  ctx.font = 'italic 900 46px "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 256, 42);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const bannerFace = new THREE.MeshStandardMaterial({
    map: tex,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: 1.5,
  });
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(span, 1.5, 0.5),
    [
      new THREE.MeshStandardMaterial({ color: 0x14141c }),
      new THREE.MeshStandardMaterial({ color: 0x14141c }),
      new THREE.MeshStandardMaterial({ color: 0x14141c }),
      new THREE.MeshStandardMaterial({ color: 0x14141c }),
      bannerFace,
      bannerFace,
    ],
  );
  banner.position.set(0, 5.9, 0);
  banner.castShadow = true;
  group.add(banner);

  group.position.copy(s.pos);
  group.rotation.y = headingFromTangent(s.tangent);
  return group;
}
