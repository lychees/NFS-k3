import { clamp } from '../utils/math';
import type { PlayerVehicleId } from '../garage/save';
import type { TuningParams } from './carPhysics';

/** 车型性能档案（数据驱动）：乘法修正，与改装等级叠加后钳制 */
export interface VehicleSpec {
  name: string;
  /** 性格一句话（车库显示） */
  desc: string;
  maxSpeedMult: number;
  accelMult: number;
  /** 转向性：同时作用于 latG 与 lateralGrip */
  gripMult: number;
  /** 漂移恢复（handbrakeGrip；<1 = 打滑后更难救） */
  handbrakeMult: number;
}

export const VEHICLE_SPECS: Record<PlayerVehicleId, VehicleSpec> = {
  race: {
    name: '方程式',
    desc: '全面偏强，但漂移恢复慢',
    maxSpeedMult: 1.08,
    accelMult: 1.05,
    gripMult: 1.1,
    handbrakeMult: 0.85,
  },
  'race-future': {
    name: '未来概念车',
    desc: '极速怪兽，弯道钝',
    maxSpeedMult: 1.12,
    accelMult: 1.08,
    gripMult: 0.92,
    handbrakeMult: 1.0,
  },
  'sedan-sports': {
    name: '运动轿车',
    desc: '均衡偏弯道',
    maxSpeedMult: 1.02,
    accelMult: 1.06,
    gripMult: 1.06,
    handbrakeMult: 1.0,
  },
  'hatchback-sports': {
    name: '钢炮',
    desc: '弯道王，极速弱',
    maxSpeedMult: 0.94,
    accelMult: 1.02,
    gripMult: 1.14,
    handbrakeMult: 1.05,
  },
};

/** 叠后钳制范围（防止满改 × 系数后失控） */
export const SPEC_CLAMPS = {
  maxSpeed: 85, // m/s ≈ 306 km/h
  engineAccel: 32,
  latG: 26,
  lateralGrip: 14,
  handbrakeGripMin: 0.5,
} as const;

export const vehicleSpecOf = (id: PlayerVehicleId): VehicleSpec => VEHICLE_SPECS[id];

/** 车型档案叠加到改装调校（纯函数，可测；只乘不改其他维度） */
export function applyVehicleSpec(tuning: TuningParams, spec: VehicleSpec): TuningParams {
  return {
    maxSpeed: Math.min(tuning.maxSpeed * spec.maxSpeedMult, SPEC_CLAMPS.maxSpeed),
    engineAccel: Math.min(tuning.engineAccel * spec.accelMult, SPEC_CLAMPS.engineAccel),
    steerSpeed: tuning.steerSpeed,
    latG: Math.min(tuning.latG * spec.gripMult, SPEC_CLAMPS.latG),
    lateralGrip: Math.min(tuning.lateralGrip * spec.gripMult, SPEC_CLAMPS.lateralGrip),
    handbrakeGrip: Math.max(tuning.handbrakeGrip * spec.handbrakeMult, SPEC_CLAMPS.handbrakeGripMin),
    nitroPower: tuning.nitroPower,
    nitroCapacity: tuning.nitroCapacity,
  };
}

// ---------- 性能参数条标定（0-10，纯函数） ----------

export interface PerfBars {
  speed: number;
  accel: number;
  handling: number;
  nitro: number;
}

const bar = (v: number, min: number, step: number): number =>
  clamp((v - min) / step, 0, 10);

/**
 * 0-10 标定（满改 + 强车型 ≈ 8-10，基础 + 弱车型 ≈ 2-4）：
 * SPEED 180km/h 起每 11km/h 一格；ACCEL 10m/s² 起每 1.8 一格；
 * HANDLING = (latG+lateralGrip)/2，6 起每 1.2 一格；NITRO 每 12 容量一格。
 */
export function performanceBars(t: TuningParams): PerfBars {
  return {
    speed: bar(t.maxSpeed * 3.6, 180, 11),
    accel: bar(t.engineAccel, 10, 1.8),
    handling: bar((t.latG + t.lateralGrip) / 2, 6, 1.2),
    nitro: bar(t.nitroCapacity, 0, 12),
  };
}

/** 参数条 tooltip 实际物理值 */
export function perfTooltip(t: TuningParams, key: keyof PerfBars): string {
  switch (key) {
    case 'speed':
      return `极速 ${(t.maxSpeed * 3.6).toFixed(0)} km/h`;
    case 'accel':
      return `加速 ${t.engineAccel.toFixed(1)} m/s²`;
    case 'handling':
      return `横向G ${t.latG.toFixed(1)} m/s² · 抓地 ${t.lateralGrip.toFixed(1)}`;
    case 'nitro':
      return `氮气容量 ${t.nitroCapacity.toFixed(0)}（${(t.nitroCapacity / 34).toFixed(1)}s）`;
  }
}
