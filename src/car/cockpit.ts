import * as THREE from 'three';
import { clamp } from '../utils/math';

/** 仪表量程：极速表固定 300 km/h（覆盖满改 + 氮气 290 km/h） */
const SPEED_MAX = 300;
const GAUGE_START = Math.PI * 0.75; // ratio=0 指针位置（左下，逆时针 135°）
const GAUGE_SWEEP = -Math.PI * 1.5; // ratio=1 到右下

/** 仪表映射（纯函数，可测）：ratio 0..1 -> 指针 rotation.z */
export const gaugeAngle = (ratio: number): number =>
  GAUGE_START + clamp(Number.isFinite(ratio) ? ratio : 0, 0, 1) * GAUGE_SWEEP;

export const speedRatio = (speedKmh: number): number =>
  clamp(speedKmh / SPEED_MAX, 0, 1);

const GAUGE_TICKS = 12;

/** 一次性生成表盘纹理（刻度弧与指针共用同一角度公式） */
function makeDialTexture(label: string, redline: boolean): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.42;

  ctx.fillStyle = '#0a0c12';
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.48, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffd320';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.46, 0, Math.PI * 2);
  ctx.stroke();

  for (let i = 0; i <= GAUGE_TICKS; i++) {
    const ratio = i / GAUGE_TICKS;
    const a = gaugeAngle(ratio);
    const major = i % 3 === 0;
    if (redline && ratio > 0.85) ctx.strokeStyle = '#ff3b30';
    else ctx.strokeStyle = major ? '#f2f2f2' : '#8a93a8';
    ctx.lineWidth = major ? 4 : 2;
    const r0 = major ? r * 0.72 : r * 0.8;
    ctx.beginPath();
    ctx.moveTo(cx - Math.sin(a) * r0, cy - Math.cos(a) * r0);
    ctx.lineTo(cx - Math.sin(a) * r, cy - Math.cos(a) * r);
    ctx.stroke();
  }

  ctx.fillStyle = '#ffd320';
  ctx.font = 'italic 900 15px "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy + size * 0.3);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeDial(label: string, redline: boolean): { group: THREE.Group; needle: THREE.Mesh } {
  const group = new THREE.Group();
  const tex = makeDialTexture(label, redline);
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.062, 24),
    new THREE.MeshStandardMaterial({
      map: tex,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 0.75,
    }),
  );
  group.add(face);

  const needleGeo = new THREE.BoxGeometry(0.005, 0.05, 0.004);
  needleGeo.translate(0, 0.021, 0);
  const needle = new THREE.Mesh(
    needleGeo,
    new THREE.MeshStandardMaterial({
      color: 0x1a0505,
      emissive: 0xff3b30,
      emissiveIntensity: 2.2,
    }),
  );
  needle.position.z = -0.004;
  group.add(needle);
  return { group, needle };
}

/**
 * 驾驶舱内饰：方向盘（随转向转动）、双仪表（速度/转速）、
 * 氮气存量条、刹车指示灯、仪表台罩与 A 柱/车顶内衬边缘。
 * 挂在车辆容器下，姿态由 Car 每帧同步（随车身俯仰侧倾）。
 */
export class Cockpit {
  readonly group = new THREE.Group();
  private wheel = new THREE.Group();
  private speedNeedle: THREE.Mesh;
  private rpmNeedle: THREE.Mesh;
  private nitroFill: THREE.Mesh;
  private brakeMat: THREE.MeshStandardMaterial;
  private instrAcc = 0;

  constructor() {
    const trim = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.7 });

    // 仪表台罩
    const cowl = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.2, 0.34), trim);
    cowl.position.set(0, 0.88, 0.72);
    cowl.rotation.x = 0.12;
    this.group.add(cowl);

    // A 柱 + 车顶内衬边缘（营造车内包围感）
    for (const sx of [0.62, -0.62]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.72, 0.1), trim);
      pillar.position.set(sx, 1.06, 0.52);
      pillar.rotation.x = -0.5;
      this.group.add(pillar);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.06, 0.8), trim);
    roof.position.set(0, 1.26, 0.05);
    this.group.add(roof);

    // 方向盘：圆环 + 三辐条 + 转向柱
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1c1e24, roughness: 0.5 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 8, 24), wheelMat);
    this.wheel.add(ring);
    for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
      const spokeGeo = new THREE.BoxGeometry(0.02, 0.17, 0.012);
      spokeGeo.translate(0, 0.085, 0);
      const spoke = new THREE.Mesh(spokeGeo, wheelMat);
      spoke.rotation.z = a;
      this.wheel.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 10), trim);
    hub.rotation.x = Math.PI / 2;
    this.wheel.add(hub);
    this.wheel.position.set(-0.42, 0.94, 0.42);
    this.wheel.rotation.x = -0.42;
    this.group.add(this.wheel);

    const columnGeo = new THREE.CylinderGeometry(0.02, 0.03, 0.3, 8);
    const column = new THREE.Mesh(columnGeo, trim);
    column.position.set(-0.42, 0.84, 0.52);
    column.rotation.x = -1.05;
    this.group.add(column);

    // 双仪表（面向驾驶员）
    const speedDial = makeDial('km/h', false);
    speedDial.group.position.set(-0.56, 1.0, 0.66);
    const rpmDial = makeDial('RPM', true);
    rpmDial.group.position.set(-0.28, 1.0, 0.66);
    this.speedNeedle = speedDial.needle;
    this.rpmNeedle = rpmDial.needle;
    this.group.add(speedDial.group, rpmDial.group);

    // 氮气存量发光条（左锚点缩放）
    const nitroBg = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.018, 0.006),
      new THREE.MeshStandardMaterial({ color: 0x06141c, roughness: 0.6 }),
    );
    nitroBg.position.set(0.02, 0.99, 0.665);
    this.group.add(nitroBg);
    const fillGeo = new THREE.BoxGeometry(0.136, 0.012, 0.008);
    fillGeo.translate(0.068, 0, 0);
    this.nitroFill = new THREE.Mesh(
      fillGeo,
      new THREE.MeshStandardMaterial({
        color: 0x042028,
        emissive: 0x18e0ff,
        emissiveIntensity: 2.2,
      }),
    );
    this.nitroFill.position.set(-0.048, 0.99, 0.662);
    this.group.add(this.nitroFill);

    // 刹车指示灯
    this.brakeMat = new THREE.MeshStandardMaterial({
      color: 0x200505,
      emissive: 0xff2020,
      emissiveIntensity: 0.15,
    });
    const brake = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.018, 0.006), this.brakeMat);
    brake.position.set(0.2, 0.99, 0.665);
    this.group.add(brake);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /** 方向盘每帧；仪表 15Hz 节流 */
  update(dt: number, steer: number, speedKmh: number, rpm01: number, nitroRatio: number, braking: boolean): void {
    this.wheel.rotation.z = steer * 2.2;

    this.instrAcc += dt;
    if (this.instrAcc < 1 / 15) return;
    this.instrAcc = 0;
    this.speedNeedle.rotation.z = gaugeAngle(speedRatio(speedKmh));
    this.rpmNeedle.rotation.z = gaugeAngle(rpm01);
    this.nitroFill.scale.x = Math.max(nitroRatio, 0.001);
    this.brakeMat.emissiveIntensity = braking ? 3 : 0.15;
  }
}
