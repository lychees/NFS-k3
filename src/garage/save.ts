/** 车库存档：积分 / 性能改装等级 / 外观配置，localStorage 持久化 */

export type RimStyle = 'sport' | 'mesh' | 'dish';
export type SpoilerStyle = 'none' | 'low' | 'gt';

/** 玩家可选 GLB 车型（Kenney Car Kit） */
export const PLAYER_VEHICLES = [
  { id: 'race', name: 'RACE' },
  { id: 'race-future', name: 'FUTURE' },
  { id: 'sedan-sports', name: 'SEDAN-S' },
  { id: 'hatchback-sports', name: 'HATCH-S' },
] as const;
export type PlayerVehicleId = (typeof PLAYER_VEHICLES)[number]['id'];

export const PLAYER_VEHICLE_IDS: readonly PlayerVehicleId[] = PLAYER_VEHICLES.map((v) => v.id);

/** AI 车型池 */
export const AI_VEHICLES = ['sedan', 'suv', 'taxi'] as const;
export type AiVehicleId = (typeof AI_VEHICLES)[number];
export type VehicleId = PlayerVehicleId | AiVehicleId | 'police';
export type LiveryId =
  | 'none'
  | 'stripes'
  | 'roundel'
  | 'twotone'
  | 'checkered'
  | 'flames'
  | 'slashes'
  | 'custom';

/** 涂装配置：预设 + 强调色 + 赛车号码；custom 时使用 customImage（PNG dataURL） */
export interface LiveryConfig {
  id: LiveryId;
  accent: number;
  /** 0-99 */
  number: number;
  /** 'custom' 涂装的贴图（无绘制内容时为 null = 无涂装） */
  customImage?: string | null;
}

