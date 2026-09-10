import * as THREE from 'three';
import { damp, lerp } from '../utils/math';
import type { Car } from '../car/car';

export type CameraMode = 'chase' | 'hood';

const BASE_FOV = 62;
const SPEED_FOV = 16;

/** 弹簧臂追逐相机 + 引擎盖视角，FOV 随速度拉远，氮气时冲击视角 + 震动 */
export class ChaseCamera {
  mode: CameraMode = 'chase';
  private fov = BASE_FOV;
  private initialized = false;
  private shake = 0;

  toggle(): void {
    this.mode = this.mode === 'chase' ? 'hood' : 'chase';
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

    if (this.mode === 'chase') {
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

    const targetFov =
      (this.mode === 'hood' ? BASE_FOV + 8 : BASE_FOV) + speedK * SPEED_FOV + (nitro ? 9 : 0);
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
