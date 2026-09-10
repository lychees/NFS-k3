import { clamp } from '../utils/math';

export const DAMAGE_MAX = 100;
export const DAMAGE_REPAIR_PER_LAP = 10; // 过线/检查点自修

/**
 * 冲击速度（m/s）-> 损伤增量（纯函数）：
 * <3 m/s 剐蹭免伤，25 m/s 正面满击约 22 点。
 */
export const impactDamage = (impactSpeed: number): number =>
  Number.isFinite(impactSpeed) ? clamp((impactSpeed - 3) / 22, 0, 1) * 22 : 0;

/** 损伤 -> 性能乘法系数（100% 时：极速 -25% / 加速 -30% / 转向 -20%） */
export const damageTopSpeedMult = (d: number): number => 1 - 0.25 * clamp(d / DAMAGE_MAX, 0, 1);
export const damageAccelMult = (d: number): number => 1 - 0.3 * clamp(d / DAMAGE_MAX, 0, 1);
export const damageSteerMult = (d: number): number => 1 - 0.2 * clamp(d / DAMAGE_MAX, 0, 1);

/** 视觉分档：0 完好 / 1 轻(>25) / 2 中(>50) / 3 重(>75) */
export type DamageTier = 0 | 1 | 2 | 3;
export const damageTier = (d: number): DamageTier =>
  d > 75 ? 3 : d > 50 ? 2 : d > 25 ? 1 : 0;
