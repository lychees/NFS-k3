/** 赛道定义（数据驱动）：新增赛道只需在此加一条 TrackDef */

/** 赛道 id：内置固定键 + 自定义 'custom-*' */
export type TrackId = string;

export interface TrackDef {
  id: TrackId;
  name: string;
  /** 闭合环道 / 开放点对点 */
  closed: boolean;
  /** Catmull-Rom 控制点（含高度起伏） */
  points: [number, number, number][];
  halfWidth: number;
  runoffWidth: number;
  /** 样条弧长采样数（nearest 查询分辨率） */
  samples: number;
  /** 检查点数量（环道为每圈） */
  checkpoints: number;
  /** 圈数；点对点 = 1 */
  laps: number;
  /** 发车格沿赛道的绝对里程（冲刺道用，起跑线之前的距离） */
  startOffset: number;
  /** 丘陵幅度倍率 */
  hills: number;
  /** 植被密度倍率 */
  vegetation: number;
}

// 环道：经典 1.65km 环形
const CIRCUIT_POINTS: [number, number, number][] = [
  [0, 0, -220],
  [120, 1, -200],
  [210, 4, -120],
  [240, 9, -10],
  [190, 12, 90],
  [230, 7, 180],
  [150, 3, 240],
  [40, 1, 220],
  [-60, 4, 250],
  [-160, 9, 200],
  [-230, 13, 110],
  [-200, 10, 0],
  [-250, 5, -90],
  [-180, 2, -180],
  [-90, 0, -215],
];

// 冲刺道：~4.4km 点对点山路，落差 ~40m，连续回头弯 + 山谷绕行
const SPRINT_POINTS: [number, number, number][] = [
  [-700, 0, -700],
  [-600, 1, -680],
  [-500, 2, -620],
  [-420, 4, -520],
  [-440, 7, -410],
  [-380, 11, -300],
  [-260, 15, -250],
  [-180, 19, -310],
  [-80, 23, -270],
  [-20, 27, -160],
  [-160, 32, -150],
  [-200, 35, -30],
  [-90, 38, 80],
  [20, 41, 150],
  [150, 38, 190],
  [240, 33, 140],
  [230, 30, 30],
  [140, 34, -20],
  [110, 31, -100],
  [200, 28, -160],
  [310, 25, -90],
  [330, 24, 40],
  [300, 26, 170],
  [330, 30, 300],
  [420, 33, 320],
  [480, 29, 220],
  [490, 26, 340],
  [400, 23, 440],
  [320, 20, 530],
  [260, 15, 700],
  [300, 13, 790],
  [430, 14, 760],
  [470, 15, 650],
  [560, 12, 600],
  [640, 9, 670],
  [710, 7, 740],
  [770, 6, 790],
];

// 海岸环道：宽阔流畅大弯，低落差，开阔视野
const COAST_POINTS: [number, number, number][] = [
  [0, 0, -260],
  [180, 1, -240],
  [320, 2, -150],
  [380, 3, 0],
  [340, 4, 150],
  [200, 3, 240],
  [20, 2, 280],
  [-160, 2, 240],
  [-280, 3, 130],
  [-340, 2, -20],
  [-300, 1, -170],
  [-150, 0, -250],
];

// 沙漠冲刺道：长直道 + 连续 S 弯，中等落差
const DESERT_POINTS: [number, number, number][] = [
  [-680, 0, -620],
  [-480, 1, -640],
  [-280, 2, -600],
  [-80, 4, -560],
  [120, 6, -480],
  [260, 9, -340],
  [180, 12, -180],
  [280, 14, -20],
  [180, 16, 140],
  [300, 18, 280],
  [220, 20, 440],
  [380, 22, 560],
  [560, 20, 640],
  [720, 16, 700],
];

// 山地技术环道：窄路大落差，连续回头弯
const RIDGE_POINTS: [number, number, number][] = [
  [0, 0, -180],
  [120, 3, -160],
  [180, 8, -60],
  [120, 14, 30],
  [190, 20, 110],
  [90, 26, 170],
  [-30, 30, 120],
  [-130, 33, 170],
  [-190, 28, 60],
  [-110, 22, -30],
  [-190, 16, -110],
  [-90, 8, -190],
];

export const TRACK_DEFS: Record<TrackId, TrackDef> = {
  circuit: {
    id: 'circuit',
    name: '环形赛道',
    closed: true,
    points: CIRCUIT_POINTS,
    halfWidth: 7,
    runoffWidth: 4.4,
    samples: 1000,
    checkpoints: 12,
    laps: 3,
    startOffset: 0,
    hills: 1,
    vegetation: 1,
  },
  coast: {
    id: 'coast',
    name: '海岸环道',
    closed: true,
    points: COAST_POINTS,
    halfWidth: 8,
    runoffWidth: 5,
    samples: 1000,
    checkpoints: 12,
    laps: 3,
    startOffset: 0,
    hills: 0.5,
    vegetation: 0.5,
  },
  ridge: {
    id: 'ridge',
    name: '山地技术环道',
    closed: true,
    points: RIDGE_POINTS,
    halfWidth: 5.5,
    runoffWidth: 3.0,
    samples: 1100,
    checkpoints: 12,
    laps: 3,
    startOffset: 0,
    hills: 2.0,
    vegetation: 2.0,
  },
  sprint: {
    id: 'sprint',
    name: '点对点山路',
    closed: false,
    points: SPRINT_POINTS,
    halfWidth: 6,
    runoffWidth: 3.6,
    samples: 1400,
    checkpoints: 10,
    laps: 1,
    startOffset: 17,
    hills: 1.7,
    vegetation: 1.5,
  },
  desert: {
    id: 'desert',
    name: '沙漠冲刺道',
    closed: false,
    points: DESERT_POINTS,
    halfWidth: 6.5,
    runoffWidth: 4.0,
    samples: 1400,
    checkpoints: 10,
    laps: 1,
    startOffset: 17,
    hills: 1.0,
    vegetation: 0.7,
  },
};

/** 各模式的赛道兼容性：环道类选 closed，冲刺/追逐选开放 */
export const TRACK_COMPAT: Record<string, { closed: boolean; defaultTrack: TrackId }> = {
  circuit: { closed: true, defaultTrack: 'circuit' },
  knockout: { closed: true, defaultTrack: 'circuit' },
  sprint: { closed: false, defaultTrack: 'sprint' },
  hotpursuit: { closed: false, defaultTrack: 'sprint' },
};

/** 环道发车格（起点线后，负里程） */
export const GRID_SLOTS = [
  { dist: -10, lat: 2.4 },
  { dist: -17, lat: -2.4 },
  { dist: -24, lat: 2.4 },
  { dist: -31, lat: -2.4 },
];

/** 冲刺道发车格（沿赛道正向，玩家最后 = startOffset 处） */
export const SPRINT_GRID_SLOTS = [
  { dist: 38, lat: 2.2 },
  { dist: 31, lat: -2.2 },
  { dist: 24, lat: 2.2 },
  { dist: 17, lat: -2.2 },
];
