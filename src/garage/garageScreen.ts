import {
  ACCENTS,
  LIVERIES,
  PAINTS,
  PLAYER_VEHICLES,
  RIM_STYLES,
  SPOILER_STYLES,
  UNDERGLOWS,
  UPGRADE_COSTS,
  UPGRADE_MAX,
  clampCarNumber,
  type AppearanceConfig,
  type LiveryConfig,
  type LiveryId,
  type SaveData,
  type UpgradeLevels,
} from './save';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

const cssColor = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

const UPGRADE_ROWS: { key: keyof UpgradeLevels; name: string; desc: string }[] = [
  { key: 'engine', name: '引擎', desc: '极速 + 加速' },
  { key: 'tires', name: '轮胎', desc: '抓地 + 漂移恢复' },
  { key: 'nitro', name: '氮气瓶', desc: '容量 + 推力' },
];

export interface GarageCallbacks {
  /** 部分外观变更（只传被修改的字段） */
  onAppearance(patch: Partial<AppearanceConfig>): void;
  /** 部分涂装变更（预设 / 强调色 / 号码） */
  onLivery(patch: Partial<LiveryConfig>): void;
  onBuy(key: keyof UpgradeLevels): void;
  onToggleBloom(): void;
  /** 音量步进 ±0.1 */
  onVolume(delta: number): void;
  /** 打开涂装绘制器 */
  onPaintShop(): void;
  onBack(): void;
}

/** 车库 DOM 界面：外观选项 + 涂装 + 性能升级 + 积分显示 */
export class GarageScreen {
  private root = el('screen-garage');
  private credits = el('garage-credits');
  private cbs: GarageCallbacks;
  private liveryThumbs: { id: LiveryId; canvas: HTMLCanvasElement }[] = [];
  private save: SaveData | null = null;

  constructor(cbs: GarageCallbacks) {
    this.cbs = cbs;
    this.buildAppearanceRows();
    this.buildLiveryRows();
    this.buildUpgradeRows();
    this.buildQualityRow();
    el('garage-back').addEventListener('click', () => cbs.onBack());
  }

  open(save: SaveData): void {
    this.root.classList.remove('hidden');
    this.refresh(save);
  }

  close(): void {
    this.root.classList.add('hidden');
  }

  refresh(save: SaveData): void {
    this.save = save;
    this.credits.textContent = `CR ${save.credits}`;
    this.root.querySelectorAll<HTMLElement>('[data-vehicle]').forEach((b) => {
      b.classList.toggle('selected', b.dataset.vehicle === save.appearance.vehicle);
    });
    this.root.querySelectorAll<HTMLElement>('[data-paint]').forEach((b) => {
      b.classList.toggle('selected', Number(b.dataset.paint) === save.appearance.paint);
    });
    this.root.querySelectorAll<HTMLElement>('[data-spoiler]').forEach((b) => {
      b.classList.toggle('selected', b.dataset.spoiler === save.appearance.spoiler);
    });
    this.root.querySelectorAll<HTMLElement>('[data-rims]').forEach((b) => {
      b.classList.toggle('selected', b.dataset.rims === save.appearance.rims);
    });
    this.root.querySelectorAll<HTMLElement>('[data-glow]').forEach((b) => {
      const v = b.dataset.glow === '' ? null : Number(b.dataset.glow);
      b.classList.toggle('selected', v === save.appearance.underglow);
    });
    this.root.querySelectorAll<HTMLElement>('[data-livery]').forEach((b) => {
      b.classList.toggle('selected', b.dataset.livery === save.livery.id);
    });
    this.root.querySelectorAll<HTMLElement>('[data-accent]').forEach((b) => {
      b.classList.toggle('selected', Number(b.dataset.accent) === save.livery.accent);
    });
    el<HTMLInputElement>('paint-free-color').value = cssColor(save.appearance.paint);
    el<HTMLInputElement>('accent-free-color').value = cssColor(save.livery.accent);
    el<HTMLInputElement>('livery-number').value = String(save.livery.number);
    this.drawLiveryThumbs(save.livery.accent, save.livery.number);

    for (const row of UPGRADE_ROWS) {
      const level = save.upgrades[row.key];
      const pips = el(`upgrade-pips-${row.key}`);
      pips.querySelectorAll('span').forEach((pip, i) => {
        pip.classList.toggle('on', i < level);
      });
      const btn = el<HTMLButtonElement>(`upgrade-buy-${row.key}`);
      if (level >= UPGRADE_MAX) {
        btn.textContent = 'MAX';
        btn.disabled = true;
      } else {
        const cost = UPGRADE_COSTS[level];
        btn.textContent = `${cost} CR`;
        btn.disabled = save.credits < cost;
      }
    }

    el('quality-bloom').textContent = `泛光 BLOOM：${save.bloom ? '开' : '关'}`;
    el('vol-label').textContent = `${Math.round(save.volume * 100)}%${save.muted ? ' · 静音' : ''}`;
  }

