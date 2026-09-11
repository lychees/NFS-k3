import {
  CANVAS_SIZE,
  UndoStack,
  newDesignId,
  parseDesign,
  serializeDesign,
  type LiveryDesign,
} from '../car/customLivery';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

type Tool = 'brush' | 'line' | 'rect' | 'circle' | 'fill' | 'eraser';

export interface PaintShopCallbacks {
  /** 画布内容变化（提交后调用）：存档 + 3D 预览 */
  onImage(image: string): void;
  onClose(): void;
  getDesigns(): LiveryDesign[];
  onSaveDesigns(d: LiveryDesign[]): void;
}

const TOL = 40;

/** 涂装绘制器：画笔/直线/矩形/圆形/填充/橡皮 + 网格 + 镜像 + 撤销 + 方案库 */
export class PaintShopScreen {
  private root = el('screen-paintshop');
  private canvas = el<HTMLCanvasElement>('ps-canvas');
  private overlay = el<HTMLCanvasElement>('ps-overlay');
  private ctx: CanvasRenderingContext2D;
  private octx: CanvasRenderingContext2D;
  private cbs: PaintShopCallbacks;

  private tool: Tool = 'brush';
  private color = '#ffd320';
  private size = 8;
  private grid = true;
  private mirror = true;
  private undo = new UndoStack<ImageData>(20);
  private drawing = false;
  private start: [number, number] = [0, 0];
  private last: [number, number] = [0, 0];

  constructor(cbs: PaintShopCallbacks) {
    this.cbs = cbs;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    const octx = this.overlay.getContext('2d');
    if (!ctx || !octx) throw new Error('paintshop 2d context unavailable');
    this.ctx = ctx;
    this.octx = octx;
    this.canvas.width = this.overlay.width = CANVAS_SIZE;
    this.canvas.height = this.overlay.height = CANVAS_SIZE;
    this.bindPanel();
    this.bindCanvas();
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(image: string | null): void {
    this.root.classList.remove('hidden');
    this.undo.clear();
    this.ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    if (image) {
      const img = new Image();
      img.onload = () => {
        this.ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        this.ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
        this.drawGrid();
      };
      img.src = image;
    }
    this.syncToolButtons();
    this.refreshDesignList();
    this.drawGrid();
  }

  close(): void {
    this.root.classList.add('hidden');
  }

  // ---------- 面板 ----------

  private bindPanel(): void {
    el('ps-close').addEventListener('click', () => this.cbs.onClose());
    el('ps-clear').addEventListener('click', () => {
      this.snapshot();
      this.ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      this.applyChange();
    });
    el('ps-undo').addEventListener('click', () => this.doUndo());
    for (const t of ['brush', 'line', 'rect', 'circle', 'fill', 'eraser'] as Tool[]) {
      el(`ps-tool-${t}`).addEventListener('click', () => {
        this.tool = t;
        this.syncToolButtons();
      });
    }
    el<HTMLInputElement>('ps-color').addEventListener('input', (e) => {
      this.color = (e.target as HTMLInputElement).value;
    });
    el<HTMLInputElement>('ps-size').addEventListener('input', (e) => {
      this.size = Number((e.target as HTMLInputElement).value);
      el('ps-size-val').textContent = `${this.size}px`;
    });
    el('ps-grid').addEventListener('click', () => {
      this.grid = !this.grid;
      el('ps-grid').classList.toggle('selected', this.grid);
      this.drawGrid();
    });
    el('ps-mirror').addEventListener('click', () => {
      this.mirror = !this.mirror;
      el('ps-mirror').classList.toggle('selected', this.mirror);
    });

    el('ps-save-design').addEventListener('click', () => this.saveDesign());
    el('ps-export').addEventListener('click', () => {
      el<HTMLTextAreaElement>('ps-json').value = serializeDesign({
        id: newDesignId(),
        name: el<HTMLInputElement>('ps-name').value || '自定义拉花',
        image: this.canvas.toDataURL('image/png'),
      });
      el<HTMLTextAreaElement>('ps-json').select();
    });
    el('ps-import').addEventListener('click', () => {
      const text = el<HTMLTextAreaElement>('ps-json').value.trim();
      const { data, error } = parseDesign(text);
      if (!data) {
        el<HTMLTextAreaElement>('ps-json').value = `导入失败：${error}`;
        return;
      }
      el<HTMLInputElement>('ps-name').value = data.name;
      this.loadImage(data.image);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        this.doUndo();
      }
    });
  }

