import { clamp, wrapAngle } from '../utils/math';
import type { Car } from '../car/car';
import type { CarInput } from '../car/carPhysics';
import type { Track } from '../track/track';

/**
 * 警车追捕策略：
 * 远程 —— 沿赛道追（预瞄自身前方赛道点，横向贴住玩家车道），靠性能差逼近；
 * 近身 —— 直取玩家预测位置（位置 + 速度 × 预测时间）并左右摆动别车（PIT）。
 * 直线截击会切草地被困在护栏上，所以远程必须走路面。
 */
export class PursuitDriver {
  private phase: number;
  private time = 0;

  constructor(seed: number) {
    this.phase = seed * 1.618;
  }

  computeInput(car: Car, track: Track, player: Car, capMult: number, dt: number): CarInput {
    this.time += dt;
    const st = car.state;
    const ps = player.state;

    const dx = player.pos.x - st.x;
    const dz = player.pos.z - st.z;
    const dist = Math.hypot(dx, dz);

    let tx: number;
    let tz: number;
    if (dist < 25) {
      // 近身：直取预测位置 + 别车侧偏
      const predict = clamp(dist / 45, 0.2, 0.8);
      const side = Math.sin(this.time * 0.55 + this.phase) > 0 ? 1 : -1;
      const prx = -Math.cos(ps.heading);
      const prz = Math.sin(ps.heading);
      tx = player.pos.x + ps.vx * predict + prx * side * 1.1;
      tz = player.pos.z + ps.vz * predict + prz * side * 1.1;
    } else {
      // 远程：沿自身前方赛道点追，横向与玩家同车道（收窄+衰减，避免被晃下草地）
      const lookAhead = 10 + Math.abs(st.forwardSpeed) * 0.5;
      const s = track.sampleAt(car.trackT + lookAhead / track.length);
      const latOff = clamp(player.lateral * 0.8, -(track.halfWidth - 2.5), track.halfWidth - 2.5);
      tx = s.pos.x + s.left.x * latOff;
      tz = s.pos.z + s.left.z * latOff;
    }

    const desired = Math.atan2(tx - st.x, tz - st.z);
    const diff = wrapAngle(desired - st.heading);
    const steer = clamp(-diff * 2.5, -1, 1);

    let throttle = 1;
    let brake = 0;
    // 贴身且明显比玩家快：收油，保持压迫而非冲过去
    if (dist < 8 && st.forwardSpeed > ps.forwardSpeed + 4) {
      throttle = 0;
      brake = 0.3;
    }

    car.speedMultiplier = capMult;
    if (st.forwardSpeed > car.tuning.maxSpeed * capMult) {
      throttle = 0;
      brake = Math.max(brake, 0.4);
    }

    return { throttle, brake, steer, handbrake: false, nitro: false };
  }
}