  private buildAppearanceRows(): void {
    const vehicles = el('garage-vehicles');
    for (const v of PLAYER_VEHICLES) {
      const b = document.createElement('button');
      b.className = 'option';
      b.dataset.vehicle = v.id;
      b.textContent = v.name;
      b.addEventListener('click', () => this.cbs.onAppearance({ vehicle: v.id }));
      vehicles.appendChild(b);
    }

    const paints = el('garage-paints');
    for (const p of PAINTS) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.dataset.paint = String(p.color);
      b.style.background = cssColor(p.color);
      b.title = p.name;
      b.addEventListener('click', () =>
        this.cbs.onAppearance({ paint: p.color }),
      );
      paints.appendChild(b);
    }
    // 自由取色（预设之外任意色号）
    const paintPicker = document.createElement('input');
    paintPicker.type = 'color';
    paintPicker.className = 'free-color';
    paintPicker.id = 'paint-free-color';
    paintPicker.title = '自由取色';
    paintPicker.addEventListener('input', () => {
      this.cbs.onAppearance({ paint: parseInt(paintPicker.value.slice(1), 16) });
    });
    paints.appendChild(paintPicker);

    const spoilers = el('garage-spoilers');
    for (const s of SPOILER_STYLES) {
      const b = document.createElement('button');
      b.className = 'option';
      b.dataset.spoiler = s.id;
      b.textContent = s.name;
      b.addEventListener('click', () =>
        this.cbs.onAppearance({ spoiler: s.id }),
      );
      spoilers.appendChild(b);
    }

    const rims = el('garage-rims');
    for (const r of RIM_STYLES) {
      const b = document.createElement('button');
      b.className = 'option';
      b.dataset.rims = r.id;
      b.textContent = r.name;
      b.addEventListener('click', () =>
        this.cbs.onAppearance({ rims: r.id }),
      );
      rims.appendChild(b);
    }

