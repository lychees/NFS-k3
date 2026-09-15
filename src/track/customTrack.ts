import type { TrackDef, TrackId } from './trackData';

/** 编辑器自定义赛道数据（localStorage 存储 / 导入导出格式） */
export interface CustomTrackData {
  id: string;
  name: string;
  closed: boolean;
  /** 控制点 [x, y(高度), z] */
  points: [number, number, number][];
  halfWidth: number;
  hills: number;
  vegetation: number;
  custom: true;
  /** 起点控制点下标（闭合任意；开放仅端点），缺省 0 */
  startIndex?: number;
  /** 发车方向：1 沿点序 / -1 反向，缺省 1 */
  direction?: 1 | -1;
}

export const TRACK_FORMAT = 'retro-rush-track@1';
export const MIN_POINTS_CLOSED = 8;
export const MIN_POINTS_OPEN = 6;
export const MIN_SEGMENT = 12; // 相邻控制点最小间距（米）

let customSeq = 0;
export const newCustomId = (): TrackId =>
  `custom-${Date.now().toString(36)}-${(customSeq++).toString(36)}`;

// ---------- 校验（纯函数，可测） ----------

export interface ValidationIssue {
  level: 'error' | 'warn';
  msg: string;
}

type P2 = readonly [number, number];

/** 线段相交检测（2D，跨立试验，含共线重叠视为相交） */
export function segmentsIntersect(a1: P2, a2: P2, b1: P2, b2: P2): boolean {
  const d = (p: P2, q: P2, r: P2): number =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = d(b1, b2, a1);
  const d2 = d(b1, b2, a2);
  const d3 = d(a1, a2, b1);
  const d4 = d(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** 非相邻线段对的自交列表（闭合道含首尾相邻段排除） */
export function selfIntersections(
  points: readonly (readonly [number, number])[],
  closed: boolean,
): [number, number][] {
  const n = points.length;
  const segCount = closed ? n : n - 1;
  const at = (i: number): P2 => points[((i % n) + n) % n];
  const out: [number, number][] = [];
  for (let i = 0; i < segCount; i++) {
    for (let j = i + 1; j < segCount; j++) {
      // 跳过相邻段（共享端点）
      if (j === i + 1) continue;
      if (closed && i === 0 && j === segCount - 1) continue;
      if (segmentsIntersect(at(i), at(i + 1), at(j), at(j + 1))) out.push([i, j]);
    }
  }
  return out;
}

export function validateEditorTrack(t: {
  closed: boolean;
  points: readonly (readonly [number, number, number])[];
  halfWidth: number;
}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const min = t.closed ? MIN_POINTS_CLOSED : MIN_POINTS_OPEN;
  if (t.points.length < min) {
    issues.push({ level: 'error', msg: `点数不足：${t.closed ? '闭合' : '开放'}至少 ${min} 个（当前 ${t.points.length}）` });
  }
  for (const p of t.points) {
    if (!p.every((v) => Number.isFinite(v))) {
      issues.push({ level: 'error', msg: '存在非法坐标' });
      break;
    }
  }
  const n = t.points.length;
  const segCount = t.closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const a = t.points[i];
    const b = t.points[(i + 1) % n];
    if (Math.hypot(a[0] - b[0], a[2] - b[2]) < MIN_SEGMENT) {
      issues.push({ level: 'error', msg: `第 ${i + 1} 段过短（< ${MIN_SEGMENT}m）` });
      break;
    }
  }
  if (t.halfWidth < 3 || t.halfWidth > 12) {
    issues.push({ level: 'error', msg: '路宽需在 3-12m 之间' });
  }
  const xz = t.points.map((p) => [p[0], p[2]] as const);
  const inter = selfIntersections(xz, t.closed);
  if (inter.length > 0) {
    issues.push({ level: 'warn', msg: `检测到 ${inter.length} 处自交（可保存但可能影响里程判定）` });
  }
  return issues;
}

// ---------- 几何助手（纯函数，可测） ----------

/** 点到线段最近距离 */
export function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let s = len2 > 1e-9 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
  s = Math.max(0, Math.min(1, s));
  return Math.hypot(px - (ax + abx * s), pz - (az + abz * s));
}

