import { clamp, lerp } from '../utils/math';
import type { UpgradeLevels } from '../garage/save';

export interface CarInput {
  /** 0..1 */
  throttle: number;
  /** 0..1，低速时兼作倒车 */
  brake: number;
  /** -1..1，正 = 右转 */
  steer: number;
  handbrake: boolean;
  nitro: boolean;
}

/** 按改装等级生成的整车调校参数 */
export interface TuningParams {
  maxSpeed: number;
  engineAccel: number;
  steerSpeed: number;
  /** 横向加速度上限 m/s²（手感核心：高速不陀螺，轮胎每级 +1.2） */
  latG: number;
  lateralGrip: number;
  handbrakeGrip: number;
  nitroPower: number;
  nitroCapacity: number;
}

export const NITRO_DRAIN = 34; // 氮气消耗 / 秒
export const NITRO_LAP_BONUS = 0.3; // 每过起点线回复容量比例
export const NITRO_TOPSPEED_BOOST = 1.12; // 氮气期间极速上限倍率

/** 改装 -> 物理参数映射（0-5 级线性） */
export function makeTuning(u: UpgradeLevels): TuningParams {
  return {
    maxSpeed: 61 + 2.2 * u.engine, // 61 -> 72 m/s
    engineAccel: 16 + 1.6 * u.engine, // 16 -> 24 m/s²
    steerSpeed: 6.0 + 0.3 * u.tires, // 方向盘速率（跟手优先）
    latG: 18 + 1.2 * u.tires, // 横向加速度上限 18 -> 24 m/s²（手感主旋钮：高速横摆上限 = latG/v）
    lateralGrip: 6.5 + 0.9 * u.tires, // 6.5 -> 11（保留一点滑移感）
    handbrakeGrip: 1.3 + 0.25 * u.tires, // 漂移后恢复更快
    nitroPower: 9 + 3 * u.nitro, // 9 -> 24 m/s² 额外推力
    nitroCapacity: 30 + 14 * u.nitro, // 30 -> 100 单位
  };
}

export const PHYS = {
  maxReverse: 11,
  brakeDecel: 30,
  reverseAccel: 8,
  coastDrag: 0.3, // 松油门自然减速
  wheelBase: 2.7,
  steerMaxLow: 0.45, // 低速最大转角（rad）——缩小，配合横向G钳制
  steerMaxHigh: 0.14, // 高速最大转角——上限由横向G决定而非转角
  steerReturnMult: 1.2, // 回正比打入快 20%
  yawSmoothing: 0.1, // 横摆一阶低通时间常数（秒），消除开关感
  countersteerBoost: 1.8, // 漂移反打救车的抓地加成
  driftYawBoost: 1.7, // 手刹时额外横摆
  grassGripScale: 0.55,
  grassDrag: 1.6, // 草地额外阻力
  grassSpeedCap: 20, // 草地速度软上限
  wallDrag: 2.2, // 蹭护栏减速惩罚
} as const;

export interface Surface {
  gripScale: number;
  dragExtra: number;
  speedCap: number;
  /** 刹车力度系数（雨天 < 1，刹车距离变长） */
  brakeScale: number;
}

export const ROAD_SURFACE: Surface = { gripScale: 1, dragExtra: 0, speedCap: Infinity, brakeScale: 1 };

export const GRASS_SURFACE: Surface = {
  gripScale: PHYS.grassGripScale,
  dragExtra: PHYS.grassDrag,
  speedCap: PHYS.grassSpeedCap,
  brakeScale: 1,
};

/** 雨天湿滑修正：抓地 ×0.75 更易侧滑、刹车 ×0.72、阻力略增 */
export const WET_GRIP_SCALE = 0.75;
export const WET_BRAKE_SCALE = 0.72;
export const WET_ROAD_SURFACE: Surface = {
  gripScale: WET_GRIP_SCALE,
  dragExtra: 0.25,
  speedCap: Infinity,
  brakeScale: WET_BRAKE_SCALE,
};
export const WET_GRASS_SURFACE: Surface = {
  gripScale: PHYS.grassGripScale * WET_GRIP_SCALE,
  dragExtra: PHYS.grassDrag + 0.25,
  speedCap: PHYS.grassSpeedCap,
  brakeScale: WET_BRAKE_SCALE,
};

export interface PhysicsState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** 朝向角，forward = (sin h, 0, cos h)；右转 = h 减小 */
  heading: number;
  steer: number; // 当前实际转角（rad，带惯性）
  /** 当前横摆角速度（一阶低通状态） */
  yawRate: number;
  forwardSpeed: number; // 输出：纵向速度
  longAccel: number; // 输出：纵向加速度（车身俯仰用）
  latAccel: number; // 输出：向心加速度（车身侧倾用）
  latSpeed: number; // 输出：侧向速度（漂移烟雾用）
  nitroFuel: number;
  nitroActive: boolean; // 输出：本帧氮气是否生效
}

