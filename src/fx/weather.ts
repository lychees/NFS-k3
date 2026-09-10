import * as THREE from 'three';

export type TimeOfDay = 'day' | 'sunset' | 'night';
export type WeatherKind = 'clear' | 'rain';

export interface Conditions {
  time: TimeOfDay;
  weather: WeatherKind;
}

export interface EnvPreset {
  sunColor: number;
  sunIntensity: number;
  sunDir: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  skyTop: number;
  skyHorizon: number;
  skyBottom: number;
  exposure: number;
  /** 大灯发光倍率 */
  headlightGlow: number;
  /** 路面光斑不透明度 0..1 */
  headlightBlob: number;
  /** 霓虹/发光体亮度倍率 */
  gantryBoost: number;
  /** 路面 roughness（雨天更反光） */
  roadRoughness: number;
  rain: boolean;
}

const TIME_PRESETS: Record<TimeOfDay, Omit<EnvPreset, 'roadRoughness' | 'rain'>> = {
  day: {
    sunColor: 0xffe9c4, sunIntensity: 2.6, sunDir: [0.55, 0.8, 0.35],
    hemiSky: 0xbfd9e8, hemiGround: 0x3d4a2f, hemiIntensity: 0.9,
    fogColor: 0xbfd9e8, fogNear: 220, fogFar: 1100,
    skyTop: 0x2a5f9e, skyHorizon: 0xbfd9e8, skyBottom: 0x6b7a5a,
    exposure: 1.05, headlightGlow: 1, headlightBlob: 0, gantryBoost: 1,
  },
  sunset: {
    sunColor: 0xff9a4d, sunIntensity: 2.2, sunDir: [0.75, 0.35, 0.25],
    hemiSky: 0xd8a8c8, hemiGround: 0x3a3a30, hemiIntensity: 0.65,
    fogColor: 0xe8b890, fogNear: 180, fogFar: 950,
    skyTop: 0x4a3a7a, skyHorizon: 0xff9a5a, skyBottom: 0x5a4a3a,
    exposure: 1.0, headlightGlow: 1.2, headlightBlob: 0, gantryBoost: 1.6,
  },
  night: {
    sunColor: 0x8fa8e8, sunIntensity: 0.55, sunDir: [0.4, 0.7, 0.5],
    hemiSky: 0x2a3a5a, hemiGround: 0x0c1018, hemiIntensity: 0.28,
    fogColor: 0x0c1220, fogNear: 120, fogFar: 700,
    skyTop: 0x060a18, skyHorizon: 0x1a2a4a, skyBottom: 0x0a0e14,
    exposure: 0.9, headlightGlow: 2.2, headlightBlob: 0.75, gantryBoost: 2.2,
  },
};

const lerpColor = (a: number, b: number, t: number): number => {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return ca.lerp(cb, t).getHex();
};

/** 时间 × 天气组合出环境预设（纯函数，可测） */
export function resolveEnv(c: Conditions): EnvPreset {
  const base = TIME_PRESETS[c.time];
  const preset: EnvPreset = { ...base, roadRoughness: 0.95, rain: false };
  if (c.weather === 'rain') {
    // 雨天覆盖：阴沉灰调、浓雾、光照压暗
    preset.fogColor = lerpColor(preset.fogColor, 0x6a7078, 0.45);
    preset.fogNear *= 0.55;
    preset.fogFar *= 0.55;
    preset.skyTop = lerpColor(preset.skyTop, 0x6a7078, 0.5);
    preset.skyHorizon = lerpColor(preset.skyHorizon, 0x8a9098, 0.4);
    preset.hemiIntensity *= 0.85;
    preset.sunIntensity *= 0.8;
    preset.exposure *= 0.92;
    preset.roadRoughness = 0.55;
    preset.headlightGlow = Math.max(preset.headlightGlow, 1.5);
    preset.headlightBlob = Math.max(preset.headlightBlob, 0.4);
    preset.rain = true;
  }
  return preset;
}

export interface EnvRefs {
  sun: THREE.DirectionalLight;
  /** 主循环使用的可变太阳方向向量 */
  sunDir: THREE.Vector3;
  hemi: THREE.HemisphereLight;
  fog: THREE.Fog;
  skyMat: THREE.ShaderMaterial;
  renderer: THREE.WebGLRenderer;
  roadMats: { mat: THREE.MeshStandardMaterial; baseRoughness: number }[];
  glowMats: { mat: THREE.MeshStandardMaterial; base: number }[];
  headlightMats: THREE.MeshStandardMaterial[];
  headlightBlobMat: THREE.ShaderMaterial;
}

