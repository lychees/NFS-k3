import * as THREE from 'three';
import { buildCarModel, disposeCarModel, type CarModel } from './carModel';
import {
  GRASS_SURFACE,
  PHYS,
  ROAD_SURFACE,
  stepPhysics,
  type CarInput,
  type PhysicsState,
  type TuningParams,
} from './carPhysics';
import { clamp, damp, lerp } from '../utils/math';
import { headingFromTangent, type Track } from '../track/track';
import type { AppearanceConfig, LiveryConfig } from '../garage/save';
import { NitroFlame } from '../fx/nitroFlame';

export class Car {
  readonly name: string;
  appearance: AppearanceConfig;
  livery: LiveryConfig;
  tuning: TuningParams;
  /** 场景中的容器（位置/朝向），模型挂在内部可整体换装 */
  readonly group: THREE.Group;
  model: CarModel;

  input: CarInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
  /** AI 橡皮筋调速系数 */
  speedMultiplier = 1;

  state: PhysicsState = {
    x: 0, z: 0, vx: 0, vz: 0, heading: 0, steer: 0,
    forwardSpeed: 0, longAccel: 0, latAccel: 0, latSpeed: 0,
    nitroFuel: 0, nitroActive: false,
  };

  trackT = 0;
  lateral = 0;
  onRoad = true;

  private flames: NitroFlame[] = [];
  private wheelSpin = 0;
  private visLong = 0;
  private visLat = 0;

  constructor(name: string, appearance: AppearanceConfig, tuning: TuningParams, livery: LiveryConfig) {
    this.name = name;
    this.appearance = appearance;
    this.livery = livery;
    this.tuning = tuning;
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    this.model = buildCarModel(appearance, livery);
    this.group.add(this.model.root);
    this.flames = this.model.exhausts.map((a) => new NitroFlame(a));
    this.state.nitroFuel = tuning.nitroCapacity;
  }

  get color(): number {
    return this.appearance.paint;
  }

  get pos(): THREE.Vector3 {
    return this.group.position;
  }

  get speedKmh(): number {
    return Math.abs(this.state.forwardSpeed) * 3.6;
  }

  get nitroRatio(): number {
    return this.tuning.nitroCapacity > 0
      ? this.state.nitroFuel / this.tuning.nitroCapacity
      : 0;
  }

  /** 更换外观/涂装（车库实时预览 / 改装后立即生效），物理状态不受影响 */
  rebuildVisual(appearance: AppearanceConfig, livery: LiveryConfig): void {
    this.appearance = appearance;
    this.livery = livery;
    for (const f of this.flames) f.setActive(false);
    this.group.remove(this.model.root);
    disposeCarModel(this.model);
    this.model = buildCarModel(appearance, livery);
    this.group.add(this.model.root);
    this.flames = this.model.exhausts.map((a) => new NitroFlame(a));
  }

  setTuning(tuning: TuningParams): void {
    this.tuning = tuning;
    this.state.nitroFuel = Math.min(this.state.nitroFuel, tuning.nitroCapacity);
  }

  reset(track: Track, progressMeters: number, lateral: number): void {
    const t = track.tAtDistance(progressMeters);
    const s = track.sampleAt(t);
    this.group.position.set(
      s.pos.x + s.left.x * lateral,
      s.pos.y,
      s.pos.z + s.left.z * lateral,
    );
    this.state.x = this.group.position.x;
    this.state.z = this.group.position.z;
    this.state.vx = 0;
    this.state.vz = 0;
    this.state.heading = headingFromTangent(s.tangent);
    this.state.steer = 0;
    this.state.forwardSpeed = 0;
    this.state.nitroFuel = this.tuning.nitroCapacity;
    this.state.nitroActive = false;
    this.trackT = t;
    this.lateral = lateral;
    this.onRoad = true;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
    this.speedMultiplier = 1;
    this.group.rotation.set(0, this.state.heading, 0);
    this.model.body.rotation.set(0, 0, 0);
  }

  update(dt: number, track: Track): void {
    const st = this.state;

    const surface = this.onRoad ? ROAD_SURFACE : GRASS_SURFACE;
    stepPhysics(st, this.input, dt, surface, this.tuning, this.speedMultiplier);

    // 物理推进后同步渲染坐标，再做赛道边界约束
    this.pos.x = st.x;
    this.pos.z = st.z;
    const n = track.nearest(this.pos);
    this.trackT = n.t;
    this.lateral = n.lateral;
    this.onRoad = Math.abs(n.lateral) <= track.halfWidth + 0.3;

    const maxLat = track.halfWidth + track.runoffWidth - 0.5;
    if (Math.abs(n.lateral) > maxLat) {
      const sign = Math.sign(n.lateral);
      this.pos.x = n.pos.x + n.left.x * sign * maxLat;
      this.pos.z = n.pos.z + n.left.z * sign * maxLat;
      st.x = this.pos.x;
      st.z = this.pos.z;
      const vOut = (st.vx * n.left.x + st.vz * n.left.z) * sign;
      if (vOut > 0) {
        st.vx -= n.left.x * vOut * sign;
        st.vz -= n.left.z * vOut * sign;
      }
      const wallDamp = Math.max(0, 1 - PHYS.wallDrag * dt);
      st.vx *= wallDamp;
      st.vz *= wallDamp;
    }

    // 贴合路面高度与坡度
    const grade = this.roadGrade(track, n.t);
    this.pos.y = n.pos.y;
    this.group.rotation.y = st.heading;
    this.group.rotation.x = -grade;

    // 车身姿态：加速俯仰 + 过弯侧倾
    const k = damp(8, dt);
    this.visLong = lerp(this.visLong, clamp(st.longAccel, -20, 20), k);
    this.visLat = lerp(this.visLat, clamp(st.latAccel, -30, 30), k);
    this.model.body.rotation.x = -this.visLong * 0.011;
    this.model.body.rotation.z = -this.visLat * 0.014;

    // 刹车时尾灯提亮
    this.model.brakeMaterial.emissiveIntensity = this.input.brake > 0 ? 4.5 : 0.9;

    // 氮气尾焰
    for (const f of this.flames) {
      f.setActive(st.nitroActive);
      f.update();
    }

    // 车轮：前轮随转向偏转，全部随速度滚动
    this.wheelSpin += (st.forwardSpeed / 0.34) * dt;
    this.model.wheelFL.rotation.y = st.steer;
    this.model.wheelFR.rotation.y = st.steer;
    this.model.spinFL.rotation.x = this.wheelSpin;
    this.model.spinFR.rotation.x = this.wheelSpin;
    this.model.spinRL.rotation.x = this.wheelSpin;
    this.model.spinRR.rotation.x = this.wheelSpin;
  }

  private roadGrade(track: Track, t: number): number {
    const ahead = track.sampleAt(t + 3 / track.length);
    const behind = track.sampleAt(t - 3 / track.length);
    return Math.atan2(ahead.pos.y - behind.pos.y, 6);
  }
}