    const glows = el('garage-glows');
    for (const u of UNDERGLOWS) {
      const b = document.createElement('button');
      b.className = u.color === null ? 'option' : 'swatch glow';
      b.dataset.glow = u.color === null ? '' : String(u.color);
      if (u.color === null) b.textContent = u.name;
      else {
        b.style.background = cssColor(u.color);
        b.style.boxShadow = `0 0 10px ${cssColor(u.color)}`;
        b.title = u.name;
      }
      b.addEventListener('click', () =>
        this.cbs.onAppearance({ underglow: u.color }),
      );
      glows.appendChild(b);
    }
  }

  private buildLiveryRows(): void {
    const wrap = el('garage-liveries');
    for (const l of LIVERIES) {
      const b = document.createElement('button');
      b.className = 'livery-thumb';
      b.dataset.livery = l.id;
      b.title = l.name;
      const c = document.createElement('canvas');
      c.width = 72;
      c.height = 44;
      b.appendChild(c);
      const label = document.createElement('span');
      label.className = 'livery-name';
      label.textContent = l.name;
      b.appendChild(label);
      b.addEventListener('click', () => this.cbs.onLivery({ id: l.id }));
      wrap.appendChild(b);
      this.liveryThumbs.push({ id: l.id, canvas: c });
    }

    const accents = el('garage-accents');
    for (const a of ACCENTS) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.dataset.accent = String(a.color);
      b.style.background = cssColor(a.color);
      b.title = a.name;
      b.addEventListener('click', () => this.cbs.onLivery({ accent: a.color }));
      accents.appendChild(b);
    }
    const accentPicker = document.createElement('input');
    accentPicker.type = 'color';
    accentPicker.className = 'free-color';
    accentPicker.id = 'accent-free-color';
    accentPicker.title = '自由取色';
    accentPicker.addEventListener('input', () => {
      this.cbs.onLivery({ accent: parseInt(accentPicker.value.slice(1), 16) });
    });
    accents.appendChild(accentPicker);

    const paintShopBtn = document.createElement('button');
    paintShopBtn.className = 'option';
    paintShopBtn.id = 'garage-paintshop';
    paintShopBtn.textContent = '涂装工作室 PAINT SHOP';
    paintShopBtn.addEventListener('click', () => this.cbs.onPaintShop());
    el('garage-liveries').appendChild(paintShopBtn);

    const numInput = el<HTMLInputElement>('livery-number');
    numInput.addEventListener('change', () => {
      const n = clampCarNumber(numInput.valueAsNumber);
      numInput.value = String(n);
      this.cbs.onLivery({ number: n });
    });
    el('livery-num-dec').addEventListener('click', () => this.stepNumber(-1));
    el('livery-num-inc').addEventListener('click', () => this.stepNumber(1));
  }

  private stepNumber(delta: number): void {
    if (!this.save) return;
    const n = clampCarNumber(this.save.livery.number + delta);
    el<HTMLInputElement>('livery-number').value = String(n);
    this.cbs.onLivery({ number: n });
  }

  /** 涂装缩略块：俯视小车 + 各预设的简化图案 */
  private drawLiveryThumbs(accent: number, num: number): void {
    for (const t of this.liveryThumbs) {
      const ctx = t.canvas.getContext('2d');
      if (!ctx) continue;
      const w = t.canvas.width;
      const h = t.canvas.height;
      const a = cssColor(accent);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#2a2d36';
      ctx.beginPath();
      ctx.roundRect(16, 3, w - 32, h - 6, 7);
      ctx.fill();
      ctx.fillStyle = a;
      switch (t.id) {
        case 'none':
          break;
        case 'stripes':
          ctx.fillRect(w / 2 - 7, 5, 5, h - 10);
          ctx.fillRect(w / 2 + 2, 5, 5, h - 10);
          break;
        case 'roundel':
          ctx.fillRect(w / 2 - 4, 5, 8, h - 10);
          ctx.beginPath();
          ctx.arc(w / 2, h / 2, 10, 0, Math.PI * 2);
          ctx.fillStyle = '#f2f2f2';
          ctx.fill();
          ctx.fillStyle = '#141416';
          ctx.font = '900 11px "Arial Black", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(num), w / 2, h / 2 + 1);
          break;
        case 'twotone':
          ctx.fillRect(17, 4, w - 34, (h - 8) / 2);
          break;
        case 'checkered':
          for (let r = 0; r < 2; r++)
            for (let c = 0; c < 8; c++) {
              ctx.fillStyle = (r + c) % 2 === 0 ? a : '#151515';
              ctx.fillRect(17 + c * ((w - 34) / 8), h - 14 + r * 5, (w - 34) / 8, 5);
            }
          break;
        case 'flames': {
          const grad = ctx.createLinearGradient(0, h, 0, h * 0.3);
          grad.addColorStop(0, a);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grad;
          for (let i = 0; i < 3; i++) {
            const x = w / 2 - 14 + i * 14;
            ctx.beginPath();
            ctx.moveTo(x - 6, h - 5);
            ctx.quadraticCurveTo(x, h * 0.45, x + 3, h * 0.3);
            ctx.quadraticCurveTo(x + 7, h * 0.55, x + 8, h - 5);
            ctx.closePath();
            ctx.fill();
          }
          break;
        }
        case 'slashes':
          ctx.save();
          ctx.translate(w / 2, h / 2);
          ctx.rotate(-0.5);
          ctx.fillRect(-14, -h / 2, 5, h);
          ctx.fillRect(3, -h / 2, 8, h);
          ctx.restore();
          break;
        case 'custom': {
          const img = this.save?.livery.customImage;
          if (img) {
            const image = new Image();
            image.onload = () => {
              ctx.clearRect(0, 0, w, h);
              ctx.fillStyle = '#2a2d36';
              ctx.beginPath();
              ctx.roundRect(16, 3, w - 32, h - 6, 7);
              ctx.fill();
              ctx.drawImage(image, 17, 4, w - 34, h - 8);
            };
            image.src = img;
          } else {
            ctx.fillStyle = '#8a93a8';
            ctx.font = 'italic 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('未绘制', w / 2, h / 2);
          }
          break;
        }
      }
    }
  }

  private buildUpgradeRows(): void {
    const container = el('garage-upgrades');
    for (const row of UPGRADE_ROWS) {
      const div = document.createElement('div');
      div.className = 'upgrade-row';
      div.innerHTML =
        `<span class="upgrade-name">${row.name}</span>` +
        `<span class="upgrade-desc">${row.desc}</span>` +
        `<span class="upgrade-pips" id="upgrade-pips-${row.key}">${'<span></span>'.repeat(UPGRADE_MAX)}</span>`;
      const btn = document.createElement('button');
      btn.className = 'buy';
      btn.id = `upgrade-buy-${row.key}`;
      btn.addEventListener('click', () => this.cbs.onBuy(row.key));
      div.appendChild(btn);
      container.appendChild(div);
    }
  }

  private buildQualityRow(): void {
    const btn = document.createElement('button');
    btn.className = 'option';
    btn.id = 'quality-bloom';
    btn.addEventListener('click', () => this.cbs.onToggleBloom());
    el('garage-quality').appendChild(btn);
    el('vol-dec').addEventListener('click', () => this.cbs.onVolume(-0.1));
    el('vol-inc').addEventListener('click', () => this.cbs.onVolume(0.1));
  }
}
