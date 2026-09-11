import * as THREE from 'three';
import {

  newCustomId,
  parseTrack,
  selfIntersections,
  serializeTrack,
  validateEditorTrack,
  type CustomTrackData,
  type ValidationIssue,
} from '../track/customTrack';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

export interface EditorCallbacks {
  onTestDrive: (data: CustomTrackData) => void;
  onBack: () => void;
  getCustomTracks: () => CustomTrackData[];
  onSaveCustomTracks: (tracks: CustomTrackData[]) => void;
}

interface Pt {
  x: number;
  y: number; // 高度
  z: number;
}

const DEFAULT_POINTS = (closed: boolean): Pt[] => {
  const n = closed ? 8 : 6;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    if (closed) {
      pts.push({ x: Math.cos(a) * 220, y: 0, z: Math.sin(a) * 160 });
    } else {
      pts.push({ x: -300 + i * 130 + (i % 2 === 0 ? 0 : 40), y: 0, z: (i % 2 === 0 ? -60 : 60) * (i / n) });
    }
  }
  return pts;
};

/** 2D 俯视赛道编辑器：加点/拖点/删点、属性、校验、保存、导入导出、试跑 */
export class TrackEditor {
  private root = el('screen-editor');
  private canvas = el<HTMLCanvasElement>('editor-canvas');
  private ctx: CanvasRenderingContext2D;
  private cbs: EditorCallbacks;

  // 编辑状态
  private trackId = '';
  private name = '我的赛道';
  private closed = true;
  private halfWidth = 7;
  private hills = 1;
  private vegetation = 1;
  private points: Pt[] = DEFAULT_POINTS(true);
  private selected = -1;

  // 视图变换：world(m) -> screen(px)
  private view = { cx: 0, cz: 0, scale: 1 };
  private panning: { startX: number; startY: number; cx: number, cz: number } | null = null;
  private dragging = -1;
  private downPos: [number, number] | null = null;

  private dirty = true;

