import * as THREE from 'three';
import type { LiveryConfig } from '../garage/save';
import type { CarMetrics } from './carModel';

/**
 * 涂装贴片（decal）：透明 CanvasTexture 平面略浮于车身表面。
 * ExtrudeGeometry 的 UV 不适合拉花，贴片方案稳妥且清晰。
 * 贴片只挂在车身上，不影响玻璃 / 尾灯 / 轮毂。
 */

const HOOD_TILT = Math.atan2(0.3, 2.42); // 引擎盖坡度

type Ctx = CanvasRenderingContext2D;

function makeTexture(w: number, h: number, draw: (ctx: Ctx, w: number, h: number) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function decalMaterial(tex: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    roughness: 0.35,
    metalness: 0.5,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    depthWrite: false,
  });
}

function makeDecal(
  tex: THREE.Texture,
  w: number,
  h: number,
  pos: [number, number, number],
  rot: { x?: number; y?: number },
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), decalMaterial(tex));
  mesh.position.set(...pos);
  if (rot.x !== undefined) mesh.rotation.x = rot.x;
  if (rot.y !== undefined) mesh.rotation.y = rot.y;
  mesh.renderOrder = 2;
  return mesh;
}

/** 引擎盖贴片（canvas 顶边 = 车尾方向） */
function hoodDecal(tex: THREE.Texture, m: CarMetrics): THREE.Mesh {
  return makeDecal(tex, 1.5, 2.0, [0, m.hoodY - 0.015, m.frontZ * 0.48], { x: -Math.PI / 2 + HOOD_TILT });
}

/** 车顶贴片 */
function roofDecal(tex: THREE.Texture, m: CarMetrics): THREE.Mesh {
  return makeDecal(tex, 1.3, 1.0, [0, m.roofY + 0.006, m.rearZ * 0.34], { x: -Math.PI / 2 + 0.02 });
}

/** 车身侧面贴片；flip 用于有方向性的图案（火焰）在左侧镜像 */
function sideDecal(tex: THREE.Texture, side: 1 | -1, flip: boolean, m: CarMetrics): THREE.Mesh {
  let t = tex;
  if (flip) {
    t = tex.clone();
    t.repeat.x = -1;
    t.offset.x = 1;
    t.needsUpdate = true;
  }
  return makeDecal(t, 4.2, 0.5, [side * (m.halfWidth + 0.003), m.roofY * 0.458, 0], { y: (side * Math.PI) / 2 });
}

// ---------- 各涂装纹理（canvas 顶边 = 车后，左边 = 车头对于侧面） ----------

const css = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

function stripesTex(accent: number): THREE.CanvasTexture {
  return makeTexture(256, 512, (ctx, w, h) => {
    ctx.fillStyle = css(accent);
    ctx.fillRect(w * 0.35, 0, w * 0.1, h);
    ctx.fillRect(w * 0.55, 0, w * 0.1, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 3;
    for (const x of [w * 0.35, w * 0.45, w * 0.55, w * 0.65]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  });
}

function roundelHoodTex(accent: number): THREE.CanvasTexture {
  return makeTexture(256, 512, (ctx, w, h) => {
    ctx.fillStyle = css(accent);
    ctx.fillRect(w * 0.4, 0, w * 0.2, h);
    ctx.strokeStyle = '#f2f2f2';
    ctx.lineWidth = 4;
    for (const x of [w * 0.4, w * 0.6]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  });
}

function roundelSideTex(accent: number, num: number): THREE.CanvasTexture {
  return makeTexture(512, 128, (ctx, w, h) => {
    const cx = w * 0.5;
    const cy = h * 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 52, 0, Math.PI * 2);
    ctx.fillStyle = '#f2f2f2';
    ctx.fill();
    ctx.lineWidth = 9;
    ctx.strokeStyle = css(accent);
    ctx.stroke();
    ctx.fillStyle = '#141416';
    ctx.font = '900 58px "Arial Black", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(num), cx, cy + 3);
  });
}

function solidTex(accent: number): THREE.CanvasTexture {
  return makeTexture(64, 64, (ctx, w, h) => {
    ctx.fillStyle = css(accent);
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 5;
    ctx.strokeRect(3, 3, w - 6, h - 6);
  });
}

function twoToneSideTex(accent: number): THREE.CanvasTexture {
  return makeTexture(512, 128, (ctx, w, h) => {
    ctx.fillStyle = css(accent);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    ctx.lineTo(w, h * 0.42);
    ctx.lineTo(0, h * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.62);
    ctx.lineTo(w, h * 0.42);
    ctx.stroke();
  });
}

function drawChecker(ctx: Ctx, accent: number, x0: number, y0: number, w: number, h: number, cells: number): void {
  const cw = w / cells;
  const rows = Math.max(1, Math.round(h / cw));
  const ch = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cells; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? css(accent) : '#151515';
      ctx.fillRect(x0 + c * cw, y0 + r * ch, cw + 0.5, ch + 0.5);
    }
  }
}

function checkerHoodTex(accent: number): THREE.CanvasTexture {
  return makeTexture(256, 512, (ctx, w, h) => {
    drawChecker(ctx, accent, 0, h * 0.78, w, h * 0.22, 8);
    ctx.fillStyle = css(accent);
    ctx.fillRect(0, h * 0.72, w, 5);
    ctx.fillRect(0, h * 0.66, w, 3);
  });
}