export interface AppearanceConfig {
  paint: number;
  spoiler: SpoilerStyle;
  rims: RimStyle;
  /** null = 关闭底盘灯 */
  underglow: number | null;
  /** GLB 车型（加载失败时回退程序化车模；police 仅警车内部使用） */
  vehicle: VehicleId;
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
  /** 各模式上次选用的赛道 id */
  lastTracks: Partial<Record<'circuit' | 'sprint' | 'knockout' | 'hotpursuit', string>>;
  /** 各赛道最佳总用时（按赛道 id，秒） */
  records: Record<string, number>;
  /** 编辑器自定义赛道 */
  customTracks: import('../track/customTrack').CustomTrackData[];
  /** 涂装工作室已存方案 */
  liveryDesigns: import('../car/customLivery').LiveryDesign[];
  /** 上次比赛设置：时间 × 天气 */
  lastConditions: {
    time: 'day' | 'sunset' | 'night';
    weather: 'clear' | 'rain';
  };
  /** 车辆损伤开关（默认 ON） */
  damageEnabled: boolean;
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
  { id: 'custom', name: '自定义' },
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
    appearance: { paint: PAINTS[0].color, spoiler: 'low', rims: 'sport', underglow: 0x18e0ff, vehicle: 'race' },
    livery: { id: 'stripes', accent: 0xf2f2f2, number: 7, customImage: null },
    bloom: true,
    muted: false,
    volume: 0.8,
    lastMode: 'circuit',
    lastTracks: {},
    records: {},
    customTracks: [],
    liveryDesigns: [],
    lastConditions: { time: 'day', weather: 'clear' },
    damageEnabled: true,
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
        vehicle: isVehicle(data.appearance?.vehicle) ? data.appearance.vehicle : base.appearance.vehicle,
      },
      livery: {
        id: isLivery(data.livery?.id) ? data.livery.id : base.livery.id,
        accent:
          typeof data.livery?.accent === 'number' ? data.livery.accent : base.livery.accent,
        number: clampCarNumber(data.livery?.number),
        customImage: isImageDataUrl(data.livery?.customImage)
          ? data.livery.customImage || null
          : null,
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
      records: migrateRecords(data.records),
      lastTracks: migrateLastTracks(data.lastTracks),
      customTracks: migrateCustomTracks(data.customTracks),
      liveryDesigns: migrateLiveryDesigns(data.liveryDesigns),
      lastConditions: {
        time:
          data.lastConditions?.time === 'sunset' || data.lastConditions?.time === 'night'
            ? data.lastConditions.time
            : 'day',
        weather: data.lastConditions?.weather === 'rain' ? 'rain' : 'clear',
      },
      damageEnabled: typeof data.damageEnabled === 'boolean' ? data.damageEnabled : true,
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

/** AI 车辆随机外观方案（vehiclePool 指定车型池） */
export function randomAppearance(
  vehiclePool: readonly (PlayerVehicleId | AiVehicleId)[] = AI_VEHICLES,
): AppearanceConfig {
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
  return {
    paint: pick(PAINTS).color,
    spoiler: pick(SPOILER_STYLES).id,
    rims: pick(RIM_STYLES).id,
    underglow: Math.random() < 0.6 ? pick(UNDERGLOWS.filter((u) => u.color !== null)).color : null,
    vehicle: pick(vehiclePool),
  };
}

/** AI 车辆随机涂装（有已存自定义方案时 25% 概率选用） */
export function randomLivery(
  designs: import('../car/customLivery').LiveryDesign[] = [],
): LiveryConfig {
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
  if (designs.length > 0 && Math.random() < 0.25) {
    return {
      id: 'custom',
      accent: pick(ACCENTS).color,
      number: Math.floor(Math.random() * 100),
      customImage: pick(designs).image,
    };
  }
  return {
    id: pick(LIVERIES.filter((l) => l.id !== 'none' && l.id !== 'custom')).id,
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

const isImageDataUrl = (v: unknown): v is string =>
  typeof v === 'string' && v.startsWith('data:image/');

const isRim = (v: unknown): v is RimStyle => v === 'sport' || v === 'mesh' || v === 'dish';

const isVehicle = (v: unknown): v is AppearanceConfig['vehicle'] =>
  typeof v === 'string' &&
  ((PLAYER_VEHICLES as readonly { id: string }[]).some((x) => x.id === v) ||
    (AI_VEHICLES as readonly string[]).includes(v));

const validRecord = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

/** 纪录迁移：旧版 {circuit, sprint} 固定键 -> 按赛道 id 的稀疏表 */
function migrateRecords(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const r = validRecord(val);
      if (r !== null) out[k] = r;
    }
  }
  return out;
}

const MODES = ['circuit', 'sprint', 'knockout', 'hotpursuit'] as const;

function migrateLastTracks(v: unknown): SaveData['lastTracks'] {
  const out: SaveData['lastTracks'] = {};
  if (v && typeof v === 'object') {
    for (const m of MODES) {
      const t = (v as Record<string, unknown>)[m];
      if (typeof t === 'string' && t.length > 0) out[m] = t;
    }
  }
  return out;
}

function migrateLiveryDesigns(v: unknown): SaveData['liveryDesigns'] {
  if (!Array.isArray(v)) return [];
  const out: SaveData['liveryDesigns'] = [];
  for (const d of v as Partial<SaveData['liveryDesigns'][number]>[]) {
    if (
      d &&
      typeof d.id === 'string' &&
      typeof d.name === 'string' &&
      isImageDataUrl(d.image) &&
      d.image !== ''
    ) {
      out.push({ id: d.id, name: d.name, image: d.image });
    }
  }
  return out;
}

function migrateCustomTracks(v: unknown): SaveData['customTracks'] {
  if (!Array.isArray(v)) return [];
  const out: SaveData['customTracks'] = [];
  for (const t of v as Partial<SaveData['customTracks'][number]>[]) {
    if (
      t &&
      typeof t.id === 'string' &&
      typeof t.name === 'string' &&
      typeof t.closed === 'boolean' &&
      Array.isArray(t.points) &&
      t.points.every((p) => Array.isArray(p) && p.length === 3 && p.every((x) => Number.isFinite(x))) &&
      typeof t.halfWidth === 'number' &&
      typeof t.hills === 'number' &&
      typeof t.vegetation === 'number'
    ) {
      out.push({
        id: t.id,
        name: t.name,
        closed: t.closed,
        points: t.points.map((p) => [p[0], p[1], p[2]]),
        halfWidth: t.halfWidth,
        hills: t.hills,
        vegetation: t.vegetation,
        custom: true,
      });
    }
  }
  return out;
}
