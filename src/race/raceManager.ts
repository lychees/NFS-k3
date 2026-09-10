import { GRID_SLOTS, SPRINT_GRID_SLOTS, type TrackDef } from '../track/trackData';
import { wrap01 } from '../utils/math';
import type { Car } from '../car/car';
import type { CarInput } from '../car/carPhysics';
import type { Track } from '../track/track';

export type RaceState = 'menu' | 'countdown' | 'racing' | 'paused' | 'finished';

export interface RacerStats {
  car: Car;
  /** 沿赛道的累计里程（米）—— 环道起点前为负；冲刺道从发车格起算 */
  progress: number;
  lastT: number;
  lap: number; // 已完成圈数（冲刺道恒 0，冲线后置 1）
  checkpoint: number;
  lapStartTime: number;
  lastLapTime: number | null;
  bestLapTime: number | null;
  finished: boolean;
  finishTime: number | null;
  position: number;
  // 淘汰赛
  eliminated: boolean;
  elimTime: number | null;
  /** 被淘汰时的名次（= 当时剩余车数） */
  elimPosition: number | null;
  /** 被淘汰且已停稳（主循环置位） */
  parked: boolean;
}

export interface ElimEvent {
  name: string;
  isPlayer: boolean;
  position: number;
}

const COUNTDOWN_SECONDS = 3;
const ELIM_INTERVAL = 20; // 淘汰间隔（秒）

/** 被淘汰车辆靠边停车的输入（纯函数，可测） */
export function parkingInput(car: Car): CarInput {
  // lateral 左正右负：向左半边路的车继续向左靠，反之向右
  return {
    throttle: 0,
    brake: 1,
    steer: car.lateral > 0 ? -0.8 : 0.8,
    handbrake: false,
    nitro: false,
  };
}

/** 比赛流程：倒计时 -> 竞速 -> 结算；环道计圈 / 冲刺计里程 / 淘汰赛定时淘汰 */
export class RaceManager {
  state: RaceState = 'menu';
  private stateBeforePause: RaceState = 'menu';

  raceTime = 0;
  countdownLeft = COUNTDOWN_SECONDS;

  readonly cars: Car[];
  readonly playerIndex: number;
  stats: RacerStats[] = [];

  def: TrackDef | null = null;
  /** 冲刺道：无圈数，进度达标即完赛 */
  sprint = false;
  finishDist = 0;

  /** 淘汰赛：每 ELIM_INTERVAL 秒淘汰里程最低者 */
  knockout = false;
  elimTimer = ELIM_INTERVAL;
  /** 淘汰事件队列，主循环消费后清空 */
  elimEvents: ElimEvent[] = [];

  constructor(cars: Car[], playerIndex: number) {
    this.cars = cars;
    this.playerIndex = playerIndex;
  }

  /** 人类玩家在 stats 中的下标（双人时为 [0, 1]） */
  humanIdx: number[] = [0];
  /** 双人宽限：一方完赛后另一方剩余秒数，null = 未触发 */
  graceLeft: number | null = null;

  get player(): RacerStats {
    return this.stats[this.humanIdx[0] ?? this.playerIndex];
  }

  get carsLeft(): number {
    return this.stats.filter((s) => !s.eliminated).length;
  }

  /** 剩 2 车进入决赛圈 */
  get finalDuel(): boolean {
    return this.knockout && this.state === 'racing' && this.carsLeft === 2;
  }

  get countdownText(): string | null {
    if (this.state !== 'countdown') return null;
    return String(Math.max(1, Math.ceil(this.countdownLeft)));
  }

  get showGo(): boolean {
    return this.state === 'racing' && this.raceTime < 0.9;
  }

  startRace(
    track: Track,
    opts?: { knockout?: boolean; participants?: Car[]; humans?: number[] },
  ): void {
    const def = track.def;
    this.def = def;
    this.sprint = !def.closed;
    this.knockout = opts?.knockout ?? false;
    this.finishDist = track.length - def.startOffset;
    this.elimTimer = ELIM_INTERVAL;
    this.elimEvents = [];
    this.graceLeft = null;
    const field = opts?.participants ?? this.cars;
    this.humanIdx = opts?.humans ?? [this.playerIndex];
    const slots = this.sprint ? SPRINT_GRID_SLOTS : GRID_SLOTS;

    // 人类玩家排最后发车，经典街机设定
    const order = field
      .map((_, i) => i)
      .sort((a, b) => {
        const ah = this.humanIdx.includes(a) ? 1 : 0;
        const bh = this.humanIdx.includes(b) ? 1 : 0;
        return ah - bh || a - b;
      });
    order.forEach((carIdx, slot) => {
      const g = slots[slot];
      field[carIdx].reset(track, g.dist, g.lat);
    });

    this.stats = field.map((car, i) => ({
      car,
      progress: slots[order.indexOf(i)].dist - def.startOffset,
      lastT: car.trackT,
      lap: 0,
      checkpoint: 0,
      lapStartTime: 0,
      lastLapTime: null,
      bestLapTime: null,
      finished: false,
      finishTime: null,
      position: i + 1,
      eliminated: false,
      elimTime: null,
      elimPosition: null,
      parked: false,
    }));

    this.raceTime = 0;
    this.countdownLeft = COUNTDOWN_SECONDS;
    this.state = 'countdown';
  }

