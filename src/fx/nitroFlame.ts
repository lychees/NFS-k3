import * as THREE from 'three';

/** 氮气尾焰：排气管锚点上的双层锥体（外橙内蓝），开启时随机抖动 */
export class NitroFlame {
  private group = new THREE.Group();
  private visible = false;

  constructor(anchor: THREE.Object3D) {
    const outerGeo = new THREE.ConeGeometry(0.1, 0.75, 7);
    outerGeo.rotateX(-Math.PI / 2);
    outerGeo.translate(0, 0, -0.38);
    const outer = new THREE.Mesh(
      outerGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff7a20,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );

    const innerGeo = new THREE.ConeGeometry(0.055, 0.5, 7);
    innerGeo.rotateX(-Math.PI / 2);
    innerGeo.translate(0, 0, -0.25);
    const inner = new THREE.Mesh(
      innerGeo,
      new THREE.MeshBasicMaterial({
        color: 0x7ad9ff,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );

    this.group.add(outer, inner);
    this.group.visible = false;
    anchor.add(this.group);
  }

  setActive(active: boolean): void {
    this.visible = active;
    this.group.visible = active;
  }

  update(): void {
    if (!this.visible) return;
    const w = 0.75 + Math.random() * 0.55;
    this.group.scale.set(w, w, 0.7 + Math.random() * 0.9);
  }
}
