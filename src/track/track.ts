import * as THREE from 'three';
import { CONTROL_POINTS, ROAD_HALF_WIDTH, RUNOFF_WIDTH, TRACK_SAMPLES } from './trackData';
import { clamp, wrap01 } from '../utils/math';

export interface TrackSample {
  pos: THREE.Vector3;
  /** 水平化后的前进方向 */
  tangent: THREE.Vector3;
  /** 水平左向单位向量 */
  left: THREE.Vector3;
}

export interface NearestResult {
  /** 弧长参数 [0,1) */
  t: number;
  /** 赛道中心线上的投影点 */
  pos: THREE.Vector3;
  left: THREE.Vector3;
  /** 有符号横向偏移，左正右负 */
  lateral: number;
  /** 到中心线的水平距离 */
  distance: number;
}

export const headingFromTangent = (tangent: THREE.Vector3): number =>
  Math.atan2(tangent.x, tangent.z);

/** 闭合 Catmull-Rom 样条赛道：弧长均匀采样 + 最近点查询 */
export class Track {
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  readonly halfWidth = ROAD_HALF_WIDTH;
  readonly runoffWidth = RUNOFF_WIDTH;
  readonly samples: TrackSample[] = [];

  constructor() {
    this.curve = new THREE.CatmullRomCurve3(CONTROL_POINTS, true, 'catmullrom', 0.5);
    this.length = this.curve.getLength();

    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < TRACK_SAMPLES; i++) {
      const t = i / TRACK_SAMPLES;
      const pos = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t);
      tangent.y = 0;
      if (tangent.lengthSq() < 1e-8) tangent.set(0, 0, 1);
      tangent.normalize();
      const left = new THREE.Vector3().crossVectors(up, tangent).normalize();
      this.samples.push({ pos, tangent, left });
    }
  }

  /** 弧长参数 -> 里程（米） */
  tAtDistance(dist: number): number {
    return wrap01(dist / this.length);
  }

  /** 插值采样（返回新对象，供 AI / 相机等低频使用） */
  sampleAt(t: number): TrackSample {
    const u = wrap01(t) * TRACK_SAMPLES;
    const i0 = Math.floor(u) % TRACK_SAMPLES;
    const i1 = (i0 + 1) % TRACK_SAMPLES;
    const f = u - Math.floor(u);
    const a = this.samples[i0];
    const b = this.samples[i1];
    return {
      pos: a.pos.clone().lerp(b.pos, f),
      tangent: a.tangent.clone().lerp(b.tangent, f).normalize(),
      left: a.left.clone().lerp(b.left, f).normalize(),
    };
  }

  /** 世界坐标 -> 赛道局部坐标（最近点粗查 + 相邻线段投影细化） */
  nearest(p: THREE.Vector3): NearestResult {
    const n = this.samples.length;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const s = this.samples[i].pos;
      const dx = p.x - s.x;
      const dz = p.z - s.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }

    const prev = this.projectOnSegment(p, (best - 1 + n) % n, best);
    const next = this.projectOnSegment(p, best, (best + 1) % n);
    const seg = next.d2 <= prev.d2 ? next : prev;

    const t = wrap01((seg.i0 + seg.s) / n);
    const a = this.samples[seg.i0];
    const b = this.samples[(seg.i0 + 1) % n];
    const pos = a.pos.clone().lerp(b.pos, seg.s);
    const left = a.left.clone().lerp(b.left, seg.s).normalize();
    const lateral = (p.x - pos.x) * left.x + (p.z - pos.z) * left.z;
    return { t, pos, left, lateral, distance: Math.sqrt(seg.d2) };
  }

  private projectOnSegment(
    p: THREE.Vector3,
    i0: number,
    i1: number,
  ): { i0: number; s: number; d2: number } {
    const a = this.samples[i0].pos;
    const b = this.samples[i1].pos;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    let s = len2 > 1e-9 ? ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2 : 0;
    s = clamp(s, 0, 1);
    const dx = p.x - (a.x + abx * s);
    const dz = p.z - (a.z + abz * s);
    return { i0, s, d2: dx * dx + dz * dz };
  }
}
