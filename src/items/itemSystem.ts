import * as THREE from 'three';
import type { Car } from '../car/car';
import type { Track } from '../track/track';
import type { SmokePool } from '../fx/smoke';
import { rollItem, type ItemId } from './itemDefs';

/** 平衡参数 */
export const ITEM_PARAMS = {
  boxSpacing: 200, // 道具箱间距（米）
  boxRespawn: 8, // 重生秒数
  pickupDist: 3.5,
  turboTime: 3,
  rocketSpeed: 90,
  rocketHitDist: 4,
  rocketLife: 4,
  mineLife: 20,
  mineHitDist: 3,
  oilLife: 15,
  oilHitDist: 2.6,
  oilGrip: 0.3,
  spinTime: 1.5,
  spinVel: 7, // 打滑横摆角速度（rad/s，线性衰减）
  spinSpeedLoss: 0.6, // 命中瞬间速度保留比例
  shieldTime: 8,
  armDelay: 1, // 地雷/油渍布置后武装延迟（防自伤）
  aiUseMin: 2,
  aiUseMax: 6,
} as const;

export interface CarEffects {
  spinT: number;
  oilT: number;
  shieldT: number;
  turboT: number;
}

interface Slot {
  car: Car;
  isHuman: 0 | 1 | null;
  item: ItemId | null;
  aiUseT: number;
  fx: CarEffects;
  shieldMesh: THREE.Mesh;
}

interface Box {
  mesh: THREE.Group;
  active: boolean;
  respawnT: number;
  x: number;
  y: number;
  z: number;
}

interface Rocket {
  active: boolean;
  mesh: THREE.Mesh;
  target: Car | null;
  t: number;
}

interface Trap {
  active: boolean;
  mesh: THREE.Mesh;
  expireT: number;
  armT: number;
  owner: Car | null;
}

const ROCKET_POOL = 8;
const TRAP_POOL = 14;

/** 道具系统：道具箱/飞行物/陷阱/效果计时/拾取与命中（警车不参与） */
export class ItemManager {
  private scene: THREE.Scene;
  private smoke: SmokePool;
  private group: THREE.Group | null = null;
  private slots: Slot[] = [];
  private boxes: Box[] = [];
  private rockets: Rocket[] = [];
  private mines: Trap[] = [];
  private oils: Trap[] = [];
  private positionOf: (car: Car) => number = () => 1;
  private progressOf: (car: Car) => number = () => 0;
  active = false;

  constructor(scene: THREE.Scene, smoke: SmokePool) {
    this.scene = scene;
    this.smoke = smoke;
  }

  get enabled(): boolean {
    return this.active;
  }

  itemOf(car: Car): ItemId | null {
    return this.slots.find((s) => s.car === car)?.item ?? null;
  }

  effectsOf(car: Car): CarEffects | null {
    return this.slots.find((s) => s.car === car)?.fx ?? null;
  }

  setup(
    track: Track,
    cars: { car: Car; isHuman: 0 | 1 | null }[],
    positionOf: (car: Car) => number,
    progressOf: (car: Car) => number,
  ): void {
    this.teardown();
    this.active = true;
    this.positionOf = positionOf;
    this.progressOf = progressOf;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // 道具槽 + 护盾罩（预建隐藏）
    this.slots = cars.map(({ car, isHuman }) => {
      const shieldMesh = new THREE.Mesh(
        new THREE.SphereGeometry(2.6, 12, 8),
        new THREE.MeshBasicMaterial({
          color: 0x40c8ff,
          transparent: true,
          opacity: 0.22,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      shieldMesh.visible = false;
      this.group!.add(shieldMesh);
      return { car, isHuman, item: null, aiUseT: 0, fx: { spinT: 0, oilT: 0, shieldT: 0, turboT: 0 }, shieldMesh };
    });

    // 道具箱：沿赛道等距（中心线左右交替）
    const count = Math.max(4, Math.floor((track.length - 150) / ITEM_PARAMS.boxSpacing));
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0x062a30,
      emissive: 0x18e0ff,
      emissiveIntensity: 2.2,
    });
    this.boxes = [];
    for (let i = 0; i < count; i++) {
      const s = track.sampleAt((100 + i * ITEM_PARAMS.boxSpacing) / track.length);
      const lat = i % 2 === 0 ? 2.5 : -2.5;
      const mesh = new THREE.Group();
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), boxMat);
      mesh.add(cube);
      mesh.position.set(s.pos.x + s.left.x * lat, s.pos.y + 0.9, s.pos.z + s.left.z * lat);
      this.group.add(mesh);
      this.boxes.push({
        mesh,
        active: true,
        respawnT: 0,
        x: mesh.position.x,
        y: mesh.position.y,
        z: mesh.position.z,
      });
    }

