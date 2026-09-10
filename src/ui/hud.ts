import { formatRaceTime } from '../utils/math';

const TEMPLATE = `
  <div class="hud-top-left">
    <div class="hud-position">4<span class="pos-total">/4</span></div>
    <div class="hud-lap">LAP 1/3</div>
    <div class="hud-grace hidden"></div>
  </div>
  <div class="hud-bottom-left">
    <div class="time-row"><span class="time-label label-current">本圈</span><span class="time-current">0:00.00</span></div>
    <div class="time-row"><span class="time-label label-last">上圈</span><span class="time-last">--:--.--</span></div>
    <div class="time-row best"><span class="time-label label-best">最佳</span><span class="time-best">--:--.--</span></div>
  </div>
  <div class="hud-bottom-right">
    <div class="hud-nitro">
      <div class="nitro-label">NITRO</div>
      <div class="nitro-bar"><div class="nitro-fill"></div></div>
    </div>
    <div class="hud-damage">
      <div class="damage-label">DAMAGE</div>
      <div class="damage-bar"><div class="damage-fill"></div></div>
      <div class="damage-critical hidden">CRITICAL!</div>
    </div>
    <div class="hud-speed">0</div>
    <div class="hud-speed-unit">km/h</div>
  </div>
  <div class="hud-center hidden"></div>
  <div class="hud-banner hidden"></div>
  <div class="hud-message hidden">⚠ 逆向行驶</div>
`;

export interface HudData {
  mode: 'circuit' | 'sprint' | 'knockout';
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
  // 淘汰赛
  carsLeft: number;
  /** 距下次淘汰的秒数 */
  elimCountdown: number;
  // 通用
  countdownText: string | null;
  showGo: boolean;
  wrongWay: boolean;
  /** 氮气余量 0..1 */
  nitroRatio: number;
  /** 损伤 0..1 与视觉档位 0-3 */
  damageRatio: number;
  damageTier: number;
}

/** DOM 覆盖层 HUD（可实例化多份：单人全屏 / 双人上下半屏各一份） */
export class Hud {
  private container: HTMLElement;
  private position: HTMLElement;
  private lap: HTMLElement;
  private grace: HTMLElement;
  private speed: HTMLElement;
  private labelCurrent: HTMLElement;
  private labelLast: HTMLElement;
  private labelBest: HTMLElement;
  private timeCurrent: HTMLElement;
  private timeLast: HTMLElement;
  private timeBest: HTMLElement;
  private center: HTMLElement;
  private banner: HTMLElement;
  private message: HTMLElement;
  private nitroFill: HTMLElement;
  private damageFill: HTMLElement;
  private damageCritical: HTMLElement;

  private lastSpeed = -1;
  private lastPos = '';
  private lastLap = '';
  private lastCenter = '';
  private lastNitro = -1;
  private lastMode = '';
  private lastDamage = -1;

  constructor(container: HTMLElement) {
    this.container = container;
    container.innerHTML = TEMPLATE;
    const q = (cls: string): HTMLElement => {
      const e = container.querySelector<HTMLElement>(`.${cls}`);
      if (!e) throw new Error(`.${cls} not found in hud template`);
      return e;
    };
    this.position = q('hud-position');
    this.lap = q('hud-lap');
    this.grace = q('hud-grace');
    this.speed = q('hud-speed');
    this.labelCurrent = q('label-current');
    this.labelLast = q('label-last');
    this.labelBest = q('label-best');
    this.timeCurrent = q('time-current');
    this.timeLast = q('time-last');
    this.timeBest = q('time-best');
    this.center = q('hud-center');
    this.banner = q('hud-banner');
    this.message = q('hud-message');
    this.nitroFill = q('nitro-fill');
    this.damageFill = q('damage-fill');
    this.damageCritical = q('damage-critical');
  }

  show(): void {
    this.container.classList.remove('hidden');
  }

  hide(): void {
    this.container.classList.add('hidden');
  }

  /** 双人宽限提示（"等待 P2 完赛： 28s"），null 隐藏 */
  setGrace(text: string | null): void {
    this.grace.classList.toggle('hidden', text === null);
    if (text !== null) this.grace.textContent = text;
  }

  /** 大字事件横幅（淘汰 / 决赛圈），由主循环控制展示时长 */
  showBanner(text: string): void {
    this.banner.textContent = text;
    this.banner.classList.remove('hidden');
    this.banner.classList.remove('pop');
    void this.banner.offsetWidth; // 重启动画
    this.banner.classList.add('pop');
  }

  hideBanner(): void {
    this.banner.classList.add('hidden');
  }

  update(d: HudData): void {
    if (d.mode !== this.lastMode) {
      this.lastMode = d.mode;
      this.labelCurrent.textContent = d.mode === 'circuit' ? '本圈' : '用时';
      this.labelLast.textContent =
        d.mode === 'sprint' ? '里程' : d.mode === 'knockout' ? '淘汰' : '上圈';
      this.labelBest.textContent = d.mode === 'sprint' ? '纪录' : d.mode === 'knockout' ? '—' : '最佳';
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
        : d.mode === 'knockout'
          ? `CARS LEFT: ${d.carsLeft}`
          : `LAP ${Math.min(d.lap + 1, d.totalLaps)}/${d.totalLaps}`;
    if (lapText !== this.lastLap) {
      this.lastLap = lapText;
      this.lap.textContent = lapText;
    }

    this.timeCurrent.textContent = formatRaceTime(d.currentLapTime);
    this.timeLast.textContent =
      d.mode === 'sprint'
        ? `${d.sprintKm.toFixed(2)} km`
        : d.mode === 'knockout'
          ? `${Math.ceil(d.elimCountdown)}s`
          : formatRaceTime(d.lastLapTime);
    this.timeBest.textContent =
      d.mode === 'sprint' ? formatRaceTime(d.sprintRecord) : d.mode === 'knockout' ? '—' : formatRaceTime(d.bestLapTime);

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

    const dmgPct = Math.round(d.damageRatio * 100);
    if (dmgPct !== this.lastDamage) {
      this.lastDamage = dmgPct;
      this.damageFill.style.width = `${dmgPct}%`;
      this.damageFill.classList.toggle('warn', d.damageTier === 2);
      this.damageFill.classList.toggle('crit', d.damageTier >= 3);
      this.damageCritical.classList.toggle('hidden', d.damageTier < 3);
    }
  }
}
