import * as THREE from 'three';
import { DEFAULT_THEME, THEMES, themeOf, type ThemeId } from '../track/themes';
import {
  HistoryStack,
  applyStartAndDirection,
  directionOf,
  insertPointAt,
  nearestSegment,
  newCustomId,
  parseTrack,
  selfIntersections,
  serializeTrack,
  snapToGrid,
  startIndexOf,
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

/** 撤销栈快照的完整编辑状态 */
interface EditorState {
  points: Pt[];
  name: string;
  closed: boolean;
  halfWidth: number;
  hills: number;
  vegetation: number;
  startIndex: number;
  direction: 1 | -1;
  theme: ThemeId;
  selected: number;
  selectedSet: number[];
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
  private selectedSet = new Set<number>();
  private startIndex = 0;
  private direction: 1 | -1 = 1;
  private theme: ThemeId = DEFAULT_THEME;
  /** 网格吸附：0 关 / 10 / 25（米） */
  private snapSize = 0;

  // 撤销/重做（快照式，40 步）
  private history = new HistoryStack<EditorState>(40);
  private activeBurst: string | null = null;
  private burstTimer: ReturnType<typeof setTimeout> | null = null;
  private hoverSeg = -1;

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
      startIndex: this.startIndex,
      direction: this.direction,
      theme: this.theme,
    };
  }

  private snapshot(): EditorState {
    return {
      points: this.points.map((p) => ({ ...p })),
      name: this.name,
      closed: this.closed,
      halfWidth: this.halfWidth,
      hills: this.hills,
      vegetation: this.vegetation,
      startIndex: this.startIndex,
      direction: this.direction,
      theme: this.theme,
      selected: this.selected,
      selectedSet: [...this.selectedSet],
    };
  }

  private restore(s: EditorState): void {
    this.points = s.points.map((p) => ({ ...p }));
    this.name = s.name;
    this.closed = s.closed;
    this.halfWidth = s.halfWidth;
    this.hills = s.hills;
    this.vegetation = s.vegetation;
    this.startIndex = s.startIndex;
    this.direction = s.direction;
    this.theme = s.theme;
    this.selected = s.selected;
    this.selectedSet = new Set(s.selectedSet);
    this.activeBurst = null;
    this.syncPanel();
    this.dirty = true;
  }

  /** 所有编辑变更统一入口：先压快照（burst 操作在时间窗内合并为一步） */
  private mutate(fn: () => void, burstKey?: string): void {
    if (!burstKey || this.activeBurst !== burstKey) {
      this.history.push(this.snapshot());
      this.activeBurst = burstKey ?? null;
    }
    if (burstKey) {
      if (this.burstTimer) clearTimeout(this.burstTimer);
      this.burstTimer = setTimeout(() => {
        this.activeBurst = null;
      }, 800);
    }
    fn();
    this.dirty = true;
  }

  private endBurst(): void {
    this.activeBurst = null;
  }

  private undo(): void {
    const s = this.history.undo(this.snapshot());
    if (s) {
      this.restore(s);
      this.syncUndoButtons();
    }
  }

  private redo(): void {
    const s = this.history.redo(this.snapshot());
    if (s) {
      this.restore(s);
      this.syncUndoButtons();
    }
  }

  private syncUndoButtons(): void {
    el<HTMLButtonElement>('editor-undo').disabled = !this.history.canUndo;
    el<HTMLButtonElement>('editor-redo').disabled = !this.history.canRedo;
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
    this.selectedSet = new Set();
    this.startIndex = startIndexOf(d);
    this.direction = directionOf(d);
    this.theme = themeOf(d.theme);
    this.history.clear();
    this.syncUndoButtons();
    this.syncPanel();
    this.fitView();
    this.dirty = true;
  }

  private newTrack(): void {
    this.trackId = '';
    this.name = '我的赛道';
    this.points = DEFAULT_POINTS(this.closed);
    this.selected = -1;
    this.selectedSet = new Set();
    this.startIndex = 0;
    this.direction = 1;
    this.theme = DEFAULT_THEME;
    this.history.clear();
    this.syncUndoButtons();
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
    el('editor-snap').textContent = this.snapSize === 0 ? '吸附 关' : `吸附 ${this.snapSize}m`;
    el('editor-direction').textContent = this.direction === 1 ? '方向 →' : '方向 ←';
    for (const t of Object.keys(THEMES) as ThemeId[]) {
      el(`editor-theme-${t}`).classList.toggle('selected', this.theme === t);
    }
    this.syncUndoButtons();
    this.syncSelected();
  }

  private syncSelected(): void {
    const has = this.selected >= 0 && this.selected < this.points.length;
    const isStart = has && this.selected === this.startIndex;
    el('editor-sel-info').textContent = has
      ? `点 #${this.selected + 1} 高度 ${this.points[this.selected].y.toFixed(0)}m${isStart ? ' · 起点' : ''}${this.selectedSet.size > 0 ? ` · 多选 ${this.selectedSet.size}` : ''}`
      : this.selectedSet.size > 0
        ? `多选 ${this.selectedSet.size} 点（方向键平移，Esc 取消）`
        : '未选中点（[ ] 调高度 · Shift+点 多选）';
    el('editor-set-start').classList.toggle('selected', isStart);
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
      const dup = document.createElement('button');
      dup.className = 'option editor-del';
      dup.textContent = '复';
      dup.title = '复制赛道';
      dup.addEventListener('click', () => {
        const copy: CustomTrackData = {
          ...t,
          id: newCustomId(),
          name: `${t.name.slice(0, 20)} 副本`,
          points: t.points.map((p) => [p[0], p[1], p[2]]),
        };
        this.cbs.onSaveCustomTracks([...this.cbs.getCustomTracks(), copy]);
        this.refreshList();
      });
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
      row.appendChild(dup);
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
    el('editor-undo').addEventListener('click', () => this.undo());
    el('editor-redo').addEventListener('click', () => this.redo());
    el('editor-snap').addEventListener('click', () => {
      this.snapSize = this.snapSize === 0 ? 10 : this.snapSize === 10 ? 25 : 0;
      this.syncPanel();
    });
    el('editor-direction').addEventListener('click', () => {
      this.mutate(() => {
        this.direction = this.direction === 1 ? -1 : 1;
      });
      this.syncPanel();
    });
    el('editor-set-start').addEventListener('click', () => this.setStart());
    for (const t of Object.keys(THEMES) as ThemeId[]) {
      el(`editor-theme-${t}`).addEventListener('click', () => {
        this.mutate(() => {
          this.theme = t;
        });
        this.syncPanel();
      });
    }
    el<HTMLInputElement>('editor-name').addEventListener('input', (e) => {
      this.mutate(() => {
        this.name = (e.target as HTMLInputElement).value;
      }, 'prop-name');
    });
    el('editor-type-closed').addEventListener('click', () => {
      if (this.closed) return;
      this.mutate(() => {
        this.closed = true;
        this.startIndex = Math.min(this.startIndex, Math.max(0, this.points.length - 1));
      });
      this.syncPanel();
    });
    el('editor-type-open').addEventListener('click', () => {
      if (!this.closed) return;
      this.mutate(() => {
        this.closed = false;
        // 开放道起点仅端点合法
        if (this.startIndex !== 0 && this.startIndex !== this.points.length - 1) this.startIndex = 0;
      });
      this.syncPanel();
    });
    const slider = (id: string, apply: (v: number) => void): void => {
      el<HTMLInputElement>(id).addEventListener('input', (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        this.mutate(() => apply(v), `slider-${id}`);
        this.syncPanel();
      });
      el<HTMLInputElement>(id).addEventListener('change', () => this.endBurst());
    };
    slider('editor-width', (v) => (this.halfWidth = v));
    slider('editor-hills', (v) => (this.hills = v));
    slider('editor-veg', (v) => (this.vegetation = v));

    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault();
        this.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) {
        e.preventDefault();
        this.redo();
        return;
      }

      if (e.code === 'Delete' || e.code === 'Backspace') {
        if (this.selectedSet.size > 0) {
          this.mutate(() => {
            this.points = this.points.filter((_, i) => !this.selectedSet.has(i));
            this.selected = -1;
            this.selectedSet = new Set();
            this.startIndex = Math.min(this.startIndex, Math.max(0, this.points.length - 1));
          });
          this.syncSelected();
          e.preventDefault();
        } else if (this.selected >= 0) {
          this.mutate(() => {
            this.points.splice(this.selected, 1);
            if (this.startIndex === this.selected) this.startIndex = 0;
            else if (this.startIndex > this.selected) this.startIndex--;
            this.selected = -1;
          });
          this.syncSelected();
          e.preventDefault();
        }
        return;
      }

      if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
        if (this.selected >= 0) {
          const d = e.code === 'BracketRight' ? 2 : -2;
          const idx = this.selected;
          this.mutate(() => {
            this.points[idx].y += d;
          }, 'height');
          this.syncSelected();
        }
        return;
      }

      if (e.code === 'Escape') {
        this.selectedSet = new Set();
        this.syncSelected();
        this.dirty = true;
        return;
      }

      if (e.code.startsWith('Arrow') && this.selectedSet.size > 0) {
        e.preventDefault();
        const step = this.snapSize > 0 ? this.snapSize : 5;
        const [dx, dz] =
          e.code === 'ArrowLeft' ? [-step, 0] :
          e.code === 'ArrowRight' ? [step, 0] :
          e.code === 'ArrowUp' ? [0, -step] : [0, step];
        this.mutate(() => {
          for (const i of this.selectedSet) {
            if (i < this.points.length) {
              this.points[i].x = snapToGrid(this.points[i].x + dx, this.snapSize);
              this.points[i].z = snapToGrid(this.points[i].z + dz, this.snapSize);
            }
          }
        }, 'arrows');
        return;
      }
    });
  }

  private setStart(): void {
    if (this.selected < 0 || this.selected >= this.points.length) return;
    let idx = this.selected;
    if (!this.closed) {
      // 开放道起点仅端点：吸附到最近端
      const mid = (this.points.length - 1) / 2;
      if (idx !== 0 && idx !== this.points.length - 1) idx = idx < mid ? 0 : this.points.length - 1;
    }
    this.mutate(() => {
      this.startIndex = idx;
    });
    this.syncSelected();
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

  private hitSegment(sx: number, sy: number): number {
    // 屏幕空间检测：点击处距折线段 < 10px 视为点中该段
    const [wx, wz] = this.toWorld(sx, sy);
    const seg = nearestSegment(
      this.points.map((p) => [p.x, p.z] as const),
      this.closed,
      wx,
      wz,
    );
    if (seg.index < 0) return -1;
    return seg.dist * this.view.scale < 10 ? seg.index : -1;
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
        if (e.shiftKey && hit >= 0) {
          // Shift+点：多选切换
          if (this.selectedSet.has(hit)) this.selectedSet.delete(hit);
          else this.selectedSet.add(hit);
          this.selected = hit;
          this.syncSelected();
          this.dirty = true;
          return;
        }
        if (hit >= 0) {
          this.dragging = hit;
          this.selected = hit;
          this.mutate(() => {}, 'drag'); // 拖动合并为一步
          this.syncSelected();
          this.dirty = true;
        } else {
          this.panning = { startX: sx, startY: sy, cx: this.view.cx, cz: this.view.cz };
        }
      } else if (e.button === 2 && hit >= 0) {
        this.mutate(() => {
          this.points.splice(hit, 1);
          if (this.startIndex === hit) this.startIndex = 0;
          else if (this.startIndex > hit) this.startIndex--;
          if (this.selected === hit) this.selected = -1;
          else if (this.selected > hit) this.selected--;
          const next = new Set<number>();
          for (const i of this.selectedSet) {
            if (i < hit) next.add(i);
            else if (i > hit) next.add(i - 1);
          }
          this.selectedSet = next;
        });
        this.syncSelected();
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.isOpen) return;
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (this.dragging >= 0) {
        const [wx, wz] = this.toWorld(sx, sy);
        const idx = this.dragging;
        this.points[idx].x = snapToGrid(wx, this.snapSize);
        this.points[idx].z = snapToGrid(wz, this.snapSize);
        this.dirty = true;
      } else if (this.panning) {
        this.view.cx = this.panning.cx - (sx - this.panning.startX) / this.view.scale;
        this.view.cz = this.panning.cz - (sy - this.panning.startY) / this.view.scale;
        this.dirty = true;
      } else {
        // 悬停段提示（可点此处插入）
        const seg = this.hitSegment(sx, sy);
        if (seg !== this.hoverSeg) {
          this.hoverSeg = seg;
          this.dirty = true;
        }
      }
    });
    window.addEventListener('mouseup', () => {
      if (!this.isOpen) return;
      if (this.dragging >= 0) {
        this.dragging = -1;
        this.endBurst();
      }
      if (this.panning) this.panning = null;
      // downPos 留给 click 事件判定"单击加点/插入"，在 click 里清除
    });
    // 单击（非拖动）：点中段中点插入 / 空白处末尾加点
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (
        this.downPos &&
        Math.hypot(sx - this.downPos[0], sy - this.downPos[1]) < 5 &&
        this.hitPoint(sx, sy) < 0
      ) {
        const seg = this.hitSegment(sx, sy);
        if (seg >= 0) {
          // 段中点插入
          this.mutate(() => {
            this.points = insertPointAt(
              this.points.map((p) => [p.x, p.y, p.z] as [number, number, number]),
              seg,
            ).map((p) => ({
              x: p[0],
              y: p[1],
              z: p[2],
            }));
            this.selected = seg + 1;
            if (this.startIndex > seg) this.startIndex++;
          });
          this.syncSelected();
        } else {
          const [wx, wz] = this.toWorld(sx, sy);
          this.mutate(() => {
            this.points.push({
              x: snapToGrid(wx, this.snapSize),
              y: 0,
              z: snapToGrid(wz, this.snapSize),
            });
            this.selected = this.points.length - 1;
          });
          this.syncSelected();
        }
      }
      this.downPos = null;
      this.panning = null;
      this.endBurst();
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
      // 样条预览（应用起点/方向归一化后的实际行驶形态）
      const previewPts = applyStartAndDirection(
        pts.map((p) => [p.x, p.y, p.z] as [number, number, number]),
        this.closed,
        this.startIndex,
        this.direction,
      );
      const curve = new THREE.CatmullRomCurve3(
        previewPts.map((p) => new THREE.Vector3(p[0], 0, p[2])),
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

      // 悬停段的插入预览（段中点幽灵点）
      if (this.hoverSeg >= 0 && this.hoverSeg < pts.length) {
        const a = pts[this.hoverSeg];
        const b = pts[(this.hoverSeg + 1) % pts.length];
        const [sx, sy] = this.toScreen((a.x + b.x) / 2, (a.z + b.z) / 2);
        c.strokeStyle = 'rgba(88,255,90,0.8)';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(sx, sy, 7, 0, Math.PI * 2);
        c.stroke();
        c.fillStyle = 'rgba(88,255,90,0.9)';
        c.font = 'bold 12px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('+', sx, sy);
      }

      // 起点标记：绿环 + 行驶方向箭头（归一化后的样条起点与切线）
      {
        const startP = curve.getPoint(0);
        const startT = curve.getTangent(0);
        const [sx, sy] = this.toScreen(startP.x, startP.z);
        c.strokeStyle = '#58ff5a';
        c.lineWidth = 3;
        c.beginPath();
        c.arc(sx, sy, 12, 0, Math.PI * 2);
        c.stroke();
        const ax = startT.x * 22;
        const az = startT.z * 22;
        const tx = sx + ax;
        const ty = sy + az;
        c.beginPath();
        c.moveTo(sx, sy);
        c.lineTo(tx, ty);
        c.stroke();
        // 箭头头部
        const nx = -az / 22 * 0.45;
        const nz = ax / 22 * 0.45;
        c.beginPath();
        c.moveTo(tx, ty);
        c.lineTo(tx - ax * 0.35 + nx * 8, ty - az * 0.35 + nz * 8);
        c.moveTo(tx, ty);
        c.lineTo(tx - ax * 0.35 - nx * 8, ty - az * 0.35 - nz * 8);
        c.stroke();
      }

      // 控制点（高度配色：蓝低-绿-红高；起点绿；选中黄；多选青环）
      pts.forEach((p, i) => {
        const [sx, sy] = this.toScreen(p.x, p.z);
        const hue = Math.min(220, Math.max(0, 220 - (p.y + 10) * 5.5));
        const isStart = i === this.startIndex;
        const inSet = this.selectedSet.has(i);
        c.beginPath();
        c.arc(sx, sy, i === this.selected ? 9 : 6, 0, Math.PI * 2);
        c.fillStyle = isStart ? '#58ff5a' : i === this.selected ? '#ffd320' : `hsl(${hue}, 75%, 55%)`;
        c.fill();
        c.lineWidth = 2;
        c.strokeStyle = inSet ? '#18e0ff' : '#000';
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
      `空白加点 · 点线插入 · 拖点 · Shift+点 多选(方向键平移) · 右键/Del 删点 · [ ] 高度 · Ctrl+Z/Y`,
      10,
      h - 8,
    );
  }
}
