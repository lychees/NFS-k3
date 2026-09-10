import { formatRaceTime } from '../utils/math';
import type { RacerStats } from '../race/raceManager';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

const cssColor = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

export interface ResultsOptions {
  mode: 'circuit' | 'sprint' | 'knockout' | 'hotpursuit';
  newRecord: boolean;
  /** HOT PURSUIT：被逮捕 */
  busted?: boolean;
  /** 双人：P1/P2 最终名次（触发对比标题） */
  twoPlayer?: boolean;
  p1Pos?: number;
  p2Pos?: number;
}

/** 全屏界面：开始菜单（模式选择）/ 暂停 / 结算 */
export class Screens {
  private menu = el('screen-menu');
  private pause = el('screen-pause');
  private results = el('screen-results');
  private resultsHeadline = el('results-headline');
  private resultsHeadRow = el('results-head-row');
  private resultsBody = el('results-body');
  private resultsCredits = el('results-credits');

  onMenuRace(cb: () => void): void {
    el('menu-race').addEventListener('click', cb);
  }

  onMenuSprint(cb: () => void): void {
    el('menu-sprint').addEventListener('click', cb);
  }

  onMenuKnockout(cb: () => void): void {
    el('menu-knockout').addEventListener('click', cb);
  }

  onMenuHotPursuit(cb: () => void): void {
    el('menu-hotpursuit').addEventListener('click', cb);
  }

  onMenu2P(cb: () => void): void {
    el('menu-2p').addEventListener('click', cb);
  }

  /** 双人子菜单（赛道选择）显隐；返回 true 表示当前处于子菜单 */
  show2PSub(show: boolean): void {
    el('menu-actions-main').classList.toggle('hidden', show);
    el('menu-2p-sub').classList.toggle('hidden', !show);
  }

  get in2PSub(): boolean {
    return !el('menu-2p-sub').classList.contains('hidden');
  }

  onMenu2PCircuit(cb: () => void): void {
    el('menu-2p-circuit').addEventListener('click', cb);
  }

  onMenu2PSprint(cb: () => void): void {
    el('menu-2p-sprint').addEventListener('click', cb);
  }

  onMenu2PBack(cb: () => void): void {
    el('menu-2p-back').addEventListener('click', cb);
  }

  onMenuGarage(cb: () => void): void {
    el('menu-garage').addEventListener('click', cb);
  }

  onReplay(cb: () => void): void {
    el('results-replay').addEventListener('click', cb);
  }

  /** 结算界面是否显示回放按钮（双人/无录像时隐藏） */
  setReplayAvailable(available: boolean): void {
    el('results-replay').classList.toggle('hidden', !available);
  }

  /** 菜单模式项上的最佳成绩标签 */
  updateRecords(records: { circuit: number | null; sprint: number | null }): void {
    el('record-circuit').textContent = records.circuit
      ? `最佳 ${formatRaceTime(records.circuit)}`
      : '暂无纪录';
    el('record-sprint').textContent = records.sprint
      ? `最佳 ${formatRaceTime(records.sprint)}`
      : '暂无纪录';
  }

  showMenu(): void {
    this.menu.classList.remove('hidden');
    this.pause.classList.add('hidden');
    this.results.classList.add('hidden');
  }

  hideMenu(): void {
    this.menu.classList.add('hidden');
  }

  showPause(visible: boolean): void {
    this.pause.classList.toggle('hidden', !visible);
  }

  showResults(
    stats: RacerStats[],
    playerIndex: number,
    earnedCredits: number | null,
    creditBalance: number,
    opts: ResultsOptions,
  ): void {
    const ranked = [...stats].sort((a, b) => a.position - b.position);
    const leaderProgress = ranked[0].progress;
    const playerPos = stats[playerIndex].position;
    const ord = (p: number): string => `${p}${['st', 'nd', 'rd', 'th'][Math.min(p, 4) - 1]}`;
    const headline = opts.twoPlayer
      ? `P1 ${ord(opts.p1Pos ?? 1)} — P2 ${ord(opts.p2Pos ?? 1)}`
      : opts.mode === 'knockout'
        ? playerPos === 1
          ? 'VICTORY!'
          : `ELIMINATED — 第 ${playerPos} 名`
        : opts.mode === 'hotpursuit'
          ? opts.busted
            ? 'BUSTED'
            : `ESCAPED — ${playerPos === 1 ? '1st!' : `P${playerPos}`}`
          : playerPos === 1
            ? 'VICTORY!'
            : `FINISH — P${playerPos}`;
    this.resultsHeadline.textContent = headline + (opts.newRecord ? ' · 新纪录!' : '');

    // 冲刺/追逐不显示圈速列；淘汰赛显示状态列
    this.resultsHeadRow.innerHTML =
      opts.mode === 'knockout'
        ? '<th>#</th><th>车手</th><th>状态</th>'
        : opts.mode === 'sprint' || opts.mode === 'hotpursuit'
          ? '<th>#</th><th>车手</th><th>总时间</th>'
          : '<th>#</th><th>车手</th><th>总时间</th><th>最佳圈</th>';

    this.resultsBody.innerHTML = '';
    ranked.forEach((s) => {
      const tr = document.createElement('tr');
      const statIdx = stats.indexOf(s);
      const isPlayer = opts.twoPlayer ? statIdx <= 1 : statIdx === playerIndex;
      if (isPlayer) tr.classList.add('player-row');

      let thirdCol: string;
      if (opts.mode === 'knockout') {
        thirdCol = s.eliminated
          ? `淘汰 @ ${formatRaceTime(s.elimTime)}`
          : s.finished
            ? `冠军 ${formatRaceTime(s.finishTime)}`
            : '幸存';
      } else {
        thirdCol = s.finished
          ? formatRaceTime(s.finishTime)
          : `+${Math.max(0, Math.round(leaderProgress - s.progress))} m`;
      }

      tr.innerHTML =
        `<td>${s.position}</td>` +
        `<td><span class="driver-swatch" style="background:${cssColor(s.car.color)}"></span>${s.car.name}</td>` +
        `<td>${thirdCol}</td>` +
        (opts.mode === 'circuit' ? `<td>${formatRaceTime(s.bestLapTime)}</td>` : '');
      this.resultsBody.appendChild(tr);
    });

    this.resultsCredits.textContent = opts.twoPlayer
      ? '友谊赛 · 不计积分'
      : earnedCredits !== null
        ? `奖励 +${earnedCredits} CR · 余额 ${creditBalance} CR`
        : '';
    this.results.classList.remove('hidden');
  }

  hideResults(): void {
    this.results.classList.add('hidden');
  }
}