/**
 * 街机车辆模型：速度分解为纵向/侧向分量，
 * 侧向分量按抓地力指数衰减 —— 手刹时衰减弱即漂移。
 */
export function stepPhysics(
  s: PhysicsState,
  input: CarInput,
  dt: number,
  surface: Surface,
  tuning: TuningParams,
  speedMultiplier: number,
): void {
  const fx = Math.sin(s.heading);
  const fz = Math.cos(s.heading);
  const rx = -Math.cos(s.heading);
  const rz = Math.sin(s.heading);

  let vF = s.vx * fx + s.vz * fz;
  let vR = s.vx * rx + s.vz * rz;

  const nitroOn = input.nitro && s.nitroFuel > 0 && vF > 0;
  const topSpeed =
    tuning.maxSpeed * speedMultiplier * (nitroOn ? NITRO_TOPSPEED_BOOST : 1);

  // 油门：接近极速时推力衰减
  if (input.throttle > 0 && vF < topSpeed) {
    const push = tuning.engineAccel * clamp(1 - vF / topSpeed, 0, 1);
    vF += input.throttle * push * dt;
  }
  // 氮气：额外推力，可突破常规极速
  if (nitroOn) {
    vF += tuning.nitroPower * dt;
    s.nitroFuel = Math.max(0, s.nitroFuel - NITRO_DRAIN * dt);
  }
  s.nitroActive = nitroOn;
  // 刹车 / 倒车（雨天 brakeScale < 1，刹车距离变长）
  if (input.brake > 0) {
    if (vF > 0.5) vF = Math.max(0, vF - PHYS.brakeDecel * surface.brakeScale * input.brake * dt);
    else vF = Math.max(-PHYS.maxReverse, vF - PHYS.reverseAccel * input.brake * dt);
  }
  // 阻力
  const drag = PHYS.coastDrag + surface.dragExtra;
  vF -= vF * drag * dt;
  if (vF > surface.speedCap) {
    vF = Math.max(surface.speedCap, vF - PHYS.grassDrag * 2.5 * dt * (vF - surface.speedCap));
  }

  // 侧向抓地（手刹时保留侧滑 = 漂移）
  let grip = (input.handbrake ? tuning.handbrakeGrip : tuning.lateralGrip) * surface.gripScale;
  // 漂移反打救车：转向与侧滑方向相反时抓地恢复加成
  if (input.handbrake && Math.abs(vR) > 1 && Math.sign(input.steer) === -Math.sign(vR)) {
    grip *= PHYS.countersteerBoost;
  }
  vR *= Math.exp(-grip * dt);

  // 转向：转角随速度收窄（sqrt 曲线，中速过渡更自然）；打入/回正不同速率
  const speedK = Math.sqrt(clamp(Math.abs(vF) / tuning.maxSpeed, 0, 1));
  const steerMax = lerp(PHYS.steerMaxLow, PHYS.steerMaxHigh, speedK);
  const steerTarget = input.steer * steerMax;
  const returning = Math.abs(steerTarget) < Math.abs(s.steer);
  const steerRate = tuning.steerSpeed * (returning ? PHYS.steerReturnMult : 1);
  const steerDelta = clamp(steerTarget - s.steer, -steerRate * dt, steerRate * dt);
  s.steer += steerDelta;

  // 目标横摆（右转 = heading 减小；倒车自然反向）：
  // 按横向 G 上限钳制 —— 低速小半径灵活、高速自然变稳不陀螺
  let yawTarget = 0;
  if (Math.abs(vF) > 0.1) {
    yawTarget = -(vF / PHYS.wheelBase) * Math.tan(s.steer);
    if (input.handbrake && vF > 5) yawTarget *= PHYS.driftYawBoost;
    const cap = (tuning.latG * surface.gripScale) / Math.max(Math.abs(vF), 2);
    yawTarget = clamp(yawTarget, -cap, cap);
  }
  // 横摆一阶低通逼近目标，消除骤起骤停的开关感
  const yawK = 1 - Math.exp(-dt / PHYS.yawSmoothing);
  s.yawRate += (yawTarget - s.yawRate) * yawK;
  s.heading += s.yawRate * dt;

  s.latAccel = -s.yawRate * vF; // 右转（yawRate<0）为正
  const prevVF = s.forwardSpeed;
  s.longAccel = dt > 0 ? (vF - prevVF) / dt : 0;
  s.forwardSpeed = vF;
  s.latSpeed = vR;

  const nfx = Math.sin(s.heading);
  const nfz = Math.cos(s.heading);
  const nrx = -Math.cos(s.heading);
  const nrz = Math.sin(s.heading);
  s.vx = nfx * vF + nrx * vR;
  s.vz = nfz * vF + nrz * vR;
  s.x += s.vx * dt;
  s.z += s.vz * dt;
}
