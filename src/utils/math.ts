export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** 归一化到 [-PI, PI] */
export const wrapAngle = (a: number): number => {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
};

/** 归一化到 [0, 1) */
export const wrap01 = (t: number): number => ((t % 1) + 1) % 1;

/** 帧率无关的指数插值系数 */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

export const formatRaceTime = (sec: number | null): string => {
  if (sec === null || !Number.isFinite(sec)) return '--:--.--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const c = Math.floor((sec * 100) % 100);
  return `${m}:${s.toString().padStart(2, '0')}.${c.toString().padStart(2, '0')}`;
};
