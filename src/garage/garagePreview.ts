import * as THREE from 'three';
import { buildCarModel, disposeCarModel, type CarModel } from '../car/carModel';
import { buildGlbCarModel, type GlbTemplate } from '../car/glbCar';
import type { AppearanceConfig, LiveryConfig } from './save';

/** 车库 3D 预览：旋转展台 + 霓虹氛围灯，独立于比赛场景 */
export class GaragePreview {
  readonly scene = new THREE.Scene();
  private turntable = new THREE.Group();
  private model: CarModel | null = null;

  constructor() {
    this.scene.background = new THREE.Color(0x0a0a12);

    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(3.3, 3.5, 0.18, 40),
      new THREE.MeshStandardMaterial({ color: 0x17171f, roughness: 0.4, metalness: 0.6 }),
    );
    disc.position.y = -0.09;
    this.scene.add(disc);

    const ringGeo = new THREE.TorusGeometry(3.32, 0.035, 8, 64);
    ringGeo.rotateX(Math.PI / 2);
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshStandardMaterial({
        color: 0x031012,
        emissive: 0x18e0ff,
        emissiveIntensity: 2.4,
      }),
    );
    ring.position.y = 0.02;
    this.scene.add(ring);

    this.scene.add(new THREE.HemisphereLight(0x8fa8c8, 0x1a141f, 0.7));

    const key = new THREE.DirectionalLight(0xfff1d6, 2.2);
    key.position.set(4, 6, 3);
    this.scene.add(key);

    const magenta = new THREE.PointLight(0xff2fd4, 60, 30, 2);
    magenta.position.set(-5, 2.5, -3);
    this.scene.add(magenta);
    const cyan = new THREE.PointLight(0x18e0ff, 60, 30, 2);
    cyan.position.set(5, 2.5, 3);
    this.scene.add(cyan);

    this.scene.add(this.turntable);
  }

  /** template 存在时预览 GLB 车型，否则程序化车模（保底） */
  setAppearance(cfg: AppearanceConfig, livery: LiveryConfig, template?: GlbTemplate | null): void {
    if (this.model) {
      this.turntable.remove(this.model.root);
      disposeCarModel(this.model);
    }
    this.model = template ? buildGlbCarModel(cfg, livery, template) : buildCarModel(cfg, livery);
    this.turntable.add(this.model.root);
  }

  frameCamera(camera: THREE.PerspectiveCamera): void {
    camera.position.set(4.8, 2.3, 4.8);
    camera.lookAt(0, 0.65, 0);
    if (camera.fov !== 50) {
      camera.fov = 50;
      camera.updateProjectionMatrix();
    }
  }

  update(dt: number): void {
    this.turntable.rotation.y += dt * 0.55;
  }
}
