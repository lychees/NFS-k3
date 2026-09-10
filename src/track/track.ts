import * as THREE from 'three';
import { clamp, wrap01 } from '../utils/math';
import type { TrackDef } from './trackData';

export interface TrackSample {
  pos: THREE.Vector3;
  /** 水平化后的前进方向 */
  tangent: THREE.Vector3;
  /** 水平左向单位向量 */
  left: THREE.Vector3;
}

export interface NearestResult {
  /** 弧长参数 [0,1]（闭合赛道回绕到 [0,1)） */
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

/** Catmull-Rom 样条赛道：闭合环道与开放点对点共用一套采样/查询代码 */
export class Track {
  readonly def: TrackDef;
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  readonly closed: boolean;
  readonly samples: TrackSample[] = [];

  constructor(def: TrackDef) {
    this.def = def;
    this.closed = def.closed;
    const points = def.points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    this.curve = new THREE.CatmullRomCurve3(points, def.closed, 'catmullrom', 0.5);
    this.length = this.curve.getLength();

    const up = new THREE.Vector3(0, 1, 0);
    const n = def.samples;
    for (let i = 0; i < n; i++) {
      const t = def.closed ? i / n : i / (n - 1);
      const pos = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t);
      tangent.y = 0;
      if (tangent.lengthSq() < 1e-8) tangent.set(0, 0, 1);
      tangent.normalize();
      const left = new THREE.Vector3().crossVectors(up, tangent).normalize();
      this.samples.push({ pos, tangent, left });
    }
  }

  get halfWidth(): number {
    return this.def.halfWidth;
  }

  get runoffWidth(): number {
    return this.def.runoffWidth;
  }

  /** 里程（米）-> 弧长参数：闭合回绕，开放钳制 */
  tAtDistance(dist: number): number {
    const t = dist / this.length;
    return this.closed ? wrap01(t) : clamp(t, 0, 1);
  }

  /** 插值采样（返回新对象，供 AI / 相机等低频使用） */
  sampleAt(t: number): TrackSample {
    const n = this.samples.length;
    const u = (this.closed ? wrap01(t) : clamp(t, 0, 1)) * (this.closed ? n : n - 1);
    const i0 = this.closed ? Math.floor(u) % n : Math.min(Math.floor(u), n - 2);
    const i1 = this.closed ? (i0 + 1) % n : i0 + 1;
    const f = clamp(u - Math.floor(u), 0, 1);
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

    const hasPrev = this.closed || best > 0;
    const hasNext = this.closed || best < n - 1;
    const prev = hasPrev
      ? this.projectOnSegment(p, (best - 1 + n) % n, best)
      : null;
    const next = hasNext ? this.projectOnSegment(p, best, (best + 1) % n) : null;
    const seg =
      prev === null ? next! : next === null ? prev : next.d2 <= prev.d2 ? next : prev;

    const divisor = this.closed ? n : n - 1;
    const tRaw = (seg.i0 + seg.s) / divisor;
    const t = this.closed ? wrap01(tRaw) : clamp(tRaw, 0, 1);
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
