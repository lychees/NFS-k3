import { CHECKPOINT_COUNT, TOTAL_LAPS } from '../track/trackData';
import { wrap01 } from '../utils/math';
import type { Car } from '../car/car';
import type { Track } from '../track/track';

export type RaceState = 'menu' | 'countdown' | 'racing' | 'paused' | 'finished';

export interface RacerStats {
  car: Car;
  /** 沿赛道的累计里程（米，起点前为负）—— 圈数/检查点/名次的统一依据 */
  progress: number;
  lastT: number;
  lap: number; // 已完成圈数
  checkpoint: number; // 本圈已过检查点数
  lapStartTime: number;
  lastLapTime: number | null;
  bestLapTime: number | null;
  finished: boolean;
  finishTime: number | null;
  position: number;
}

const GRID_SLOTS = [
  { dist: -10, lat: 2.4 },
  { dist: -17, lat: -2.4 },
  { dist: -24, lat: 2.4 },
  { dist: -31, lat: -2.4 },
];

const COUNTDOWN_SECONDS = 3;

/** 比赛流程：倒计时 -> 竞速 -> 结算；圈数 / 检查点 / 名次判定 */
export class RaceManager {
  state: RaceState = 'menu';
  private stateBeforePause: RaceState = 'menu';

  raceTime = 0;
  countdownLeft = COUNTDOWN_SECONDS;

  readonly cars: Car[];
  readonly playerIndex: number;
  stats: RacerStats[] = [];

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
    // 玩家排最后一位发车，经典街机设定
    const order = this.cars.map((_, i) => i).sort((a, b) =>
      a === this.playerIndex ? 1 : b === this.playerIndex ? -1 : a - b,
    );
    order.forEach((carIdx, slot) => {
      const g = GRID_SLOTS[slot];
      this.cars[carIdx].reset(track, g.dist, g.lat);
    });

    this.stats = this.cars.map((car, i) => ({
      car,
      progress: GRID_SLOTS[order.indexOf(i)].dist,
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
    if (this.state !== 'racing') return;

    this.raceTime += dt;

    for (const s of this.stats) {
      // 累计里程：t 差分回绕到 [-0.5, 0.5]，跳跃过大视为异常丢弃
      let d = wrap01(s.car.trackT) - wrap01(s.lastT);
      if (d > 0.5) d -= 1;
      if (d < -0.5) d += 1;
      const dm = d * track.length;
      if (Math.abs(dm) < 40) s.progress += dm;
      s.lastT = wrap01(s.car.trackT);

      if (s.progress > 0) {
        const lapDist = track.length;
        s.checkpoint = Math.min(
          CHECKPOINT_COUNT,
          Math.floor((s.progress % lapDist) / (lapDist / CHECKPOINT_COUNT)),
        );
        const lapsDone = Math.floor(s.progress / lapDist);
        if (lapsDone > s.lap) {
          const lapTime = this.raceTime - s.lapStartTime;
          s.lapStartTime = this.raceTime;
          s.lastLapTime = lapTime;
          if (s.bestLapTime === null || lapTime < s.bestLapTime) s.bestLapTime = lapTime;
          s.lap = lapsDone;
          if (s.lap >= TOTAL_LAPS && !s.finished) {
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
