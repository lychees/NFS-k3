/** 车库存档：积分 / 性能改装等级 / 外观配置，localStorage 持久化 */

export type RimStyle = 'sport' | 'mesh' | 'dish';
export type SpoilerStyle = 'none' | 'low' | 'gt';
export type LiveryId =
  | 'none'
  | 'stripes'
  | 'roundel'
  | 'twotone'
  | 'checkered'
  | 'flames'
  | 'slashes';

/** 涂装配置：预设 + 强调色 + 赛车号码 */
export interface LiveryConfig {
  id: LiveryId;
  accent: number;
  /** 0-99 */
  number: number;
}

export interface AppearanceConfig {
  paint: number;
  spoiler: SpoilerStyle;
  rims: RimStyle;
  /** null = 关闭底盘灯 */
  underglow: number | null;
}

export interface UpgradeLevels {
  engine: number;
  tires: number;
  nitro: number;
}

export interface SaveData {
  credits: number;
  upgrades: UpgradeLevels;
  appearance: AppearanceConfig;
  livery: LiveryConfig;
  bloom: boolean;
  muted: boolean;
  /** 主音量 0..1 */
  volume: number;
  /** 上次游玩的赛道模式 */
  lastMode: 'circuit' | 'sprint' | 'knockout' | 'hotpursuit';
  /** 各赛道最佳总用时（秒） */
  records: { circuit: number | null; sprint: number | null };
  /** 上次比赛设置：时间 × 天气 */
  lastConditions: {
    time: 'day' | 'sunset' | 'night';
    weather: 'clear' | 'rain';
  };
}

export const UPGRADE_MAX = 5;
export const UPGRADE_COSTS = [60, 90, 120, 150, 180];
export const RACE_REWARDS = [100, 70, 50, 30];

export const PAINTS: { name: string; color: number }[] = [
  { name: '烈焰红', color: 0xc0272d },
  { name: '电光蓝', color: 0x2456d6 },
  { name: '竞速黄', color: 0xe8b621 },
  { name: '原野绿', color: 0x2fa04f },
  { name: '落日橙', color: 0xe8641f },
  { name: '幻影紫', color: 0x8b2fd6 },
  { name: '午夜黑', color: 0x1c1c22 },
  { name: '珍珠白', color: 0xd8d8e0 },
];

export const UNDERGLOWS: { name: string; color: number | null }[] = [
  { name: '关闭', color: null },
  { name: '冰晶蓝', color: 0x18e0ff },
  { name: '霓虹粉', color: 0xff2fd4 },
  { name: '酸液绿', color: 0x4dff4d },
  { name: '琥珀', color: 0xffb020 },
  { name: '紫外光', color: 0x9a4dff },
];

export const RIM_STYLES: { id: RimStyle; name: string }[] = [
  { id: 'sport', name: '五辐运动' },
  { id: 'mesh', name: '多辐网状' },
  { id: 'dish', name: '封闭大饼' },
];

export const SPOILER_STYLES: { id: SpoilerStyle; name: string }[] = [
  { id: 'none', name: '无' },
  { id: 'low', name: '低尾翼' },
  { id: 'gt', name: 'GT 大尾翼' },
];

export const LIVERIES: { id: LiveryId; name: string }[] = [
  { id: 'none', name: '无涂装' },
  { id: 'stripes', name: '双条纹' },
  { id: 'roundel', name: '号码圆标' },
  { id: 'twotone', name: '双色拼漆' },
  { id: 'checkered', name: '格子旗' },
  { id: 'flames', name: '烈焰' },
  { id: 'slashes', name: '斜纹' },
];

export const ACCENTS: { name: string; color: number }[] = [
  { name: '珍珠白', color: 0xf2f2f2 },
  { name: '午夜黑', color: 0x141416 },
  { name: '竞速黄', color: 0xffd320 },
  { name: '冰晶蓝', color: 0x18e0ff },
  { name: '烈焰红', color: 0xff3b30 },
  { name: '落日橙', color: 0xff8a1a },
];

export const clampCarNumber = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.min(99, Math.max(0, Math.floor(v)))
    : 7;

const STORAGE_KEY = 'retro-rush-save-v1';