function checkerRoofTex(accent: number): THREE.CanvasTexture {
  return makeTexture(256, 256, (ctx, w, h) => {
    drawChecker(ctx, accent, 0, 0, w, h * 0.4, 8);
    ctx.fillStyle = css(accent);
    ctx.fillRect(0, h * 0.42, w, 5);
  });
}

/** 火焰舌：从底边向上升腾的贝塞尔曲线 */
function drawFlameTongues(ctx: Ctx, w: number, h: number, tongues: number): void {
  const grad = ctx.createLinearGradient(0, h, 0, h * 0.15);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  for (let i = 0; i < tongues; i++) {
    const x0 = (i / tongues) * w + w * 0.02;
    const tw = w / tongues;
    const tipY = h * (0.15 + Math.random() * 0.3);
    ctx.beginPath();
    ctx.moveTo(x0, h);
    ctx.quadraticCurveTo(x0 - tw * 0.2, h * 0.55, x0 + tw * 0.35, tipY);
    ctx.quadraticCurveTo(x0 + tw * 0.8, h * 0.6, x0 + tw, h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }
}

function flamesHoodTex(accent: number): THREE.CanvasTexture {
  return makeTexture(256, 512, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, h, 0, h * 0.2);
    grad.addColorStop(0, css(accent));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, h * 0.55, w, h * 0.45);
    drawFlameTongues(ctx, w, h, 5);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = css(accent);
    ctx.globalAlpha = 0.85;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  });
}

function flamesSideTex(accent: number): THREE.CanvasTexture {
  return makeTexture(512, 128, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, w * 0.8, 0);
    grad.addColorStop(0, css(accent));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, h * 0.45, w * 0.75, h * 0.55);
    // 侧向火舌：从车头（左）向车尾（右）拖尾
    for (let i = 0; i < 5; i++) {
      const y0 = h * (0.55 + i * 0.09);
      const len = w * (0.3 + Math.random() * 0.35);
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.quadraticCurveTo(len * 0.5, y0 - h * 0.35, len, y0 - h * 0.1);
      ctx.quadraticCurveTo(len * 0.5, y0 + h * 0.05, 0, y0 + h * 0.08);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }
  });
}

function slashesSideTex(accent: number): THREE.CanvasTexture {
  return makeTexture(512, 128, (ctx, w, h) => {
    for (let i = 0; i < 4; i++) {
      const x = w * 0.12 + i * w * 0.2;
      ctx.globalAlpha = i % 2 === 0 ? 0.95 : 0.6;
      ctx.fillStyle = css(accent);
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + w * 0.07, h);
      ctx.lineTo(x + w * 0.14, 0);
      ctx.lineTo(x + w * 0.07, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

function slashesHoodTex(accent: number): THREE.CanvasTexture {
  return makeTexture(256, 512, (ctx, w, h) => {
    ctx.fillStyle = css(accent);
    for (const [dx, alpha] of [[-0.12, 0.95], [0.02, 0.6]] as const) {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(w * (0.5 + dx), h);
      ctx.lineTo(w * (0.56 + dx), h);
      ctx.lineTo(w * (0.66 + dx), h * 0.62);
      ctx.lineTo(w * (0.6 + dx), h * 0.62);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

/** 自定义涂装纹理：dataURL 图像（无内容/无 DOM 环境时返回 null） */
function customTex(image: string): THREE.Texture | null {
  if (typeof document === 'undefined' || typeof document.createElementNS !== 'function') {
    return null; // 无头环境（测试）安全跳过
  }
  const tex = new THREE.TextureLoader().load(image);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 按涂装配置生成贴片组，挂载到车身 body 层 */
export function buildLiveryDecals(cfg: LiveryConfig, m: CarMetrics): THREE.Group {
  const g = new THREE.Group();
  switch (cfg.id) {
    case 'none':
      break;
    case 'custom': {
      // 自定义绘制贴图：引擎盖 + 车顶贴片；未绘制任何内容 = 无涂装
      if (cfg.customImage) {
        const tex = customTex(cfg.customImage);
        if (tex) g.add(hoodDecal(tex, m), roofDecal(tex, m));
      }
      break;
    }
    case 'stripes': {
      const tex = stripesTex(cfg.accent);
      g.add(hoodDecal(tex, m), roofDecal(tex, m));
      break;
    }
    case 'roundel': {
      g.add(hoodDecal(roundelHoodTex(cfg.accent), m));
      const tex = roundelSideTex(cfg.accent, cfg.number);
      g.add(sideDecal(tex, 1, false, m), sideDecal(tex, -1, false, m));
      break;
    }
    case 'twotone': {
      const tex = solidTex(cfg.accent);
      g.add(hoodDecal(tex, m), roofDecal(tex, m));
      const side = twoToneSideTex(cfg.accent);
      g.add(sideDecal(side, 1, false, m), sideDecal(side, -1, false, m));
      break;
    }
    case 'checkered': {
      g.add(hoodDecal(checkerHoodTex(cfg.accent), m));
      g.add(roofDecal(checkerRoofTex(cfg.accent), m));
      break;
    }
    case 'flames': {
      g.add(hoodDecal(flamesHoodTex(cfg.accent), m));
      const tex = flamesSideTex(cfg.accent);
      g.add(sideDecal(tex, 1, false, m), sideDecal(tex, -1, true, m));
      break;
    }
    case 'slashes': {
      g.add(hoodDecal(slashesHoodTex(cfg.accent), m));
      const tex = slashesSideTex(cfg.accent);
      g.add(sideDecal(tex, 1, false, m), sideDecal(tex, -1, false, m));
      break;
    }
  }
  return g;
}