    // 追踪弹 / 地雷 / 油渍对象池（预建隐藏）
    const rocketGeo = new THREE.ConeGeometry(0.22, 0.9, 6);
    rocketGeo.rotateX(Math.PI / 2);
    const rocketMat = new THREE.MeshStandardMaterial({
      color: 0x2a0808,
      emissive: 0xff3020,
      emissiveIntensity: 2.6,
    });
    this.rockets = Array.from({ length: ROCKET_POOL }, () => {
      const mesh = new THREE.Mesh(rocketGeo, rocketMat);
      mesh.visible = false;
      this.group!.add(mesh);
      return { active: false, mesh, target: null, t: 0 };
    });

    const mineGeo = new THREE.SphereGeometry(0.5, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    const mineMat = new THREE.MeshStandardMaterial({
      color: 0x200505,
      emissive: 0xff2020,
      emissiveIntensity: 1.8,
    });
    this.mines = Array.from({ length: TRAP_POOL }, () => {
      const mesh = new THREE.Mesh(mineGeo, mineMat);
      mesh.visible = false;
      this.group!.add(mesh);
      return { active: false, mesh, expireT: 0, armT: 0, owner: null };
    });

    const oilGeo = new THREE.CircleGeometry(2.2, 16);
    oilGeo.rotateX(-Math.PI / 2);
    const oilMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a10,
      roughness: 0.15,
      metalness: 0.6,
      transparent: true,
      opacity: 0.85,
    });
    this.oils = Array.from({ length: TRAP_POOL }, () => {
      const mesh = new THREE.Mesh(oilGeo, oilMat);
      mesh.visible = false;
      this.group!.add(mesh);
      return { active: false, mesh, expireT: 0, armT: 0, owner: null };
    });
  }

  teardown(): void {
    this.active = false;
    for (const s of this.slots) s.car.surfaceGripMult = 1;
    this.slots = [];
    if (this.group) {
      this.scene.remove(this.group);
      this.group = null;
    }
    this.boxes = [];
    this.rockets = [];
    this.mines = [];
    this.oils = [];
  }

  /** 使用道具（玩家按键 / AI 自动）；槽为空返回 false */
  useItem(car: Car): boolean {
    const slot = this.slots.find((s) => s.car === car);
    if (!slot || !slot.item) return false;
    const item = slot.item;
    slot.item = null;
    const st = car.state;
    switch (item) {
      case 'turbo':
        slot.fx.turboT = ITEM_PARAMS.turboTime;
        break;
      case 'nitro':
        st.nitroFuel = car.tuning.nitroCapacity;
        break;
      case 'shield':
        slot.fx.shieldT = ITEM_PARAMS.shieldTime;
        break;
      case 'rocket': {
        const target = this.pickTarget(car);
        const r = this.rockets.find((q) => !q.active);
        if (r && target) {
          r.active = true;
          r.target = target;
          r.t = 0;
          r.mesh.visible = true;
          r.mesh.position.set(car.pos.x, car.pos.y + 1, car.pos.z);
        }
        break;
      }
      case 'mine':
      case 'oil': {
        const pool = item === 'mine' ? this.mines : this.oils;
        const tr = pool.find((q) => !q.active);
        if (tr) {
          const fx = Math.sin(st.heading);
          const fz = Math.cos(st.heading);
          tr.active = true;
          tr.owner = car;
          tr.armT = ITEM_PARAMS.armDelay;
          tr.expireT = item === 'mine' ? ITEM_PARAMS.mineLife : ITEM_PARAMS.oilLife;
          tr.mesh.visible = true;
          tr.mesh.position.set(car.pos.x - fx * 3, car.pos.y + 0.1, car.pos.z - fz * 3);
        }
        break;
      }
    }
    return true;
  }

  /** 追踪弹目标：前方里程最近者（无人在前则取领先者） */
  private pickTarget(car: Car): Car | null {
    const myP = this.progressOf(car);
    let best: Car | null = null;
    let bestGap = Infinity;
    for (const s of this.slots) {
      if (s.car === car) continue;
      const gap = this.progressOf(s.car) - myP;
      if (gap > 0 && gap < bestGap) {
        bestGap = gap;
        best = s.car;
      }
    }
    if (!best) {
      let top = -Infinity;
      for (const s of this.slots) {
        if (s.car === car) continue;
        const p = this.progressOf(s.car);
        if (p > top) {
          top = p;
          best = s.car;
        }
      }
    }
    return best;
  }

  /** 物理前每帧：效果计时与覆盖（主循环在输入赋值后、car.update 前调用） */
  prePhysics(dt: number): void {
    if (!this.active) return;
    for (const s of this.slots) {
      const fx = s.fx;
      if (fx.spinT > 0) {
        fx.spinT -= dt;
        const k = Math.max(0, fx.spinT / ITEM_PARAMS.spinTime);
        s.car.state.heading += ITEM_PARAMS.spinVel * k * dt;
      }
      if (fx.oilT > 0) {
        fx.oilT -= dt;
        s.car.surfaceGripMult = ITEM_PARAMS.oilGrip;
      } else if (s.car.surfaceGripMult !== 1) {
        s.car.surfaceGripMult = 1;
      }
      if (fx.shieldT > 0) fx.shieldT -= dt;
      if (fx.turboT > 0) {
        fx.turboT -= dt;
        s.car.input = { ...s.car.input, nitro: true };
        s.car.state.nitroFuel = s.car.tuning.nitroCapacity; // 道具推力不耗氮气
      }
      s.shieldMesh.visible = fx.shieldT > 0;
      if (s.shieldMesh.visible) {
        s.shieldMesh.position.set(s.car.pos.x, s.car.pos.y + 1, s.car.pos.z);
      }
    }
  }

  /** 物理后每帧：实体推进/拾取/命中/AI 使用（主循环在 car.update 后调用） */
  postPhysics(dt: number, onEvent: (kind: 'pickup' | 'hit' | 'block', car: Car) => void): void {
    if (!this.active) return;

    // 道具箱旋转浮动 + 重生 + 拾取
    const time = performance.now() / 1000;
    for (const b of this.boxes) {
      if (!b.active) {
        b.respawnT -= dt;
        if (b.respawnT <= 0) {
          b.active = true;
          b.mesh.visible = true;
        }
        continue;
      }
      b.mesh.rotation.y = time * 1.8;
      b.mesh.position.y = b.y + Math.sin(time * 2.4 + b.x) * 0.18;
      for (const s of this.slots) {
        if (s.item !== null) continue;
        const d = Math.hypot(s.car.pos.x - b.mesh.position.x, s.car.pos.z - b.mesh.position.z);
        if (d < ITEM_PARAMS.pickupDist) {
          s.item = rollItem(this.positionOf(s.car), this.slots.length);
          s.aiUseT = ITEM_PARAMS.aiUseMin + Math.random() * (ITEM_PARAMS.aiUseMax - ITEM_PARAMS.aiUseMin);
          b.active = false;
          b.respawnT = ITEM_PARAMS.boxRespawn;
          b.mesh.visible = false;
          if (s.isHuman !== null) onEvent('pickup', s.car);
          break;
        }
      }
    }

    // 追踪弹推进与命中
    for (const r of this.rockets) {
      if (!r.active) continue;
      r.t += dt;
      const target = r.target;
      if (r.t > ITEM_PARAMS.rocketLife || !target) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const dx = target.pos.x + target.state.vx * 0.3 - r.mesh.position.x;
      const dz = target.pos.z + target.state.vz * 0.3 - r.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < ITEM_PARAMS.rocketHitDist) {
        this.applyHit(target, 'rocket', onEvent);
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const step = Math.min(ITEM_PARAMS.rocketSpeed * dt, dist);
      r.mesh.position.x += (dx / dist) * step;
      r.mesh.position.z += (dz / dist) * step;
      r.mesh.position.y = target.pos.y + 1.1;
      r.mesh.rotation.y = Math.atan2(dx, dz);
    }

    // 地雷 / 油渍触发与过期
    for (const pool of [this.mines, this.oils] as const) {
      const isMine = pool === this.mines;
      for (const tr of pool) {
        if (!tr.active) continue;
        tr.expireT -= dt;
        if (tr.armT > 0) tr.armT -= dt;
        if (tr.expireT <= 0) {
          tr.active = false;
          tr.mesh.visible = false;
          continue;
        }
        if (tr.armT > 0) continue;
        const hitDist = isMine ? ITEM_PARAMS.mineHitDist : ITEM_PARAMS.oilHitDist;
        for (const s of this.slots) {
          const d = Math.hypot(s.car.pos.x - tr.mesh.position.x, s.car.pos.z - tr.mesh.position.z);
          if (d < hitDist) {
            if (isMine) {
              this.applyHit(s.car, 'mine', onEvent);
              tr.active = false;
              tr.mesh.visible = false;
            } else if (s.fx.oilT <= 0) {
              this.applyHit(s.car, 'oil', onEvent);
            }
            break;
          }
        }
      }
    }

    // AI 自动使用（玩家不自动）
    for (const s of this.slots) {
      if (s.isHuman !== null || s.item === null) continue;
      s.aiUseT -= dt;
      if (s.aiUseT <= 0) this.useItem(s.car);
    }
  }

  /** 命中效果：护盾格挡优先，否则打滑 + 减速 + 粒子 */
  private applyHit(car: Car, kind: 'rocket' | 'mine' | 'oil', onEvent: (kind: 'pickup' | 'hit' | 'block', car: Car) => void): void {
    const slot = this.slots.find((s) => s.car === car);
    if (!slot) return;
    if (slot.fx.shieldT > 0) {
      slot.fx.shieldT = 0; // 护盾抵消一次
      onEvent('block', car);
      return;
    }
    if (kind === 'oil') {
      slot.fx.oilT = 3;
    } else {
      slot.fx.spinT = ITEM_PARAMS.spinTime;
      car.state.vx *= ITEM_PARAMS.spinSpeedLoss;
      car.state.vz *= ITEM_PARAMS.spinSpeedLoss;
    }
    // 命中火花
    for (let i = 0; i < 6; i++) {
      this.smoke.spawn(car.pos.x, car.pos.y + 0.5, car.pos.z, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 0);
    }
    onEvent('hit', car);
  }
}
