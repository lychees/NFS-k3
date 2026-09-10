import { formatRaceTime } from '../utils/math';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

export interface HudData {
  mode: 'circuit' | 'sprint';
  speedKmh: number;
  position: number;
  totalCars: number;
  // 环道
  lap: number; // 已完成圈数
  totalLaps: number;
  currentLapTime: number;
  lastLapTime: number | null;
  bestLapTime: number | null;
  // 冲刺
  sprintPct: number; // 0..100
  sprintKm: number;
  sprintRecord: number | null;
  // 通用
  countdownText: string | null;
  showGo: boolean;
  wrongWay: boolean;
  /** 氮气余量 0..1 */
  nitroRatio: number;
}

/** DOM 覆盖层 HUD：速度、圈数/进度、名次、圈速/用时、氮气、倒计时 */
export class Hud {
  private root = el('hud');
  private position = el('hud-position');
  private lap = el('hud-lap');
  private speed = el('hud-speed');
  private labelCurrent = el('label-current');
  private labelLast = el('label-last');
  private labelBest = el('label-best');
  private timeCurrent = el('time-current');
  private timeLast = el('time-last');
  private timeBest = el('time-best');
  private center = el('hud-center');
  private message = el('hud-message');
  private nitroFill = el('nitro-fill');
  private muted = el('hud-muted');

  private lastSpeed = -1;
  private lastPos = '';
  private lastLap = '';
  private lastCenter = '';
  private lastNitro = -1;
  private lastMode = '';

  show(): void {
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  setMuted(m: boolean): void {
    this.muted.classList.toggle('hidden', !m);
  }

  update(d: HudData): void {
    if (d.mode !== this.lastMode) {
      this.lastMode = d.mode;
      const sprint = d.mode === 'sprint';
      this.labelCurrent.textContent = sprint ? '用时' : '本圈';
      this.labelLast.textContent = sprint ? '里程' : '上圈';
      this.labelBest.textContent = sprint ? '纪录' : '最佳';
      this.lastLap = '';
    }

    const spd = Math.round(d.speedKmh);
    if (spd !== this.lastSpeed) {
      this.lastSpeed = spd;
      this.speed.textContent = String(spd);
    }

    const posText = `${d.position}`;
    if (posText !== this.lastPos) {
      this.lastPos = posText;
      this.position.innerHTML = `${d.position}<span class="pos-total">/${d.totalCars}</span>`;
    }

    const lapText =
      d.mode === 'sprint'
        ? `SPRINT ${Math.min(100, Math.round(d.sprintPct))}%`
        : `LAP ${Math.min(d.lap + 1, d.totalLaps)}/${d.totalLaps}`;
    if (lapText !== this.lastLap) {
      this.lastLap = lapText;
      this.lap.textContent = lapText;
    }

    this.timeCurrent.textContent = formatRaceTime(d.currentLapTime);
    this.timeLast.textContent =
      d.mode === 'sprint' ? `${d.sprintKm.toFixed(2)} km` : formatRaceTime(d.lastLapTime);
    this.timeBest.textContent =
      d.mode === 'sprint' ? formatRaceTime(d.sprintRecord) : formatRaceTime(d.bestLapTime);

    const centerText = d.countdownText ?? (d.showGo ? 'GO!' : '');
    if (centerText !== this.lastCenter) {
      this.lastCenter = centerText;
      if (centerText === '') {
        this.center.classList.add('hidden');
      } else {
        this.center.classList.remove('hidden');
        this.center.textContent = centerText;
        this.center.classList.toggle('go', centerText === 'GO!');
      }
    }

    this.message.classList.toggle('hidden', !d.wrongWay);

    const nitroPct = Math.round(d.nitroRatio * 100);
    if (nitroPct !== this.lastNitro) {
      this.lastNitro = nitroPct;
      this.nitroFill.style.width = `${nitroPct}%`;
      this.nitroFill.classList.toggle('low', nitroPct < 25);
    }
  }
}
