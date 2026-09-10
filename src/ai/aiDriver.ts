import { clamp, wrapAngle } from '../utils/math';
import type { Car } from '../car/car';
import type { CarInput } from '../car/carPhysics';
import type { Track } from '../track/track';

/**
 * AI 车手：沿样条前方预瞄点行驶，带横向游走与速度噪声；
 * 橡皮筋机制 —— 领先玩家时收速、落后时提速。
 */
export class AIDriver {
  private phase: number;
  private baseOffset: number;
  private skill: number;
  private time = 0;

  constructor(seed: number) {
    this.phase = seed * 2.399;
    this.baseOffset = ((seed * 37) % 5) - 2; // -2..2
    this.skill = 0.95 + ((seed * 53) % 7) * 0.014; // 0.95..1.03
  }

  computeInput(car: Car, track: Track, playerProgress: number, aiProgress: number, dt: number): CarInput {
    this.time += dt;
    const st = car.state;

    // 预瞄点：速度越快看得越远，附带宽慢变化的横向偏移
    const lookAhead = 10 + Math.abs(st.forwardSpeed) * 0.5;
    const target = track.sampleAt(car.trackT + lookAhead / track.length);
    const hw = track.halfWidth;
    const wobble =
      this.baseOffset +
      Math.sin(this.time * 0.45 + this.phase) * 1.8 +
      Math.sin(car.trackT * Math.PI * 10 + this.phase) * 1.2;
    const latOffset = clamp(wobble, -hw + 1.6, hw - 1.6);
    const tx = target.pos.x + target.left.x * latOffset;
    const tz = target.pos.z + target.left.z * latOffset;

    // 期望航向 -> 转向量（steer>0 = 右转 = heading 减小，故取负）
    const desired = Math.atan2(tx - st.x, tz - st.z);
    const diff = wrapAngle(desired - st.heading);
    const steer = clamp(-diff * 2.2, -1, 1);

    // 前方曲率制动：弯越急、车速越高，刹车越重
    const h1 = track.sampleAt(car.trackT + 20 / track.length).tangent;
    const h2 = track.sampleAt(car.trackT + 45 / track.length).tangent;
    const bend = Math.abs(wrapAngle(Math.atan2(h2.x, h2.z) - Math.atan2(h1.x, h1.z)));
    let brake = 0;
    let throttle = 1;
    if (bend > 0.1 && st.forwardSpeed > 26) {
      brake = clamp((bend - 0.1) * 4, 0, 0.9);
      throttle = 0;
    }

    // 橡皮筋 + 个人速度噪声
    const diff2 = aiProgress - playerProgress;
    const capMult = clamp(1 - diff2 / 600, 0.85, 1.15);
    const skillNow = this.skill * (1 + 0.03 * Math.sin(this.time * 0.7 + this.phase * 3));
    car.speedMultiplier = skillNow * capMult;
    if (st.forwardSpeed > car.tuning.maxSpeed * car.speedMultiplier) {
      throttle = 0;
      brake = Math.max(brake, 0.35);
    }

    // 卡死自救（几乎不会触发，防 bug 卡弯）
    if (Math.abs(st.forwardSpeed) < 0.5 && throttle === 0 && brake > 0.8) {
      brake = 0;
      throttle = 1;
    }

    // 已完赛：放松巡航，避免在终点线前抖动（冲刺道终点钳制预瞄点）
    if (aiProgress >= track.length) {
      throttle = Math.min(throttle, 0.15);
      brake = 0;
    }

    return { throttle, brake, steer, handbrake: false, nitro: false };
  }
}
