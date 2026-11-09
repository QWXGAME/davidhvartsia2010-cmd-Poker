// Предмет на столе, как на референсе: гранёный стакан виски со льдом.
// с сигаретой. Никаких анимаций — только лёгкий дымок, тихо поднимающийся вверх.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PROPS } from './layout';
import { Particles } from './Particles';
import { crystalNormalMap, smokeTexture } from './textures';

function crystal(normalMap: THREE.Texture, opacity = 0.32) {
  return new THREE.MeshPhysicalMaterial({
    color: 0xf4f8fb, metalness: 0, roughness: 0.03, transparent: true, opacity: opacity * 0.6,
    envMapIntensity: 1.9, normalMap, normalScale: new THREE.Vector2(1.1, 1.1),
    clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, depthWrite: false,
  });
}

export class Props {
  readonly group = new THREE.Group();
  readonly glass = new THREE.Group();
  private smoke: Particles;

  constructor(quality: number) {
    this.buildGlass();
    // пепельницы с сигаретой больше нет — на столе только виски
    this.smoke = new Particles(1, { color: new THREE.Color(0.7, 0.72, 0.78), texture: smokeTexture() });
    void quality;
    this.group.add(this.glass);
  }

  // ── Гранёный «олд фэшн»: толстое дно, алмазная огранка снизу, гладкий край ──
  private buildGlass() {
    const cutMap = crystalNormalMap(0.6);
    cutMap.repeat.set(1, 1);
    const R0 = 0.05, R1 = 0.055, Hh = 0.105;
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(R1, R0, Hh, 48, 1, true), crystal(cutMap, 0.3));
    outer.position.y = Hh / 2;
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(R1 - 0.004, R0 - 0.006, Hh - 0.018, 40, 1, true),
      new THREE.MeshPhysicalMaterial({ color: 0xf4f8fb, roughness: 0.03, transparent: true, opacity: 0.12, envMapIntensity: 2.5, side: THREE.BackSide, depthWrite: false }));
    inner.position.y = 0.018 + (Hh - 0.018) / 2;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(R0 - 0.001, R0, 0.018, 48), crystal(crystalNormalMap(1, true), 0.45));
    base.position.y = 0.009;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R1 - 0.002, 0.0022, 8, 48), crystal(cutMap, 0.4));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = Hh;
    // виски: янтарь с тёплым свечением на просвет
    const whisky = new THREE.Mesh(
      new THREE.CylinderGeometry(R0 - 0.005 + 0.0025, R0 - 0.006, 0.044, 40),
      new THREE.MeshPhysicalMaterial({ color: 0xc8701e, emissive: 0x6a2a06, emissiveIntensity: 0.7, roughness: 0.04, transparent: true, opacity: 0.86, envMapIntensity: 2, clearcoat: 1 }),
    );
    whisky.position.y = 0.018 + 0.022;
    const surface = new THREE.Mesh(new THREE.CircleGeometry(R0 - 0.0035, 40),
      new THREE.MeshPhysicalMaterial({ color: 0xe39a3c, emissive: 0x8a3c08, emissiveIntensity: 0.5, roughness: 0.02, transparent: true, opacity: 0.7, envMapIntensity: 3 }));
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = 0.0625;
    // кубики льда с гранями
    const iceMat = new THREE.MeshPhysicalMaterial({
      color: 0xf2f8fc, roughness: 0.12, transparent: true, opacity: 0.5, envMapIntensity: 3, clearcoat: 1, depthWrite: false,
    });
    const iceGeo = new RoundedBoxGeometry(0.034, 0.032, 0.034, 3, 0.005);
    for (const [x, y, z, r] of [[0.013, 0.062, 0.008, 0.5], [-0.014, 0.058, -0.009, 1.2], [0.002, 0.08, -0.002, 0.8]]) {
      const cube = new THREE.Mesh(iceGeo, iceMat);
      cube.position.set(x, y, z);
      cube.rotation.set(r * 0.4, r * 1.7, r * 0.3);
      cube.renderOrder = 2;
      this.glass.add(cube);
    }
    whisky.renderOrder = 1; surface.renderOrder = 1;
    inner.renderOrder = 3; outer.renderOrder = 4; base.renderOrder = 4; rim.renderOrder = 4;
    this.glass.add(whisky, surface, inner, base, outer, rim);
    this.glass.position.set(PROPS.glass.x, 0, PROPS.glass.z);
    this.glass.scale.setScalar(1.35);
  }

  /** тап по предмету — без анимаций, только звук снаружи */
  poke(_which: 'glass' | 'ashtray') { /* предметы неподвижны */ }

  update(_t: number, _dt: number) { /* предметы неподвижны */ }

  get smokeParticles() { return this.smoke; }
}