export function defaultSave(): SaveData {
  return {
    credits: 0,
    upgrades: { engine: 0, tires: 0, nitro: 0 },
    appearance: { paint: PAINTS[0].color, spoiler: 'low', rims: 'sport', underglow: 0x18e0ff },
    livery: { id: 'stripes', accent: 0xf2f2f2, number: 7 },
    bloom: true,
    muted: false,
    volume: 0.8,
    lastMode: 'circuit',
    records: { circuit: null, sprint: null },
    lastConditions: { time: 'day', weather: 'clear' },
  };
}

export function loadSave(): SaveData {
  const base = defaultSave();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const data = JSON.parse(raw) as Partial<SaveData>;
    return {
      credits: typeof data.credits === 'number' ? Math.max(0, Math.floor(data.credits)) : 0,
      upgrades: {
        engine: clampLevel(data.upgrades?.engine),
        tires: clampLevel(data.upgrades?.tires),
        nitro: clampLevel(data.upgrades?.nitro),
      },
      appearance: {
        paint: typeof data.appearance?.paint === 'number' ? data.appearance.paint : base.appearance.paint,
        spoiler: isSpoiler(data.appearance?.spoiler) ? data.appearance.spoiler : base.appearance.spoiler,
        rims: isRim(data.appearance?.rims) ? data.appearance.rims : base.appearance.rims,
        underglow:
          data.appearance?.underglow === null || typeof data.appearance?.underglow === 'number'
            ? data.appearance.underglow
            : base.appearance.underglow,
      },
      livery: {
        id: isLivery(data.livery?.id) ? data.livery.id : base.livery.id,
        accent:
          typeof data.livery?.accent === 'number' ? data.livery.accent : base.livery.accent,
        number: clampCarNumber(data.livery?.number),
      },
      bloom: typeof data.bloom === 'boolean' ? data.bloom : true,
      muted: typeof data.muted === 'boolean' ? data.muted : false,
      volume:
        typeof data.volume === 'number' && Number.isFinite(data.volume)
          ? Math.min(1, Math.max(0, data.volume))
          : 0.8,
      lastMode:
        data.lastMode === 'sprint' ||
        data.lastMode === 'circuit' ||
        data.lastMode === 'knockout' ||
        data.lastMode === 'hotpursuit'
          ? data.lastMode
          : 'circuit',
      records: {
        circuit: validRecord(data.records?.circuit),
        sprint: validRecord(data.records?.sprint),
      },
      lastConditions: {
        time:
          data.lastConditions?.time === 'sunset' || data.lastConditions?.time === 'night'
            ? data.lastConditions.time
            : 'day',
        weather: data.lastConditions?.weather === 'rain' ? 'rain' : 'clear',
      },
    };
  } catch {
    return base;
  }
}

export function persistSave(save: SaveData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
  } catch {
    // 隐私模式等场景下静默失败
  }
}

/** 尝试购买一级改装，成功返回 true 并持久化 */
export function tryBuy(save: SaveData, key: keyof UpgradeLevels): boolean {
  const level = save.upgrades[key];
  if (level >= UPGRADE_MAX) return false;
  const cost = UPGRADE_COSTS[level];
  if (save.credits < cost) return false;
  save.credits -= cost;
  save.upgrades[key] = level + 1;
  persistSave(save);
  return true;
}

/** AI 车辆随机外观方案 */
export function randomAppearance(): AppearanceConfig {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  return {
    paint: pick(PAINTS).color,
    spoiler: pick(SPOILER_STYLES).id,
    rims: pick(RIM_STYLES).id,
    underglow: Math.random() < 0.6 ? pick(UNDERGLOWS.filter((u) => u.color !== null)).color : null,
  };
}

/** AI 车辆随机涂装 */
export function randomLivery(): LiveryConfig {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  return {
    id: pick(LIVERIES.filter((l) => l.id !== 'none')).id,
    accent: pick(ACCENTS).color,
    number: Math.floor(Math.random() * 100),
  };
}

const clampLevel = (v: unknown): number =>
  typeof v === 'number' ? Math.min(UPGRADE_MAX, Math.max(0, Math.floor(v))) : 0;

const isSpoiler = (v: unknown): v is SpoilerStyle =>
  v === 'none' || v === 'low' || v === 'gt';

const isLivery = (v: unknown): v is LiveryId =>
  typeof v === 'string' && (LIVERIES as { id: string }[]).some((l) => l.id === v);

const isRim = (v: unknown): v is RimStyle => v === 'sport' || v === 'mesh' || v === 'dish';

const validRecord = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
