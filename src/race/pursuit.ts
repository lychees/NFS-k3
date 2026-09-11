import * as THREE from 'three';
import { Car } from '../car/car';
import { makeTuning } from '../car/carPhysics';
import { PursuitDriver } from '../ai/pursuitDriver';
import { clamp } from '../utils/math';
import type { Track } from '../track/track';

/** 逮捕判定参数 */
export const BUST_DISTANCE = 3.5; // 贴近距离（米）
export const BUST_SPEED = 6; // 玩家速度阈值（m/s）
export const BUST_TIME = 1.5; // 持续时长（秒）
const REDEPLOY_BEHIND = 500; // 落后超过该里程重新部署
const REDEPLOY_AHEAD = 350; // 重新部署在玩家前方
const START_DELAY = 2; // 警车起步延迟（玩家先发）

interface PoliceUnit {
  car: Car;
  driver: PursuitDriver;
  progress: number;
  lastT: number;
  redMat: THREE.MeshStandardMaterial;
  blueMat: THREE.MeshStandardMaterial;
  lightBar: THREE.Group;
}

const POLICE_APPEARANCE = { paint: 0x14161c, spoiler: 'low' as const, rims: 'dish' as const, underglow: null, vehicle: 'police' as const };
const POLICE_LIVERY = { id: 'twotone' as const, accent: 0xf2f2f2, number: 0 };

/** 车顶爆闪灯条：红蓝发光盒交替高亮（位置按车型车顶高度） */
function buildLightBar(car: Car): {
  redMat: THREE.MeshStandardMaterial;
  blueMat: THREE.MeshStandardMaterial;
  group: THREE.Group;
} {
  const group = new THREE.Group();
  const roofY = car.model.metrics.roofY;
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.07, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.5 }),
  );
  base.position.set(0, roofY + 0.06, -0.5);
  group.add(base);
  const redMat = new THREE.MeshStandardMaterial({ color: 0x200505, emissive: 0xff2020, emissiveIntensity: 3 });
  const blueMat = new THREE.MeshStandardMaterial({ color: 0x050520, emissive: 0x2040ff, emissiveIntensity: 0.25 });
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.3), redMat);
  red.position.set(-0.23, roofY + 0.15, -0.5);
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.3), blueMat);
  blue.position.set(0.23, roofY + 0.15, -0.5);
  group.add(red, blue);
  car.model.body.add(group);
  return { redMat, blueMat, group };
}

/**
 * HOT PURSUIT 警车管理：2 辆警车追捕玩家，
 * 逮捕计时 / 落后重部署 / 爆闪 / 警笛电平。警车不参与比赛排名。
 */
export class PursuitManager {
  readonly cars: Car[] = [];
  busted = false;
  nearestDist = Infinity;

  private units: PoliceUnit[] = [];
  private bustTimer = 0;
  private delay = START_DELAY;
  private strobeT = 0;
  active = false;

  constructor(parent: THREE.Group | THREE.Scene) {
    for (let i = 0; i < 2; i++) {
      const car = new Car(
        `POLICE-${i + 1}`,
        POLICE_APPEARANCE,
        makeTuning({ engine: 4, tires: 3, nitro: 0 }),
        POLICE_LIVERY,
      );
      const { redMat, blueMat, group } = buildLightBar(car);
      car.group.visible = false;
      parent.add(car.group);
      this.cars.push(car);
      this.units.push({ car, driver: new PursuitDriver(i + 11), progress: 0, lastT: 0, redMat, blueMat, lightBar: group });
    }
  }

  /** GLB 模板就绪后换装警车模型并重新挂爆闪灯（旧模型已随换装销毁） */
  refreshModels(template: import('../car/glbCar').GlbTemplate | null): void {
    for (const u of this.units) {
      u.car.rebuildVisual(POLICE_APPEARANCE, POLICE_LIVERY, template);
      const { redMat, blueMat, group } = buildLightBar(u.car);
      u.redMat = redMat;
      u.blueMat = blueMat;
      u.lightBar = group;
    }
  }