  constructor(cbs: EditorCallbacks) {
    this.cbs = cbs;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('editor 2d context unavailable');
    this.ctx = ctx;
    this.bindControls();
    this.bindCanvas();
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(): void {
    this.root.classList.remove('hidden');
    this.refreshList();
    this.syncPanel();
    this.resize();
    this.fitView();
    this.dirty = true;
    this.loop();
  }

  close(): void {
    this.root.classList.add('hidden');
  }

  private resize(): void {
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    this.canvas.width = Math.max(400, Math.floor(rect.width));
    this.canvas.height = Math.max(300, Math.floor(rect.height));
    this.dirty = true;
  }

  // ---------- 数据 ----------

  private currentData(): CustomTrackData {
    return {
      id: this.trackId || newCustomId(),
      name: this.name || '未命名',
      closed: this.closed,
      points: this.points.map((p) => [p.x, p.y, p.z]),
      halfWidth: this.halfWidth,
      hills: this.hills,
      vegetation: this.vegetation,
      custom: true,
    };
  }

  private loadData(d: CustomTrackData): void {
    this.trackId = d.id;
    this.name = d.name;
    this.closed = d.closed;
    this.halfWidth = d.halfWidth;
    this.hills = d.hills;
    this.vegetation = d.vegetation;
    this.points = d.points.map((p) => ({ x: p[0], y: p[1], z: p[2] }));
    this.selected = -1;
    this.syncPanel();
    this.fitView();
    this.dirty = true;
  }

  private newTrack(): void {
    this.trackId = '';
    this.name = '我的赛道';
    this.points = DEFAULT_POINTS(this.closed);
    this.selected = -1;
    this.syncPanel();
    this.fitView();
    this.dirty = true;
  }

  // ---------- 面板 ----------

  private syncPanel(): void {
    el<HTMLInputElement>('editor-name').value = this.name;
    el('editor-type-closed').classList.toggle('selected', this.closed);
    el('editor-type-open').classList.toggle('selected', !this.closed);
    el<HTMLInputElement>('editor-width').value = String(this.halfWidth);
    el('editor-width-val').textContent = `${this.halfWidth.toFixed(1)}m`;
    el<HTMLInputElement>('editor-hills').value = String(this.hills);
    el('editor-hills-val').textContent = `×${this.hills.toFixed(1)}`;
    el<HTMLInputElement>('editor-veg').value = String(this.vegetation);
    el('editor-veg-val').textContent = `×${this.vegetation.toFixed(1)}`;
    this.syncSelected();
  }

  private syncSelected(): void {
    const has = this.selected >= 0 && this.selected < this.points.length;
    el('editor-sel-info').textContent = has
      ? `点 #${this.selected + 1} 高度 ${this.points[this.selected].y.toFixed(0)}m`
      : '未选中点（点击选中后用 [ ] 调高度）';
  }

  private refreshList(): void {
    const wrap = el('editor-track-list');
    wrap.innerHTML = '';
    const tracks = this.cbs.getCustomTracks();
    if (tracks.length === 0) {
      wrap.innerHTML = '<div class="editor-list-empty">暂无自定义赛道</div>';
      return;
    }
    tracks.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'editor-list-row';
      const btn = document.createElement('button');
      btn.className = 'option';
      btn.textContent = t.name;
      btn.addEventListener('click', () => this.loadData(t));
      const del = document.createElement('button');
      del.className = 'option editor-del';
      del.textContent = '删';
      del.title = '删除';
      del.addEventListener('click', () => {
        const list = this.cbs.getCustomTracks().filter((_, k) => k !== i);
        this.cbs.onSaveCustomTracks(list);
        this.refreshList();
      });
      row.appendChild(btn);
      row.appendChild(del);
      wrap.appendChild(row);
    });
  }

  private bindControls(): void {
    el('editor-close').addEventListener('click', () => this.cbs.onBack());
    el('editor-new').addEventListener('click', () => this.newTrack());
    el('editor-save').addEventListener('click', () => this.save());
    el('editor-export').addEventListener('click', () => this.doExport());
    el('editor-import').addEventListener('click', () => this.doImport());
    el('editor-test').addEventListener('click', () => this.testDrive());
    el<HTMLInputElement>('editor-name').addEventListener('input', (e) => {
      this.name = (e.target as HTMLInputElement).value;
      this.dirty = true;
    });
    el('editor-type-closed').addEventListener('click', () => {
      this.closed = true;
      this.syncPanel();
      this.dirty = true;
    });
    el('editor-type-open').addEventListener('click', () => {
      this.closed = false;
      this.syncPanel();
      this.dirty = true;
    });
    const slider = (id: string, valId: string, apply: (v: number) => void): void => {
      el<HTMLInputElement>(id).addEventListener('input', (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        apply(v);
        this.syncPanel();
        this.dirty = true;
        void valId;
      });
    };
    slider('editor-width', 'editor-width-val', (v) => (this.halfWidth = v));
    slider('editor-hills', 'editor-hills-val', (v) => (this.hills = v));
    slider('editor-veg', 'editor-veg-val', (v) => (this.vegetation = v));

    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.code === 'Delete' || e.code === 'Backspace') {
        if (this.selected >= 0 && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
          this.points.splice(this.selected, 1);
          this.selected = -1;
          this.syncSelected();
          this.dirty = true;
          e.preventDefault();
        }
      }
      if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
        if (this.selected >= 0) {
          this.points[this.selected].y += e.code === 'BracketRight' ? 2 : -2;
          this.syncSelected();
          this.dirty = true;
        }
      }
    });
  }

  // ---------- 画布交互 ----------

  private toWorld(sx: number, sy: number): [number, number] {
    return [
      (sx - this.canvas.width / 2) / this.view.scale + this.view.cx,
      (sy - this.canvas.height / 2) / this.view.scale + this.view.cz,
    ];
  }

  private toScreen(wx: number, wz: number): [number, number] {
    return [
      (wx - this.view.cx) * this.view.scale + this.canvas.width / 2,
      (wz - this.view.cz) * this.view.scale + this.canvas.height / 2,
    ];
  }

  private hitPoint(sx: number, sy: number): number {
    for (let i = this.points.length - 1; i >= 0; i--) {
      const [px, py] = this.toScreen(this.points[i].x, this.points[i].z);
      if (Math.hypot(px - sx, py - sy) < 12) return i;
    }
    return -1;
  }

  private bindCanvas(): void {
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const hit = this.hitPoint(sx, sy);
      if (e.button === 0) {
        this.downPos = [sx, sy];
        if (hit >= 0) {
          this.dragging = hit;
          this.selected = hit;
          this.syncSelected();
          this.dirty = true;
        } else {
          this.panning = { startX: sx, startY: sy, cx: this.view.cx, cz: this.view.cz };
        }
      } else if (e.button === 2 && hit >= 0) {
        this.points.splice(hit, 1);
        if (this.selected === hit) this.selected = -1;
        else if (this.selected > hit) this.selected--;
        this.syncSelected();
        this.dirty = true;
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.isOpen) return;
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (this.dragging >= 0) {
        const [wx, wz] = this.toWorld(sx, sy);
        this.points[this.dragging].x = wx;
        this.points[this.dragging].z = wz;
        this.dirty = true;
      } else if (this.panning) {
        this.view.cx = this.panning.cx - (sx - this.panning.startX) / this.view.scale;
        this.view.cz = this.panning.cz - (sy - this.panning.startY) / this.view.scale;
        this.dirty = true;
      }
    });
    window.addEventListener('mouseup', () => {
      if (!this.isOpen) return;
      if (this.dragging >= 0) this.dragging = -1;
      if (this.panning) this.panning = null;
      // downPos 留给 click 事件判定"单击加点"，在 click 里清除
    });
    // 单击（非拖动）在空白处加点：用 click 事件区分于拖动
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (
        this.downPos &&
        Math.hypot(sx - this.downPos[0], sy - this.downPos[1]) < 5 &&
        this.hitPoint(sx, sy) < 0
      ) {
        const [wx, wz] = this.toWorld(sx, sy);
        this.points.push({ x: wx, y: 0, z: wz });
        this.selected = this.points.length - 1;
        this.syncSelected();
        this.dirty = true;
      }
      this.downPos = null;
      this.panning = null;
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const [wx, wz] = this.toWorld(sx, sy);
      const k = e.deltaY > 0 ? 1 / 1.15 : 1.15;
      this.view.scale = Math.min(8, Math.max(0.15, this.view.scale * k));
      // 以光标为中心缩放
      this.view.cx = wx - (sx - this.canvas.width / 2) / this.view.scale;
      this.view.cz = wz - (sy - this.canvas.height / 2) / this.view.scale;
      this.dirty = true;
    }, { passive: false });
    window.addEventListener('resize', () => {
      if (this.isOpen) this.resize();
    });
  }

  private fitView(): void {
    if (this.points.length === 0) {
      this.view = { cx: 0, cz: 0, scale: 1 };
      return;
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of this.points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const w = Math.max(100, maxX - minX + 160);
    const h = Math.max(100, maxZ - minZ + 160);
    this.view.cx = (minX + maxX) / 2;
    this.view.cz = (minZ + maxZ) / 2;
    this.view.scale = Math.min(this.canvas.width / w, this.canvas.height / h);
  }

  // ---------- 操作 ----------

  private save(): void {
    const data = this.currentData();
    const issues = validateEditorTrack(data);
    if (issues.some((i) => i.level === 'error')) {
      this.showIssues(issues);
      return;
    }
    const list = this.cbs.getCustomTracks().filter((t) => t.id !== data.id);
    list.push(data);
    this.cbs.onSaveCustomTracks(list);
    this.trackId = data.id;
    this.refreshList();
    this.showIssues(issues);
  }

  private doExport(): void {
    el<HTMLTextAreaElement>('editor-json').value = serializeTrack(this.currentData());
    el<HTMLTextAreaElement>('editor-json').select();
  }

  private doImport(): void {
    const text = el<HTMLTextAreaElement>('editor-json').value.trim();
    if (!text) {
      this.showIssues([{ level: 'error', msg: '请先粘贴赛道 JSON' }]);
      return;
    }
    const { data, error } = parseTrack(text);
    if (!data) {
      this.showIssues([{ level: 'error', msg: `导入失败：${error}` }]);
      return;
    }
    this.loadData(data);
    this.showIssues([{ level: 'warn', msg: `已导入「${data.name}」` }]);
  }

  private testDrive(): void {
    const data = this.currentData();
    const issues = validateEditorTrack(data);
    if (issues.some((i) => i.level === 'error')) {
      this.showIssues(issues);
      return;
    }
    this.cbs.onTestDrive(data);
  }

  private showIssues(issues: ValidationIssue[]): void {
    const box = el('editor-issues');
    if (issues.length === 0) {
      box.textContent = '✓ 校验通过';
      box.className = 'ok';
      return;
    }
    box.textContent = issues.map((i) => `${i.level === 'error' ? '✗' : '⚠'} ${i.msg}`).join('\n');
    box.className = issues.some((i) => i.level === 'error') ? 'err' : 'warn';
  }

  // ---------- 渲染 ----------

  private loop(): void {
    if (!this.isOpen) return;
    requestAnimationFrame(() => this.loop());
    if (!this.dirty) return;
    this.dirty = false;
    this.render();
  }

  private render(): void {
    const c = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    c.fillStyle = '#0b0e14';
    c.fillRect(0, 0, w, h);

    // 网格（100m 间隔）
    c.strokeStyle = 'rgba(255,255,255,0.06)';
    c.lineWidth = 1;
    const step = 100 * this.view.scale;
    if (step > 18) {
      const [x0, z0] = this.toWorld(0, 0);
      const [x1, z1] = this.toWorld(w, h);
      for (let gx = Math.floor(x0 / 100) * 100; gx <= x1; gx += 100) {
        const [sx] = this.toScreen(gx, 0);
        c.beginPath();
        c.moveTo(sx, 0);
        c.lineTo(sx, h);
        c.stroke();
      }
      for (let gz = Math.floor(z0 / 100) * 100; gz <= z1; gz += 100) {
        const [, sy] = this.toScreen(0, gz);
        c.beginPath();
        c.moveTo(0, sy);
        c.lineTo(w, sy);
        c.stroke();
      }
    }

    const pts = this.points;
    if (pts.length > 0) {
      // 样条预览：中心线 + 路宽轮廓
      const curve = new THREE.CatmullRomCurve3(
        pts.map((p) => new THREE.Vector3(p.x, 0, p.z)),
        this.closed,
        'catmullrom',
        0.5,
      );
      const N = Math.max(pts.length * 16, 64);
      const center: [number, number][] = [];
      for (let i = 0; i < N; i++) {
        const p = curve.getPoint(i / N);
        center.push([p.x, p.z]);
      }

      // 路宽轮廓（按相邻方向法线偏移）
      const off = this.halfWidth;
      const outline = (sign: 1 | -1): void => {
        c.beginPath();
        for (let i = 0; i < center.length; i++) {
          const [x, z] = center[i];
          const [px, pz] = center[(i + 1) % center.length];
          const [mx, mz] = center[(i - 1 + center.length) % center.length];
          let tx = px - mx;
          let tz = pz - mz;
          const len = Math.hypot(tx, tz) || 1;
          tx /= len;
          tz /= len;
          const [sx, sy] = this.toScreen(x + tz * off * sign, z - tx * off * sign);
          if (i === 0) c.moveTo(sx, sy);
          else c.lineTo(sx, sy);
        }
        if (this.closed) c.closePath();
        c.stroke();
      };
      c.strokeStyle = 'rgba(255,255,255,0.35)';
      c.lineWidth = 1.5;
      outline(1);
      outline(-1);

      // 中心线
      c.strokeStyle = '#ffd320';
      c.lineWidth = 2.5;
      c.beginPath();
      center.forEach(([x, z], i) => {
        const [sx, sy] = this.toScreen(x, z);
        if (i === 0) c.moveTo(sx, sy);
        else c.lineTo(sx, sy);
      });
      if (this.closed) c.closePath();
      c.stroke();

      // 自交警告标记
      const inter = selfIntersections(pts.map((p) => [p.x, p.z] as const), this.closed);
      c.fillStyle = '#ff4b3e';
      for (const [i] of inter) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const [sx, sy] = this.toScreen((a.x + b.x) / 2, (a.z + b.z) / 2);
        c.beginPath();
        c.arc(sx, sy, 8, 0, Math.PI * 2);
        c.fill();
      }

      // 控制点（编号 + 高度标注）
      pts.forEach((p, i) => {
        const [sx, sy] = this.toScreen(p.x, p.z);
        c.beginPath();
        c.arc(sx, sy, i === this.selected ? 9 : 6, 0, Math.PI * 2);
        c.fillStyle = i === 0 ? '#58ff5a' : i === this.selected ? '#ffd320' : '#f2f2f2';
        c.fill();
        c.lineWidth = 2;
        c.strokeStyle = '#000';
        c.stroke();
        c.fillStyle = '#000';
        c.font = 'bold 10px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(String(i + 1), sx, sy);
        if (p.y !== 0 || i === this.selected) {
          c.fillStyle = '#18e0ff';
          c.font = 'italic 11px sans-serif';
          c.fillText(`${p.y.toFixed(0)}m`, sx, sy - 14);
        }
      });
    }

    // 左下信息
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.font = '12px sans-serif';
    c.textAlign = 'left';
    c.textBaseline = 'bottom';
    c.fillText(
      `左键空白加点 · 拖点移动 · 右键/Del 删点 · 滚轮缩放 · 拖拽平移 · [ ] 调选中点高度`,
      10,
      h - 8,
    );
  }
}
