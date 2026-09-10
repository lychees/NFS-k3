import { formatRaceTime } from '../utils/math';
import type { RacerStats } from '../race/raceManager';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

const cssColor = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

/** 全屏界面：开始菜单 / 暂停 / 结算 */
export class Screens {
  private menu = el('screen-menu');
  private pause = el('screen-pause');
  private results = el('screen-results');
  private resultsHeadline = el('results-headline');
  private resultsBody = el('results-body');
  private resultsCredits = el('results-credits');

  onMenuRace(cb: () => void): void {
    el('menu-race').addEventListener('click', cb);
  }

  onMenuGarage(cb: () => void): void {
    el('menu-garage').addEventListener('click', cb);
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
  ): void {
    const ranked = [...stats].sort((a, b) => a.position - b.position);
    const leaderProgress = ranked[0].progress;
    const playerPos = stats[playerIndex].position;
    this.resultsHeadline.textContent =
      playerPos === 1 ? 'VICTORY!' : `FINISH — P${playerPos}`;

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
        `<td>${formatRaceTime(s.bestLapTime)}</td>`;
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
