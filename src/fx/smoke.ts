import * as THREE from 'three';

const MAX_PARTICLES = 240;

interface Particle {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;
  life: number;
  size: number;
  r: number; g: number; b: number;
}

function makeSmokeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

/**
 * 漂移烟雾粒子池：单个 THREE.Points 一次 draw call，
 * 每粒子尺寸/透明度/颜色由自定义 shader 驱动。
 */
export class SmokePool {
  private points: THREE.Points;
  private particles: Particle[] = [];
  private posAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private alphaAttr: THREE.BufferAttribute;
  private colorAttr: THREE.BufferAttribute;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        alive: false, x: 0, y: -1000, z: 0, vx: 0, vy: 0, vz: 0,
        age: 0, life: 1, size: 1, r: 1, g: 1, b: 1,
      });
    }

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1);
    this.alphaAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1);
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.setAttribute('aColor', this.colorAttr);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { map: { value: makeSmokeTexture() } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 aColor;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vAlpha = aAlpha;
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (260.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec4 tex = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor, tex.a * vAlpha);
        }
      `,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** color: 0 = 白烟（漂移），1 = 土黄（草地扬尘） */
  spawn(x: number, y: number, z: number, vx: number, vz: number, dust: boolean): void {
    const p = this.particles.find((q) => !q.alive);
    if (!p) return;
    p.alive = true;
    p.x = x + (Math.random() - 0.5) * 0.3;
    p.y = y + Math.random() * 0.15;
    p.z = z + (Math.random() - 0.5) * 0.3;
    p.vx = vx * 0.25 + (Math.random() - 0.5) * 1.2;
    p.vy = 1.0 + Math.random() * 1.2;
    p.vz = vz * 0.25 + (Math.random() - 0.5) * 1.2;
    p.age = 0;
    p.life = 0.9 + Math.random() * 0.5;
    p.size = 0.9 + Math.random() * 0.5;
    if (dust) {
      p.r = 0.62; p.g = 0.55; p.b = 0.38;
    } else {
      const g = 0.85 + Math.random() * 0.1;
      p.r = g; p.g = g; p.b = g;
    }
  }

  update(dt: number): void {
    const pos = this.posAttr.array as Float32Array;
    const size = this.sizeAttr.array as Float32Array;
    const alpha = this.alphaAttr.array as Float32Array;
    const col = this.colorAttr.array as Float32Array;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (p.alive) {
        p.age += dt;
        if (p.age >= p.life) {
          p.alive = false;
          p.y = -1000;
          alpha[i] = 0;
        } else {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          const t = p.age / p.life;
          size[i] = p.size * (1 + t * 2.2);
          alpha[i] = 0.45 * (1 - t);
        }
      }
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      col[i * 3] = p.r;
      col[i * 3 + 1] = p.g;
      col[i * 3 + 2] = p.b;
    }

    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }
}