/** 距 (x,z) 最近的折线段下标（闭合含首尾段）；空点列返回 -1 */
export function nearestSegment(
  points: readonly (readonly [number, number])[],
  closed: boolean,
  x: number,
  z: number,
): { index: number; dist: number } {
  const n = points.length;
  if (n < 2) return { index: -1, dist: Infinity };
  const segCount = closed ? n : n - 1;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < segCount; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const d = distToSegment(x, z, a[0], a[1], b[0], b[1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { index: best, dist: bestD };
}

/** 在第 index 段中点插入新点（返回新数组，新点位于 index+1） */
export function insertPointAt(
  points: readonly (readonly [number, number, number])[],
  index: number,
): [number, number, number][] {
  const n = points.length;
  const i = ((index % n) + n) % n;
  const a = points[i];
  const b = points[(i + 1) % n];
  const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const out: [number, number, number][] = [];
  for (let k = 0; k <= i; k++) out.push([points[k][0], points[k][1], points[k][2]]);
  out.push(mid);
  for (let k = i + 1; k < n; k++) out.push([points[k][0], points[k][1], points[k][2]]);
  return out;
}

/** 网格吸附（grid<=0 时原样返回） */
export const snapToGrid = (v: number, grid: number): number =>
  grid > 0 ? Math.round(v / grid) * grid : v;

/** 起点/方向归一化：闭合旋转起点（反向时保起点反转其余）；开放反向 = 整列反转 */
export function applyStartAndDirection(
  points: readonly (readonly [number, number, number])[],
  closed: boolean,
  startIndex = 0,
  direction: 1 | -1 = 1,
): [number, number, number][] {
  const n = points.length;
  if (n === 0) return [];
  const pts = points.map((p) => [p[0], p[1], p[2]] as [number, number, number]);
  if (!closed) {
    const k = startIndex >= n - 1 ? n - 1 : Math.max(0, Math.floor(startIndex));
    // 开放：起点端点选择 与 方向反向 等价，XOR 判定
    const fromEnd = k === n - 1 !== (direction === -1);
    return fromEnd ? pts.reverse() : pts;
  }
  const k = ((Math.floor(startIndex) % n) + n) % n;
  const rotated = [...pts.slice(k), ...pts.slice(0, k)];
  if (direction === -1) {
    return [rotated[0], ...rotated.slice(1).reverse()];
  }
  return rotated;
}

/** 兼容缺省字段的起点/方向读取 */
export const startIndexOf = (d: CustomTrackData): number => d.startIndex ?? 0;
export const directionOf = (d: CustomTrackData): 1 | -1 => (d.direction === -1 ? -1 : 1);

// ---------- 撤销/重做栈（快照式，可测） ----------

export class HistoryStack<S> {
  private undoItems: S[] = [];
  private redoItems: S[] = [];

  constructor(private cap = 40) {}

  get canUndo(): boolean {
    return this.undoItems.length > 0;
  }

  get canRedo(): boolean {
    return this.redoItems.length > 0;
  }

  get size(): number {
    return this.undoItems.length;
  }

  /** 提交一个新状态（调用前应先 push 旧状态快照；新变更清空 redo） */
  push(snapshot: S): void {
    this.undoItems.push(snapshot);
    if (this.undoItems.length > this.cap) this.undoItems.shift();
    this.redoItems = [];
  }

  /** current 为当前状态（转入 redo），返回应恢复到的状态 */
  undo(current: S): S | null {
    const prev = this.undoItems.pop();
    if (prev === undefined) return null;
    this.redoItems.push(current);
    return prev;
  }

  /** current 为当前状态（转入 undo），返回应重做到的状态 */
  redo(current: S): S | null {
    const next = this.redoItems.pop();
    if (next === undefined) return null;
    this.undoItems.push(current);
    return next;
  }

  clear(): void {
    this.undoItems = [];
    this.redoItems = [];
  }
}

// ---------- 序列化 / 反序列化 ----------

export function serializeTrack(data: CustomTrackData): string {
  return JSON.stringify({ format: TRACK_FORMAT, ...data });
}

export function parseTrack(json: string): { data: CustomTrackData | null; error: string | null } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { data: null, error: 'JSON 解析失败' };
  }
  const o = raw as Partial<CustomTrackData> & { format?: string };
  if (o.format !== TRACK_FORMAT) return { data: null, error: '格式标识不符' };
  if (typeof o.name !== 'string' || o.name.length === 0) return { data: null, error: '缺少名称' };
  if (!Array.isArray(o.points) || o.points.some((p) => !Array.isArray(p) || p.length !== 3)) {
    return { data: null, error: 'points 格式错误' };
  }
  const n = o.points.length;
  const rawStart = typeof o.startIndex === 'number' && Number.isFinite(o.startIndex) ? Math.floor(o.startIndex) : 0;
  const data: CustomTrackData = {
    id: typeof o.id === 'string' && o.id.length > 0 ? o.id : newCustomId(),
    name: o.name.slice(0, 24),
    closed: o.closed === true,
    points: o.points.map((p) => [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0]),
    halfWidth: typeof o.halfWidth === 'number' ? o.halfWidth : 7,
    hills: typeof o.hills === 'number' ? o.hills : 1,
    vegetation: typeof o.vegetation === 'number' ? o.vegetation : 1,
    custom: true,
    startIndex:
      n === 0 ? 0 : o.closed === true ? ((rawStart % n) + n) % n : rawStart >= n - 1 ? n - 1 : 0,
    direction: o.direction === -1 ? -1 : 1,
  };
  const issues = validateEditorTrack(data);
  const err = issues.find((i) => i.level === 'error');
  if (err) return { data: null, error: err.msg };
  return { data, error: null };
}

// ---------- 转换 ----------

/** 估算闭合长度（控制点折线，用于采样数） */
function polylineLength(points: readonly (readonly [number, number, number])[], closed: boolean): number {
  let len = 0;
  const n = points.length;
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    len += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }
  return len;
}

/** 自定义数据 -> 完整 TrackDef（采样/检查点/圈数等推导；起点/方向在转换时归一化） */
export function toTrackDef(data: CustomTrackData): TrackDef {
  const points = applyStartAndDirection(data.points, data.closed, data.startIndex, data.direction);
  const estLen = polylineLength(points, data.closed) * 1.15; // 样条比折线略长
  return {
    id: data.id,
    name: data.name,
    closed: data.closed,
    points,
    halfWidth: data.halfWidth,
    runoffWidth: Math.max(2.5, data.halfWidth * 0.63),
    samples: Math.min(1600, Math.max(800, Math.round(estLen / 1.6))),
    checkpoints: data.closed ? 12 : 10,
    laps: data.closed ? 3 : 1,
    startOffset: data.closed ? 0 : 17,
    hills: data.hills,
    vegetation: data.vegetation,
  };
}