  pause(): void {
    if (this.state !== 'racing' && this.state !== 'countdown') return;
    this.stateBeforePause = this.state;
    this.state = 'paused';
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = this.stateBeforePause === 'paused' ? 'racing' : this.stateBeforePause;
  }

  toMenu(): void {
    this.state = 'menu';
  }

  /** 外部事件强制结束比赛（HOT PURSUIT 逮捕） */
  forceFinish(): void {
    if (this.state !== 'racing') return;
    this.player.finished = true;
    this.player.finishTime = this.raceTime;
    this.state = 'finished';
  }

  /** countdown / racing 状态下每帧调用 */
  update(dt: number, track: Track): void {
    if (this.state === 'countdown') {
      this.countdownLeft -= dt;
      if (this.countdownLeft <= 0) {
        this.state = 'racing';
        this.raceTime = 0;
        for (const s of this.stats) s.lapStartTime = 0;
      }
      return;
    }
    if (this.state !== 'racing' || !this.def) return;
    const def = this.def;

    this.raceTime += dt;

    for (const s of this.stats) {
      // 累计里程：环道 t 差分回绕，冲刺道单调递增；跳跃过大视为异常丢弃
      const tNow = this.sprint ? s.car.trackT : wrap01(s.car.trackT);
      let d = this.sprint ? tNow - s.lastT : tNow - wrap01(s.lastT);
      if (!this.sprint) {
        if (d > 0.5) d -= 1;
        if (d < -0.5) d += 1;
      }
      const dm = d * track.length;
      if (Math.abs(dm) < 40) s.progress += dm;
      s.lastT = tNow;

      if (s.progress <= 0) continue;

      if (this.sprint) {
        s.checkpoint = Math.min(
          def.checkpoints,
          Math.floor(s.progress / (this.finishDist / def.checkpoints)),
        );
        if (!s.finished && s.progress >= this.finishDist) {
          s.finished = true;
          s.finishTime = this.raceTime;
          s.lap = 1;
        }
      } else {
        const lapDist = track.length;
        s.checkpoint = Math.min(
          def.checkpoints,
          Math.floor((s.progress % lapDist) / (lapDist / def.checkpoints)),
        );
        const lapsDone = Math.floor(s.progress / lapDist);
        if (lapsDone > s.lap) {
          const lapTime = this.raceTime - s.lapStartTime;
          s.lapStartTime = this.raceTime;
          s.lastLapTime = lapTime;
          if (s.bestLapTime === null || lapTime < s.bestLapTime) s.bestLapTime = lapTime;
          s.lap = lapsDone;
          // 淘汰赛不按圈数完赛
          if (!this.knockout && s.lap >= def.laps && !s.finished) {
            s.finished = true;
            s.finishTime = this.raceTime;
          }
        }
      }
    }

    // 名次：圈数 -> 检查点 -> 距下一检查点（等价于按累计里程排序）
    const ranked = [...this.stats].sort((a, b) => b.progress - a.progress);
    ranked.forEach((s, i) => {
      s.position = i + 1;
    });

    if (this.knockout) {
      this.elimTimer -= dt;
      if (this.elimTimer <= 0) {
        this.elimTimer += ELIM_INTERVAL;
        this.eliminateLast();
      }
    }

    // 比赛结束：单人冲线即止；双人等双方都完赛，或一方完赛后 30s 宽限
    if (this.humanIdx.length > 1) {
      const humans = this.humanIdx.map((i) => this.stats[i]);
      if (humans.every((s) => s.finished)) {
        this.state = 'finished';
      } else if (humans.some((s) => s.finished)) {
        if (this.graceLeft === null) this.graceLeft = 30;
        this.graceLeft -= dt;
        if (this.graceLeft <= 0) this.state = 'finished';
      }
    } else if (this.player.finished) {
      this.state = 'finished';
    }
  }

  /** 淘汰当前里程最低的未淘汰者；玩家被淘汰或成为最后幸存者时结束比赛 */
  private eliminateLast(): void {
    const alive = this.stats.filter((s) => !s.eliminated);
    if (alive.length <= 1) return;
    const last = alive.reduce((a, b) => (a.progress <= b.progress ? a : b));
    last.eliminated = true;
    last.elimTime = this.raceTime;
    last.elimPosition = alive.length;
    this.elimEvents.push({ name: last.car.name, isPlayer: last === this.player, position: alive.length });

    if (last === this.player) {
      // 玩家被淘汰：最终名次 = 淘汰时剩余数，幸存者按里程补位
      this.player.position = alive.length;
      const rest = alive.filter((s) => s !== last).sort((a, b) => b.progress - a.progress);
      rest.forEach((s, i) => {
        s.position = i + 1;
      });
      this.player.finished = true;
      this.player.finishTime = this.raceTime;
    } else if (alive.length === 2) {
      // 淘汰后只剩玩家：玩家即冠军
      this.player.position = 1;
      this.player.finished = true;
      this.player.finishTime = this.raceTime;
    }
  }
}
