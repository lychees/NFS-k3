import { formatRaceTime } from '../utils/math';
import type { RacerStats } from '../race/raceManager';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

const cssColor = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

export interface ResultsOptions {
  sprint: boolean;
  newRecord: boolean;
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

  onMenuGarage(cb: () => void): void {
    el('menu-garage').addEventListener('click', cb);
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
    this.resultsHeadline.textContent =
      (playerPos === 1 ? 'VICTORY!' : `FINISH — P${playerPos}`) +
      (opts.newRecord ? ' · 新纪录!' : '');

    // 冲刺模式不显示圈速列
    this.resultsHeadRow.innerHTML = opts.sprint
      ? '<th>#</th><th>车手</th><th>总时间</th>'
      : '<th>#</th><th>车手</th><th>总时间</th><th>最佳圈</th>';

    this.resultsBody.innerHTML = '';
    ranked.forEach((s) => {
      const tr = document.createElement('tr');
      const isPlayer = stats.indexOf(s) === playerIndex;
      if (isPlayer) tr.classList.add('player-row');

      const total = s.finished
        ? formatRaceTime(s.finishTime)
        : `+${Math.max(0, Math.round(leaderProgress - s.progress))} m`;

      tr.innerHTML =
        `<td>${s.position}</td>` +
        `<td><span class="driver-swatch" style="background:${cssColor(s.car.color)}"></span>${s.car.name}</td>` +
        `<td>${total}</td>` +
        (opts.sprint ? '' : `<td>${formatRaceTime(s.bestLapTime)}</td>`);
      this.resultsBody.appendChild(tr);
    });

    this.resultsCredits.textContent =
      earnedCredits !== null ? `奖励 +${earnedCredits} CR · 余额 ${creditBalance} CR` : '';
    this.results.classList.remove('hidden');
  }

  hideResults(): void {
    this.results.classList.add('hidden');
  }
}