  private syncToolButtons(): void {
    for (const t of ['brush', 'line', 'rect', 'circle', 'fill', 'eraser'] as Tool[]) {
      el(`ps-tool-${t}`).classList.toggle('selected', this.tool === t);
    }
    el('ps-grid').classList.toggle('selected', this.grid);
    el('ps-mirror').classList.toggle('selected', this.mirror);
    el<HTMLInputElement>('ps-color').value = this.color;
    el<HTMLInputElement>('ps-size').value = String(this.size);
    el('ps-size-val').textContent = `${this.size}px`;
  }

  private refreshDesignList(): void {
    const wrap = el('ps-design-list');
    wrap.innerHTML = '';
    const designs = this.cbs.getDesigns();
    if (designs.length === 0) {
      wrap.innerHTML = '<div class="editor-list-empty">暂存方案为空</div>';
      return;
    }
    designs.forEach((d, i) => {
      const row = document.createElement('div');
      row.className = 'editor-list-row';
      const btn = document.createElement('button');
      btn.className = 'option';
      btn.textContent = d.name;
      btn.title = '载入画布编辑';
      btn.addEventListener('click', () => {
        el<HTMLInputElement>('ps-name').value = d.name;
        this.loadImage(d.image);
      });
      const del = document.createElement('button');
      del.className = 'option editor-del';
      del.textContent = '删';
      del.addEventListener('click', () => {
        this.cbs.onSaveDesigns(this.cbs.getDesigns().filter((_, k) => k !== i));
        this.refreshDesignList();
      });
      row.appendChild(btn);
      row.appendChild(del);
      wrap.appendChild(row);
    });
  }

  private saveDesign(): void {
    const name = el<HTMLInputElement>('ps-name').value.trim() || '自定义拉花';
    const image = this.canvas.toDataURL('image/png');
    const design: LiveryDesign = { id: newDesignId(), name, image };
    this.cbs.onSaveDesigns([...this.cbs.getDesigns(), design]);
    this.refreshDesignList();
  }

  private loadImage(dataUrl: string): void {
    const img = new Image();
    img.onload = () => {
      this.snapshot();
      this.ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      this.ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      this.applyChange();
    };
    img.src = dataUrl;
  }

  // ---------- 画布 ----------

