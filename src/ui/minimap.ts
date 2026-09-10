import type { Track } from '../track/track';

export interface MinimapCar {
  x: number;
  z: number;
  color: string;
  isPlayer: boolean;
}

/** Canvas 2D 小地图：赛道轮廓离线渲染，每帧只画车辆位置点 */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement;
  private project: (x: number, z: number) => [number, number];

  constructor(canvas: HTMLCanvasElement, track: Track) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('minimap 2d context unavailable');
    this.ctx = ctx;
    const size = canvas.width;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of track.samples) {
      minX = Math.min(minX, s.pos.x);
      maxX = Math.max(maxX, s.pos.x);
      minZ = Math.min(minZ, s.pos.z);
      maxZ = Math.max(maxZ, s.pos.z);
    }
    const margin = 14;
    const scale = Math.min(
      (size - margin * 2) / (maxX - minX),
      (size - margin * 2) / (maxZ - minZ),
    );
    const offX = (size - (maxX - minX) * scale) / 2;
    const offY = (size - (maxZ - minZ) * scale) / 2;
    this.project = (x, z) => [offX + (x - minX) * scale, offY + (z - minZ) * scale];

    this.bg = document.createElement('canvas');
    this.bg.width = size;
    this.bg.height = size;
    const bctx = this.bg.getContext('2d')!;
    bctx.lineJoin = 'round';
    bctx.lineCap = 'round';
    bctx.strokeStyle = 'rgba(255,255,255,0.9)';
    bctx.lineWidth = 4;
    bctx.beginPath();
    track.samples.forEach((s, i) => {
      const [px, py] = this.project(s.pos.x, s.pos.z);
      if (i === 0) bctx.moveTo(px, py);
      else bctx.lineTo(px, py);
    });
    bctx.closePath();
    bctx.stroke();

    // 起点标记
    const [sx, sy] = this.project(track.samples[0].pos.x, track.samples[0].pos.z);
    bctx.fillStyle = '#ffd320';
    bctx.fillRect(sx - 4, sy - 4, 8, 8);
  }

  update(cars: MinimapCar[]): void {
    const size = this.ctx.canvas.width;
    this.ctx.clearRect(0, 0, size, size);
    this.ctx.drawImage(this.bg, 0, 0);
    for (const c of cars) {
      const [px, py] = this.project(c.x, c.z);
      this.ctx.beginPath();
      this.ctx.arc(px, py, c.isPlayer ? 5 : 4, 0, Math.PI * 2);
      this.ctx.fillStyle = c.color;
      this.ctx.fill();
      if (c.isPlayer) {
        this.ctx.lineWidth = 2;
        this.ctx.strokeStyle = '#000';
        this.ctx.stroke();
      }
    }
  }
}
