import type { CarInput } from '../car/carPhysics';

const GAME_CODES = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyC', 'Escape', 'Enter',
  'ShiftLeft', 'ShiftRight', 'KeyN', 'KeyG', 'KeyM', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
]);

/** 键盘状态采集 + 按键事件分发 */
export class Input {
  private keys = new Set<string>();
  private handlers = new Map<string, (() => void)[]>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (GAME_CODES.has(e.code)) e.preventDefault();
      if (!e.repeat) this.emit(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  onPress(code: string, fn: () => void): void {
    const list = this.handlers.get(code) ?? [];
    list.push(fn);
    this.handlers.set(code, list);
  }

  private emit(code: string): void {
    for (const fn of this.handlers.get(code) ?? []) fn();
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  getCarInput(): CarInput {
    const throttle = this.down('KeyW', 'ArrowUp') ? 1 : 0;
    const brake = this.down('KeyS', 'ArrowDown') ? 1 : 0;
    const steer =
      (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    const handbrake = this.down('Space');
    const nitro = this.down('ShiftLeft', 'ShiftRight', 'KeyN');
    return { throttle, brake, steer, handbrake, nitro };
  }
}