/** 应用环境参数（只改光照/材质/雾，不重建几何） */
export function applyEnvironment(p: EnvPreset, r: EnvRefs): void {
  r.sun.color.setHex(p.sunColor);
  r.sun.intensity = p.sunIntensity;
  r.sunDir.copy(new THREE.Vector3(...p.sunDir).normalize());
  r.hemi.color.setHex(p.hemiSky);
  r.hemi.groundColor.setHex(p.hemiGround);
  r.hemi.intensity = p.hemiIntensity;
  r.fog.color.setHex(p.fogColor);
  r.fog.near = p.fogNear;
  r.fog.far = p.fogFar;
  (r.skyMat.uniforms.top as { value: THREE.Color }).value.setHex(p.skyTop);
  (r.skyMat.uniforms.horizon as { value: THREE.Color }).value.setHex(p.skyHorizon);
  (r.skyMat.uniforms.bottom as { value: THREE.Color }).value.setHex(p.skyBottom);
  r.renderer.toneMappingExposure = p.exposure;
  for (const rm of r.roadMats) rm.mat.roughness = p.roadRoughness;
  for (const gm of r.glowMats) gm.mat.emissiveIntensity = gm.base * p.gantryBoost;
  for (const hm of r.headlightMats) hm.emissiveIntensity = 2.4 * p.headlightGlow;
  (r.headlightBlobMat.uniforms.uOpacity as { value: number }).value = p.headlightBlob;
}

/** 车头前方路面光斑（贴片假光，所有车共享一个材质） */
export function makeHeadlightBlobMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(0xfff2c8) },
      uOpacity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        // 纵向拉长的锥形光斑：前方远处更宽更淡
        vec2 p = vUv - vec2(0.5, 0.0);
        float lateral = smoothstep(0.5, 0.05, abs(p.x) / (0.25 + vUv.y * 0.8));
        float a = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y) * lateral;
        gl_FragColor = vec4(uColor * a, a * uOpacity);
      }
    `,
  });
}

export function makeHeadlightBlob(mat: THREE.ShaderMaterial): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(3.2, 9);
  geo.rotateX(-Math.PI / 2);
  const blob = new THREE.Mesh(geo, mat);
  blob.position.set(0, 0.06, 5.6);
  return blob;
}

const RAIN_COUNT = 800;

/** 雨粒子：相机周围循环下落的单 Points 系统（一次 draw call） */
export class RainFX {
  private points: THREE.Points;
  private posAttr: THREE.BufferAttribute;
  private speeds: Float32Array;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(RAIN_COUNT * 3), 3);
    geo.setAttribute('position', this.posAttr);
    this.speeds = new Float32Array(RAIN_COUNT);
    for (let i = 0; i < RAIN_COUNT; i++) this.speeds[i] = 14 + Math.random() * 8;

    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 32);
    grad.addColorStop(0, 'rgba(200,220,255,0)');
    grad.addColorStop(0.5, 'rgba(200,220,255,0.85)');
    grad.addColorStop(1, 'rgba(200,220,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 8, 32);
    const tex = new THREE.CanvasTexture(canvas);

    const mat = new THREE.PointsMaterial({
      size: 0.55,
      map: tex,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  setEnabled(enabled: boolean): void {
    this.points.visible = enabled;
  }

  /** 每帧：以相机为中心下落并循环重生（跟随 P1 相机） */
  update(dt: number, camPos: THREE.Vector3): void {
    if (!this.points.visible) return;
    const arr = this.posAttr.array as Float32Array;
    for (let i = 0; i < RAIN_COUNT; i++) {
      const o = i * 3;
      arr[o] += 1.5 * dt; // 横向风
      arr[o + 1] -= this.speeds[i] * dt;
      if (arr[o + 1] < camPos.y - 2) {
        arr[o] = camPos.x + (Math.random() - 0.5) * 34;
        arr[o + 1] = camPos.y + 5 + Math.random() * 12;
        arr[o + 2] = camPos.z + (Math.random() - 0.5) * 34;
      }
      // 漂离过远时拉回
      if (Math.abs(arr[o] - camPos.x) > 20) arr[o] = camPos.x + (Math.random() - 0.5) * 34;
      if (Math.abs(arr[o + 2] - camPos.z) > 20) arr[o + 2] = camPos.z + (Math.random() - 0.5) * 34;
    }
    this.posAttr.needsUpdate = true;
  }
}

/** 雨强度 -> 雨声音量（纯函数） */
export const rainVolume = (raining: boolean): number => (raining ? 0.14 : 0);
