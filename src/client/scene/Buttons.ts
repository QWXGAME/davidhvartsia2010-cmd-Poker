// Кнопки из полированного винного дерева, утопленные в ближний борт: ФОЛД · ЧЕК/КОЛЛ · РЕЙЗ.
// Надпись — инкрустация слоновой костью (контрастная, чёткая, 1024 px). Нажатие — кнопка медленно
// проседает в латунное гнездо и пружинит обратно; на твоём ходу буквы мягко теплеют.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FELT_L, FELT_R, RAIL_W, TABLE_Z } from './layout';
import { woodButtonTextures } from './woods';
import { lacquerWoodTexture } from './textures';
import { Tweens, ease } from './Tween';

interface Plate { root: THREE.Group; mesh: THREE.Mesh; mat: THREE.MeshPhysicalMaterial; label: string; enabled: boolean; base: number }

export class TableButtons {
  readonly group = new THREE.Group();
  readonly plates: Plate[] = [];
  private live = false;

  constructor(private tweens: Tweens) {
    const rc = FELT_R + RAIL_W * 0.36; // ближе к сукну — таблички всегда в кадре
    const geo = new RoundedBoxGeometry(0.205, 0.018, 0.074, 4, 0.006);
    // верх кнопки получает всю текстуру, бока — только край текстуры (тёмное дерево)
    const socketGeo = new RoundedBoxGeometry(0.222, 0.01, 0.09, 3, 0.006);
    const faceGeo = new THREE.PlaneGeometry(0.205 - 0.01, 0.074 - 0.01);
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x4a0f1c, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.1 });
    // ободок гнезда — то же тёмное дерево, что и бортик стола (без металлического блеска)
    const socketWood = lacquerWoodTexture();
    socketWood.repeat.set(0.6, 0.6);
    const socketMat = new THREE.MeshStandardMaterial({ map: socketWood, color: new THREE.Color(1.25, 1.15, 1.1), metalness: 0, roughness: 0.5, envMapIntensity: 0.8 });
    [-0.25, 0, 0.25].forEach((th, i) => {
      const root = new THREE.Group();
      root.position.set(Math.sin(th) * rc, 0, TABLE_Z + FELT_L + Math.cos(th) * rc);
      root.rotation.y = th;
      // гнездо в борту — тёмная окантовка, табличка утоплена в него
      const socket = new THREE.Mesh(socketGeo, socketMat);
      socket.position.y = 0.06;
      const tx = woodButtonTextures(['ФОЛД', 'ЧЕК', 'РЕЙЗ'][i], '');
      // полированное дерево под лаком: мягкий широкий блик + тонкий зеркальный от лака
      const mat = new THREE.MeshPhysicalMaterial({
        map: tx.map, emissiveMap: tx.emissiveMap, metalness: 0, roughness: 0.42, envMapIntensity: 1.1,
        clearcoat: 1, clearcoatRoughness: 0.08, specularIntensity: 0.6, emissive: new THREE.Color(0, 0, 0),
      });
      // корпус кнопки — гладкое винное дерево; надпись — на верхней грани отдельной пластиной
      const mesh = new THREE.Mesh(geo, bodyMat);
      const face = new THREE.Mesh(faceGeo, mat);
      face.rotation.x = -Math.PI / 2;
      face.position.y = 0.0091;
      mesh.add(face);
      const base = 0.068;
      mesh.position.y = base;
      mesh.castShadow = true;
      root.add(socket, mesh);
      this.group.add(root);
      this.plates.push({ root, mesh, mat, label: '', enabled: true, base });
    });
  }

  /** надписи и доступность; sub — сумма под надписью */
  set(i: number, label: string, sub: string, enabled: boolean) {
    const p = this.plates[i];
    const key = label + '|' + sub;
    if (p.label !== key) {
      p.label = key;
      p.mat.map?.dispose();
      p.mat.emissiveMap?.dispose();
      const tx = woodButtonTextures(label, sub);
      p.mat.map = tx.map;
      p.mat.emissiveMap = tx.emissiveMap;
      p.mat.needsUpdate = true;
    }
    p.enabled = enabled;
  }

  setLive(v: boolean) { this.live = v; }

  /** медленное нажатие: проседает в гнездо и пружинит назад */
  press(i: number) {
    const p = this.plates[i];
    const m = p.mesh;
    const y0 = p.base;
    this.tweens.add(200, k => { m.position.y = y0 - 0.0055 * k; }, {
      key: m, ease: ease.outCubic,
      done: () => this.tweens.add(420, k => { m.position.y = y0 - 0.0055 * (1 - k); }, { key: m, ease: ease.outBack }),
    });
  }

  update(t: number, dt: number) {
    for (const p of this.plates) {
      const target = p.enabled && this.live ? 0.42 + Math.sin(t * 2.4) * 0.14 : p.enabled ? 0.12 : -1;
      // недоступные — тусклее (через цвет), доступные на ходу — тёплое свечение
      const glow = Math.max(0, target);
      p.mat.emissive.r += (glow * 1.0 - p.mat.emissive.r) * Math.min(1, dt * 6);
      p.mat.emissive.g += (glow * 0.8 - p.mat.emissive.g) * Math.min(1, dt * 6);
      p.mat.emissive.b += (glow * 0.45 - p.mat.emissive.b) * Math.min(1, dt * 6);
      const dim = p.enabled ? 1 : 0.4;
      p.mat.color.setScalar(p.mat.color.r + (dim - p.mat.color.r) * Math.min(1, dt * 6));
    }
  }
}
