/** 氮气速度线：DOM 全屏 canvas，静态放射线条 + CSS 脉冲动画 */
export class SpeedLines {
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.draw();
    window.addEventListener('resize', () => this.draw());
  }

  private draw(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.hypot(cx, cy);

    for (let i = 0; i < 110; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = maxR * (0.3 + Math.random() * 0.25);
      const r1 = maxR * (0.65 + Math.random() * 0.35);
      const grad = ctx.createLinearGradient(
        cx + Math.cos(a) * r0, cy + Math.sin(a) * r0,
        cx + Math.cos(a) * r1, cy + Math.sin(a) * r1,
      );
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, `rgba(255,255,255,${0.25 + Math.random() * 0.45})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.stroke();
    }
  }

  setActive(active: boolean): void {
    this.canvas.classList.toggle('active', active);
  }
}
