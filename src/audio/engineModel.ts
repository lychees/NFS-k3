import { clamp } from '../utils/math';

/**
 * 引擎声学模型（纯函数，可无头测试）：
 * 虚拟转速 = 车速在当前档位速比区间内的位置；5 档自动模拟。
 */

export const GEAR_TOPS = [0.25, 0.42, 0.6, 0.78, 1.0] as const; // 各档极速（占 topSpeed 比例）
export const GEAR_COUNT = GEAR_TOPS.length;
export const SHIFT_TIME = 0.22; // 换挡顿挫时长（秒）

const SHIFT_UP_RPM = 0.94;
const DOWNSHIFT_RATIO = 0.55;
const IDLE_RPM = 0.18;

export interface GearboxState {
  gear: number; // 1..5
  shiftT: number; // 剩余顿挫时间
}

export const initGearbox = (): GearboxState => ({ gear: 1, shiftT: 0 });

export interface GearboxStep {
  state: GearboxState;
  /** 虚拟转速 0.18..1 */
  rpm: number;
  upshifted: boolean;
}

export function stepGearbox(prev: GearboxState, speedRatio: number, dt: number): GearboxStep {
  const r = clamp(Number.isFinite(speedRatio) ? speedRatio : 0, 0, 1.2);
  let { gear } = prev;
  let shiftT = Math.max(0, prev.shiftT - dt);
  let upshifted = false;

  const rpmNow = clamp(r / GEAR_TOPS[gear - 1], 0, 1);
  if (rpmNow > SHIFT_UP_RPM && gear < GEAR_COUNT) {
    gear += 1;
    shiftT = SHIFT_TIME;
    upshifted = true;
  } else if (gear > 1 && r < GEAR_TOPS[gear - 2] * DOWNSHIFT_RATIO) {
    gear -= 1;
  }

  // 转速随档位切换自然回落/拉升
  const rpm = Math.max(clamp(r / GEAR_TOPS[gear - 1], 0, 1), IDLE_RPM);
  return { state: { gear, shiftT }, rpm, upshifted };
}

/** 基频：55Hz 怠速 -> 220Hz 红区 */
export const engineFreq = (rpm: number): number => 55 + clamp(rpm, 0, 1.2) * 165;

/** 低通截止：转速与节气门开大 -> 滤波打开 */
export const engineCutoff = (rpm: number, throttle: number): number =>
  320 + clamp(rpm, 0, 1.2) * 2100 + clamp(throttle, 0, 1) * 650;

/** 引擎音量包络：怠速低鸣，节气门越大越响，换挡顿挫时骤降 */
export const engineGain = (rpm: number, throttle: number, shifting: boolean): number => {
  const base = 0.09 + clamp(rpm, 0, 1) * 0.1 + clamp(throttle, 0, 1) * 0.22;
  return shifting ? base * 0.45 : base;
};

/** 胎响强度：低速不响，随侧滑速度饱和 */
export const skidIntensity = (latSpeed: number, speedKmh: number): number =>
  speedKmh < 18 ? 0 : clamp((Math.abs(latSpeed) - 3) / 7, 0, 1);

/** 草地滚动声强度 */
export const grassIntensity = (speedKmh: number, onRoad: boolean): number =>
  onRoad ? 0 : clamp(speedKmh / 60, 0, 1);