  private pos(e: MouseEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) / rect.width) * CANVAS_SIZE,
      ((e.clientY - rect.top) / rect.height) * CANVAS_SIZE,
    ];
  }

  private bindCanvas(): void {
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const [x, y] = this.pos(e);
      this.drawing = true;
      this.start = [x, y];
      this.last = [x, y];
      if (this.tool === 'fill') {
        this.snapshot();
        this.floodFill(Math.round(x), Math.round(y));
        this.drawing = false;
        this.applyChange();
      } else if (this.tool === 'brush' || this.tool === 'eraser') {
        this.strokeSeg(x, y, x + 0.01, y + 0.01);
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.drawing || !this.isOpen) return;
      const [x, y] = this.pos(e);
      if (this.tool === 'brush' || this.tool === 'eraser') {
        this.strokeSeg(this.last[0], this.last[1], x, y);
      } else {
        this.previewShape(x, y);
      }
      this.last = [x, y];
    });
    window.addEventListener('mouseup', () => {
      if (!this.drawing || !this.isOpen) return;
      this.drawing = false;
      if (this.tool === 'line' || this.tool === 'rect' || this.tool === 'circle') {
        this.commitShape();
      }
      this.snapshot();
      this.applyChange();
    });
  }

  private strokeColor(): string {
    return this.tool === 'eraser' ? 'rgba(0,0,0,1)' : this.color;
  }

  private withStyle(ctx: CanvasRenderingContext2D, fn: () => void): void {
    ctx.save();
    if (this.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
    fn();
    ctx.restore();
  }

  private strokeSeg(x0: number, y0: number, x1: number, y1: number): void {
    this.withStyle(this.ctx, () => {
      this.ctx.strokeStyle = this.strokeColor();
      this.ctx.lineWidth = this.size;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.beginPath();
      this.ctx.moveTo(x0, y0);
      this.ctx.lineTo(x1, y1);
      this.ctx.stroke();
      if (this.mirror) {
        this.ctx.beginPath();
        this.ctx.moveTo(CANVAS_SIZE - x0, y0);
        this.ctx.lineTo(CANVAS_SIZE - x1, y1);
        this.ctx.stroke();
      }
    });
  }

  private drawShape(ctx: CanvasRenderingContext2D, x1: number, y1: number, mirror: boolean): void {
    const [x0, y0] = this.start;
    ctx.strokeStyle = this.strokeColor();
    ctx.fillStyle = this.strokeColor();
    ctx.lineWidth = Math.max(2, this.size / 3);
    const rx = mirror ? CANVAS_SIZE - x1 : x1;
    const rx0 = mirror ? CANVAS_SIZE - x0 : x0;
    if (this.tool === 'line') {
      ctx.beginPath();
      ctx.moveTo(rx0, y0);
      ctx.lineTo(rx, y1);
      ctx.stroke();
    } else if (this.tool === 'rect') {
      ctx.fillRect(Math.min(rx0, rx), Math.min(y0, y1), Math.abs(rx - rx0), Math.abs(y1 - y0));
    } else if (this.tool === 'circle') {
      const r = Math.hypot(rx - rx0, y1 - y0);
      ctx.beginPath();
      ctx.arc(rx0, y0, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private previewShape(x: number, y: number): void {
    this.octx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    this.drawGrid();
    this.withStyle(this.octx, () => {
      this.drawShape(this.octx, x, y, false);
      if (this.mirror) this.drawShape(this.octx, x, y, true);
    });
  }

  private commitShape(): void {
    this.withStyle(this.ctx, () => {
      this.drawShape(this.ctx, this.last[0], this.last[1], false);
      if (this.mirror) this.drawShape(this.ctx, this.last[0], this.last[1], true);
    });
    this.octx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    this.drawGrid();
  }

  private floodFill(sx: number, sy: number): void {
    const img = this.ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    const d = img.data;
    const idx = (x: number, y: number): number => (y * CANVAS_SIZE + x) * 4;
    const tr = d[idx(sx, sy)];
    const tg = d[idx(sx, sy) + 1];
    const tb = d[idx(sx, sy) + 2];
    const ta = d[idx(sx, sy) + 3];
    const [fr, fg, fb] = this.hexToRgb(this.color);
    if (
      Math.abs(tr - fr) < 8 &&
      Math.abs(tg - fg) < 8 &&
      Math.abs(tb - fb) < 8 &&
      ta === 255
    ) {
      return; // 目标色与填充色几乎一致
    }
    const match = (i: number): boolean =>
      Math.abs(d[i] - tr) <= TOL &&
      Math.abs(d[i + 1] - tg) <= TOL &&
      Math.abs(d[i + 2] - tb) <= TOL &&
      Math.abs(d[i + 3] - ta) <= TOL;
    const stack: [number, number][] = [[sx, sy]];
    const seen = new Uint8Array(CANVAS_SIZE * CANVAS_SIZE);
    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      if (x < 0 || y < 0 || x >= CANVAS_SIZE || y >= CANVAS_SIZE) continue;
      const p = y * CANVAS_SIZE + x;
      if (seen[p]) continue;
      const i = idx(x, y);
      if (!match(i)) continue;
      seen[p] = 1;
      d[i] = fr;
      d[i + 1] = fg;
      d[i + 2] = fb;
      d[i + 3] = 255;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    this.ctx.putImageData(img, 0, 0);
  }

  private hexToRgb(hex: string): [number, number, number] {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  private drawGrid(): void {
    const c = this.octx;
    c.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    if (!this.grid) return;
    c.strokeStyle = 'rgba(255,255,255,0.12)';
    c.lineWidth = 1;
    for (let i = 0; i <= CANVAS_SIZE; i += 32) {
      c.beginPath();
      c.moveTo(i, 0);
      c.lineTo(i, CANVAS_SIZE);
      c.stroke();
      c.beginPath();
      c.moveTo(0, i);
      c.lineTo(CANVAS_SIZE, i);
      c.stroke();
    }
    if (this.mirror) {
      c.strokeStyle = 'rgba(24,224,255,0.5)';
      c.setLineDash([6, 6]);
      c.beginPath();
      c.moveTo(CANVAS_SIZE / 2, 0);
      c.lineTo(CANVAS_SIZE / 2, CANVAS_SIZE);
      c.stroke();
      c.setLineDash([]);
    }
  }

  private snapshot(): void {
    this.undo.push(this.ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE));
  }

  private doUndo(): void {
    const img = this.undo.undo();
    if (!img) return;
    this.ctx.putImageData(img, 0, 0);
    this.applyChange();
  }

  private applyChange(): void {
    this.drawGrid();
    this.cbs.onImage(this.canvas.toDataURL('image/png'));
  }
}