  setVisible(visible: boolean): void {
    this.active = visible;
    for (const u of this.units) u.car.group.visible = visible;
  }

  reset(track: Track): void {
    this.busted = false;
    this.bustTimer = 0;
    this.delay = START_DELAY;
    this.nearestDist = Infinity;
    // 警车在玩家发车格（17m）之后起步
    this.units.forEach((u, i) => {
      const dist = 8 - i * 7;
      u.car.reset(track, dist, i === 0 ? 2.2 : -2.2);
      u.progress = dist;
      u.lastT = u.car.trackT;
    });
  }

  /** racing=false 时只做爆闪等视觉更新（比赛结束后不再逮捕） */
  update(dt: number, track: Track, player: Car, playerProgress: number, racing: boolean): void {
    if (!this.active) return;
    this.strobeT += dt;
    const phase = Math.floor(this.strobeT * 4) % 2;
    for (const u of this.units) {
      u.redMat.emissiveIntensity = phase === 0 ? 3.2 : 0.25;
      u.blueMat.emissiveIntensity = phase === 1 ? 3.2 : 0.25;
    }

    if (racing) this.delay = Math.max(0, this.delay - dt);

    this.nearestDist = Infinity;
    for (const u of this.units) {
      const car = u.car;
      if (racing) {
        // 追捕驾驶（起步延迟内怠速；不能踩刹车——刹车在静止时会变倒车）
        if (this.delay > 0) {
          car.input = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
        } else {
          const gap = u.progress - playerProgress;
          const capMult = gap < -80 ? 1.12 : gap > 60 ? 0.82 : 1.04;
          car.input = u.driver.computeInput(car, track, player, capMult, dt);
        }
        car.update(dt, track);

        // 里程累计（开放样条单调）
        const dm = (car.trackT - u.lastT) * track.length;
        if (Math.abs(dm) < 40) u.progress += dm;
        u.lastT = car.trackT;

        // 被甩开太远：前方重新部署（模拟增援）
        if (u.progress < playerProgress - REDEPLOY_BEHIND) {
          this.redeploy(u, track, playerProgress);
        }
      }

      const d = Math.hypot(car.pos.x - player.pos.x, car.pos.z - player.pos.z);
      this.nearestDist = Math.min(this.nearestDist, d);
    }

    // 逮捕判定：贴近 + 玩家低速，持续计时；条件消失则快速消退
    if (racing && this.delay <= 0) {
      const trapped =
        this.nearestDist < BUST_DISTANCE && Math.abs(player.state.forwardSpeed) < BUST_SPEED;
      this.bustTimer = trapped ? this.bustTimer + dt : Math.max(0, this.bustTimer - dt * 2);
      if (this.bustTimer >= BUST_TIME) this.busted = true;
    }
  }

  private redeploy(u: PoliceUnit, track: Track, playerProgress: number): void {
    const dist = playerProgress + REDEPLOY_AHEAD;
    const lat = (Math.random() - 0.5) * 4;
    u.car.reset(track, dist, lat);
    // 部署即带速，避免静止路障
    const s = track.sampleAt(u.car.trackT);
    u.car.state.vx = s.tangent.x * 26;
    u.car.state.vz = s.tangent.z * 26;
    u.progress = dist;
    u.lastT = u.car.trackT;
  }

  /** 警笛音量电平：随最近警车距离衰减 */
  sirenLevel(): number {
    if (!this.active || !Number.isFinite(this.nearestDist)) return 0;
    return clamp(1 - (this.nearestDist - 20) / 120, 0, 1);
  }

  /** HEAT 警示强度（屏幕红边脉冲） */
  heatLevel(): number {
    if (!this.active || !Number.isFinite(this.nearestDist)) return 0;
    return clamp(1 - (this.nearestDist - 25) / 100, 0, 1);
  }
}
