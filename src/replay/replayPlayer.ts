import * as THREE from 'three';
import { clamp, lerp, wrapAngle } from '../utils/math';
import type { Car } from '../car/car';
import { ChaseCamera } from '../race/chaseCamera';
import { FLAG_BRAKE, FLAG_NITRO, type ReplayCarData, type ReplayData } from './recorder';

export interface ReplayPose {
  x: number;
  y: number;
  z: number;
  rotX: number;
  heading: number;
  steer: number;
  spin: number;
  nitro: boolean;
  brake: boolean;
  /** 采样段平均速度（相机 FOV 用） */
  speed: number;
}

/** 时间 t 处的插值采样；cursors 为每车游标（顺序播放 O(1)，拖动后退 O(n)） */
export function sampleAt(
  tr: ReplayCarData,
  t: number,
  cursors: number[],
  idx: number,
): ReplayPose {
  let i = cursors[idx];
  while (i < tr.n - 2 && tr.times[i + 1] < t) i++;
  while (i > 0 && tr.times[i] > t) i--;
  cursors[idx] = i;

  const j = i + 1 < tr.n ? i + 1 : i;
  const t0 = tr.times[i];
  const t1 = tr.times[j];
  const f = t1 > t0 ? clamp((t - t0) / (t1 - t0), 0, 1) : 0;

  const flags = f < 0.5 ? tr.flags[i] : tr.flags[j];
  const segDist = Math.hypot(tr.x[j] - tr.x[i], tr.y[j] - tr.y[i], tr.z[j] - tr.z[i]);

  return {
    x: lerp(tr.x[i], tr.x[j], f),
    y: lerp(tr.y[i], tr.y[j], f),
    z: lerp(tr.z[i], tr.z[j], f),
    rotX: lerp(tr.rotX[i], tr.rotX[j], f),
    heading: tr.heading[i] + wrapAngle(tr.heading[j] - tr.heading[i]) * f,
    steer: lerp(tr.steer[i], tr.steer[j], f),
    spin: lerp(tr.spin[i], tr.spin[j], f),
    nitro: (flags & FLAG_NITRO) !== 0,
    brake: (flags & FLAG_BRAKE) !== 0,
    speed: t1 > t0 ? segDist / (t1 - t0) : 0,
  };
}

/**
 * 回放播放器：用录制数据驱动现有车辆模型（不写物理），
 * 电视转播相机（6s 自动轮换 + 手动切换）。
 */
export class ReplayPlayer {
  playing = true;
  speed = 1;
  followIdx = 0;
  private time = 0;
  private autoT = 0;
  private cursors: number[];

  constructor(
    private data: ReplayData,
    private cars: Car[],
    private camera: THREE.PerspectiveCamera,
    private chase: ChaseCamera,
  ) {
    this.cursors = data.cars.map(() => 0);
    this.chase.snapBehind();
    this.update(0);
  }

  get duration(): number {
    return this.data.duration;
  }

  get currentTime(): number {
    return this.time;
  }

  get followName(): string {
    return this.data.cars[this.followIdx]?.name ?? '';
  }

  cycleFollow(): void {
    this.followIdx = (this.followIdx + 1) % this.cars.length;
    this.autoT = 0;
    this.chase.snapBehind();
  }

  togglePause(): void {
    this.playing = !this.playing;
  }

  setSpeed(s: number): void {
    this.speed = s;
  }

  seekBy(seconds: number): void {
    this.time = clamp(this.time + seconds, 0, this.data.duration);
  }

  update(dt: number): void {
    if (this.playing) {
      this.time = Math.min(this.time + dt * this.speed, this.data.duration);
    }
    this.autoT += dt;
    if (this.autoT >= 6) this.cycleFollow();

    let followedNitro = false;
    this.data.cars.forEach((tr, i) => {
      const pose = sampleAt(tr, this.time, this.cursors, i);
      const car = this.cars[i];
      car.applyReplayPose(pose);
      car.state.forwardSpeed = pose.speed;
      if (i === this.followIdx) followedNitro = pose.nitro;
    });

    const followed = this.cars[this.followIdx];
    if (followed) {
      this.chase.update(dt, followed, this.camera, followedNitro);
    }
  }
}
