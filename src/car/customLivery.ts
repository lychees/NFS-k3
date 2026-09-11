/** 自定义涂装（绘制器）数据与纯逻辑：方案格式、序列化、撤销栈 */

export const LIVERY_FORMAT = 'retro-rush-livery@1';
export const CANVAS_SIZE = 512;

/** 已存涂装方案（画布内容为 PNG dataURL） */
export interface LiveryDesign {
  id: string;
  name: string;
  image: string;
}

let seq = 0;
export const newDesignId = (): string =>
  `design-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const isImageDataUrl = (v: unknown): v is string =>
  typeof v === 'string' && (v.startsWith('data:image/') || v === '');

// ---------- 序列化 / 反序列化 ----------

export function serializeDesign(d: LiveryDesign): string {
  return JSON.stringify({ format: LIVERY_FORMAT, ...d });
}

export function parseDesign(json: string): { data: LiveryDesign | null; error: string | null } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { data: null, error: 'JSON 解析失败' };
  }
  const o = raw as Partial<LiveryDesign> & { format?: string };
  if (o.format !== LIVERY_FORMAT) return { data: null, error: '格式标识不符' };
  if (typeof o.name !== 'string' || o.name.length === 0) return { data: null, error: '缺少名称' };
  if (!isImageDataUrl(o.image) || o.image === '') return { data: null, error: '图像数据缺失' };
  return {
    data: {
      id: typeof o.id === 'string' && o.id.length > 0 ? o.id : newDesignId(),
      name: o.name.slice(0, 24),
      image: o.image,
    },
    error: null,
  };
}

// ---------- 撤销栈（快照式，纯函数式包装，可测） ----------

export class UndoStack<T> {
  private items: T[] = [];

  constructor(private cap = 20) {}

  get size(): number {
    return this.items.length;
  }

  get canUndo(): boolean {
    return this.items.length > 0;
  }

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.cap) this.items.shift();
  }

  /** 弹出最近快照；空栈返回 null */
  undo(): T | null {
    return this.items.pop() ?? null;
  }

  peek(): T | null {
    return this.items.length > 0 ? this.items[this.items.length - 1] : null;
  }

  clear(): void {
    this.items = [];
  }
}
