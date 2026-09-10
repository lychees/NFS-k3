import type { Car } from '../car/car';

export const FLAG_NITRO = 1;
export const FLAG_BRAKE = 2;
export const FLAG_PARKED = 4;

/** 录制源：车辆 + 淘汰停车状态查询 */
export interface ReplayEntry {
  car: Car;
  name: string;
  color: number;
  parked: () => boolean;
}

export interface ReplayCarData {
  name: string;
  color: number;
  /** 有效采样数 */
  n: number;
  times: Float32Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  rotX: Float32Array;
  heading: Float32Array;
  steer: Float32Array;
  spin: Float32Array;
  flags: Uint8Array;
}

export interface ReplayData {
  cars: ReplayCarData[];
  duration: number;
}

/**
 * 比赛录制器：10Hz 采样每辆车的视觉状态。
 * 内存上限：6 车 × 3601 样本 × 11 字段 ≈ 950KB（Float32Array 预分配）。
 */
export class Recorder {
  private hz: number;
  private maxSamples: number;
  private tracks: ReplayCarData[] | null = null;
  private entries: ReplayEntry[] = [];
  private nextT = 0;
  recording = false;

  constructor(hz = 10, maxSeconds = 360) {
    this.hz = hz;
    this.maxSamples = Math.ceil(maxSeconds * hz) + 1;
  }

  begin(entries: ReplayEntry[]): void {
    this.entries = entries;
    this.tracks = entries.map((e) => ({
      name: e.name,
      color: e.color,
      n: 0,
      times: new Float32Array(this.maxSamples),
      x: new Float32Array(this.maxSamples),
      y: new Float32Array(this.maxSamples),
      z: new Float32Array(this.maxSamples),
      rotX: new Float32Array(this.maxSamples),
      heading: new Float32Array(this.maxSamples),
      steer: new Float32Array(this.maxSamples),
      spin: new Float32Array(this.maxSamples),
      flags: new Uint8Array(this.maxSamples),
    }));
    this.nextT = 0;
    this.recording = true;
  }

  /** 每帧调用；内部按固定网格采样（无漂移），录满上限自动停 */
  frame(raceTime: number): void {
    if (!this.recording || !this.tracks || raceTime < this.nextT) return;
    this.nextT += 1 / this.hz;
    this.tracks.forEach((tr, i) => {
      if (tr.n >= this.maxSamples) return;
      const c = this.entries[i].car;
      const n = tr.n++;
      tr.times[n] = raceTime;
      tr.x[n] = c.pos.x;
      tr.y[n] = c.pos.y;
      tr.z[n] = c.pos.z;
      tr.rotX[n] = c.group.rotation.x;
      tr.heading[n] = c.state.heading;
      tr.steer[n] = c.state.steer;
      tr.spin[n] = c.wheelSpinAngle;
      let f = 0;
      if (c.state.nitroActive) f |= FLAG_NITRO;
      if (c.input.brake > 0) f |= FLAG_BRAKE;
      if (this.entries[i].parked()) f |= FLAG_PARKED;
      f |= c.damageTier << 3; // 损伤档位（bit3-4）
      tr.flags[n] = f;
    });
    if (this.tracks.every((tr) => tr.n >= this.maxSamples)) this.recording = false;
  }

  stop(): ReplayData | null {
    this.recording = false;
    if (!this.tracks || this.tracks.some((tr) => tr.n < 2)) return null;
    const duration = Math.max(...this.tracks.map((tr) => tr.times[tr.n - 1]));
    return { cars: this.tracks, duration };
  }
}
