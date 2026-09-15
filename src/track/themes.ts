/** 地形主题（数据驱动）：决定地形配色 / 植被种类 / 雾色混合 / 路面染色 */

export type ThemeId = 'grass' | 'desert' | 'snow' | 'city';

export interface ThemePalette {
  name: string;
  /** 地形顶点色：HSL 色相范围 / 饱和 / 明度范围（叠加噪声） */
  groundH: [number, number];
  groundS: number;
  groundL: [number, number];
  /** 近路泥土色 */
  roadDirt: number;
  /** 路面染色（白 = 不变） */
  roadTint: number;
  /** 雾/天际线混合：0 不混（天气优先 —— 雨天覆盖在主题之上） */
  fogMix: number;
  fogMixColor: number;
}

export const THEMES: Record<ThemeId, ThemePalette> = {
  grass: {
    name: '草原',
    groundH: [0.25, 0.32],
    groundS: 0.42,
    groundL: [0.2, 0.3],
    roadDirt: 0x5a5a3c,
    roadTint: 0xffffff,
    fogMix: 0,
    fogMixColor: 0xbfd9e8,
  },
  desert: {
    name: '沙漠',
    groundH: [0.1, 0.13],
    groundS: 0.45,
    groundL: [0.42, 0.55],
    roadDirt: 0x8a7a52,
    roadTint: 0xffffff,
    fogMix: 0.35,
    fogMixColor: 0xe8c890,
  },
  snow: {
    name: '雪地',
    groundH: [0.55, 0.58],
    groundS: 0.15,
    groundL: [0.72, 0.85],
    roadDirt: 0x9aa4ac,
    roadTint: 0xdfe8ee,
    fogMix: 0.35,
    fogMixColor: 0xcfe0ea,
  },
  city: {
    name: '工业区',
    groundH: [0.58, 0.62],
    groundS: 0.12,
    groundL: [0.14, 0.22],
    roadDirt: 0x2a2c30,
    roadTint: 0x9099a3,
    fogMix: 0.4,
    fogMixColor: 0x4a5560,
  },
};

export const DEFAULT_THEME: ThemeId = 'grass';

export const isTheme = (v: unknown): v is ThemeId =>
  typeof v === 'string' && v in THEMES;

export const themeOf = (v: unknown): ThemeId => (isTheme(v) ? v : DEFAULT_THEME);
