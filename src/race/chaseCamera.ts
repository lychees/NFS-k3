import * as THREE from 'three';
import { damp, lerp } from '../utils/math';
import type { Car } from '../car/car';

export type CameraMode = 'chase' | 'hood' | 'cockpit';

const BASE_FOV = 62;
const SPEED_FOV = 16;

/** 驾驶位（车局部坐标：左驾） */
const COCKPIT_OFFSET = { side: -0.42, up: 1.06, back: -0.35 };

/** 弹簧臂追逐 / 引擎盖 / 驾驶舱三视角，FOV 随速度拉远，氮气冲击 + 震动 */
export class ChaseCamera {
  mode: CameraMode = 'chase';
  private fov = BASE_FOV;
  private initialized = false;
  private shake = 0;

  toggle(): void {
    this.mode = this.mode === 'chase' ? 'hood' : this.mode === 'hood' ? 'cockpit' : 'chase';
  }

  /** 下一帧把相机直接放到目标位（比赛开始时避免弹簧甩动） */
  snapBehind(): void {
    this.initialized = false;
  }

  update(dt: number, car: Car, camera: THREE.PerspectiveCamera, nitro = false): void {
    const st = car.state;
    const fx = Math.sin(st.heading);
    const fz = Math.cos(st.heading);
    const speedK = car.speedKmh / 220;

    if (this.mode === 'cockpit') {
      // 刚体跟随驾驶位（无弹簧臂），随车身俯仰/侧倾
      const rx = -Math.cos(st.heading);
      const rz = Math.sin(st.heading);
      camera.position.set(
        car.pos.x + rx * COCKPIT_OFFSET.side + fx * COCKPIT_OFFSET.back,
        car.pos.y + COCKPIT_OFFSET.up,
        car.pos.z + rz * COCKPIT_OFFSET.side + fz * COCKPIT_OFFSET.back,
      );
      camera.rotation.order = 'YXZ';
      camera.rotation.y = st.heading + Math.PI;
      camera.rotation.x = car.group.rotation.x * 0.9 - car.visPitch * 0.006;
      camera.rotation.z = -car.visRoll * 0.008;
      // 高速轻微震动
      if (car.speedKmh > 110) {
        camera.rotation.x += (Math.random() - 0.5) * 0.0035;
        camera.rotation.z += (Math.random() - 0.5) * 0.0025;
      }
      this.initialized = false;
    } else if (this.mode === 'chase') {
      const dist = 7.6 + speedK * 2.4;
      const height = 3.1 + speedK * 0.6;
      const target = new THREE.Vector3(
        car.pos.x - fx * dist,
        car.pos.y + height,
        car.pos.z - fz * dist,
      );
      if (!this.initialized) {
        camera.position.copy(target);
        this.initialized = true;
      } else {
        camera.position.lerp(target, damp(5.5, dt));
      }
      camera.lookAt(car.pos.x + fx * 4, car.pos.y + 1.3, car.pos.z + fz * 4);
    } else {
      camera.position.set(car.pos.x + fx * 0.7, car.pos.y + 1.2, car.pos.z + fz * 0.7);
      camera.lookAt(
        car.pos.x + fx * 40,
        car.pos.y + 0.9 - speedK * 0.4,
        car.pos.z + fz * 40,
      );
      this.initialized = false;
    }

    const baseFov = this.mode === 'cockpit' ? BASE_FOV + 6 : this.mode === 'hood' ? BASE_FOV + 8 : BASE_FOV;
    const targetFov = baseFov + speedK * SPEED_FOV + (nitro ? 9 : 0);
    this.fov = lerp(this.fov, targetFov, damp(nitro ? 9 : 4, dt));
    if (Math.abs(camera.fov - this.fov) > 0.05) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }

    // 氮气震动
    this.shake = nitro ? 0.5 : lerp(this.shake, 0, damp(4, dt));
    if (this.shake > 0.01) {
      camera.position.x += (Math.random() - 0.5) * this.shake * 0.22;
      camera.position.y += (Math.random() - 0.5) * this.shake * 0.16;
      camera.position.z += (Math.random() - 0.5) * this.shake * 0.22;
    }
  }

  /** 菜单界面的绕场巡航镜头 */
  menuOrbit(camera: THREE.PerspectiveCamera, center: THREE.Vector3, time: number): void {
    const a = time * 0.08;
    camera.position.set(center.x + Math.cos(a) * 46, center.y + 16, center.z + Math.sin(a) * 46);
    camera.lookAt(center.x, center.y + 2, center.z);
    if (Math.abs(camera.fov - BASE_FOV) > 0.05) {
      camera.fov = BASE_FOV;
      camera.updateProjectionMatrix();
    }
    this.fov = BASE_FOV;
    this.initialized = false;
  }
}
