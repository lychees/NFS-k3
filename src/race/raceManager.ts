import { GRID_SLOTS, SPRINT_GRID_SLOTS, type TrackDef } from '../track/trackData';
import { wrap01 } from '../utils/math';
import type { Car } from '../car/car';
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
}

const COUNTDOWN_SECONDS = 3;

/** 比赛流程：倒计时 -> 竞速 -> 结算；环道计圈 / 冲刺计里程，名次按进度排序 */
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

  constructor(cars: Car[], playerIndex: number) {
    this.cars = cars;
    this.playerIndex = playerIndex;
  }

  get player(): RacerStats {
    return this.stats[this.playerIndex];
  }

  get countdownText(): string | null {
    if (this.state !== 'countdown') return null;
    return String(Math.max(1, Math.ceil(this.countdownLeft)));
  }

  get showGo(): boolean {
    return this.state === 'racing' && this.raceTime < 0.9;
  }

  startRace(track: Track): void {
    const def = track.def;
    this.def = def;
    this.sprint = !def.closed;
    this.finishDist = track.length - def.startOffset;
    const slots = this.sprint ? SPRINT_GRID_SLOTS : GRID_SLOTS;

    // 玩家排最后一位发车，经典街机设定
    const order = this.cars.map((_, i) => i).sort((a, b) =>
      a === this.playerIndex ? 1 : b === this.playerIndex ? -1 : a - b,
    );
    order.forEach((carIdx, slot) => {
      const g = slots[slot];
      this.cars[carIdx].reset(track, g.dist, g.lat);
    });

    this.stats = this.cars.map((car, i) => ({
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
          if (s.lap >= def.laps && !s.finished) {
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

    if (this.player.finished) this.state = 'finished';
  }
}
