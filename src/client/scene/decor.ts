// Убранство подпольного клуба: бра с тёплыми пятнами света на шёлковых обоях, бар с подсвеченными
// бутылками у дальней стены, картины в золочёных рамах, персидский ковёр под столом, табачная дымка.
// Всё дёшево: свет — запечённые аддитивные пятна (без лишних источников), бутылки — один InstancedMesh.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { glowTexture, smokeTexture } from './textures';
import { rugTexture, woodCanvas, WOOD } from './woods';

export interface RoomDims { FLOOR_Y: number; WALL_H: number; BACK: number; SIDE: number; FRONT: number }

const brass = new THREE.MeshStandardMaterial({ color: 0xb08a48, metalness: 1, roughness: 0.32, envMapIntensity: 1.2 });

/** Мягкое световое пятно на стене (аддитивный градиент) — свет бра «на обоях» без лишних источников. */
const washMats = new Map<string, THREE.MeshBasicMaterial>();
function wash(radius: number, color: string, opacity: number) {
  // материал общий для одинаковых пятен — их можно слить в один вызов отрисовки
  const key = color + opacity;
  let mat = washMats.get(key);
  if (!mat) { mat = washMaterial(color, opacity); washMats.set(key, mat); }
  return new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2.4), mat);
}

function washMaterial(color: string, opacity: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 54, 0, 64, 64, 64);
  gr.addColorStop(0, color); gr.addColorStop(0.35, color.replace(/[\d.]+\)$/, '0.35)')); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
}

/**
 * Склейка неподвижного убранства: все меши с одинаковым материалом → один меш.
 * Было ~90 отдельных вызовов отрисовки на бра, рамы и полки — становится около десятка.
 */
function mergeStatic(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const victims: THREE.Mesh[] = [];
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return;
    let g = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.getAttribute('uv')) return;
    const list = buckets.get(m.material) ?? [];
    list.push(g);
    buckets.set(m.material, list);
    victims.push(m);
  });
  for (const v of victims) v.parent?.remove(v);
  for (const [mat, geos] of buckets) {
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }
}

/** Бра: латунная розетка, изогнутый рожок и абажур из плиссированного шёлка, светящийся изнутри. */
function sconce() {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 24), brass);
  plate.rotation.x = Math.PI / 2;
  const arm = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.008, 8, 20, Math.PI / 2), brass);
  arm.rotation.set(0, Math.PI / 2, 0);
  arm.position.set(0, 0.09, 0.0);
  const shadeGeo = new THREE.CylinderGeometry(0.07, 0.1, 0.13, 24, 1, true);
  const shade = new THREE.Mesh(shadeGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.9, 0.45), side: THREE.DoubleSide, toneMapped: false }));
  shade.position.set(0, 0.2, 0.09);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,170,90,1)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
  glow.scale.setScalar(0.7);
  glow.position.copy(shade.position);
  g.add(plate, arm, shade, glow);
  const w = wash(0.9, 'rgba(255,150,80,0.55)', 0.55);
  w.position.set(0, 0.15, 0.005);
  g.add(w);
  return g;
}

/** Бар у дальней стены: стойка из тёмного дерева, полки с бутылками в янтарной подсветке. */
function backBar(d: RoomDims, quality: number) {
  const g = new THREE.Group();
  const woodTex = new THREE.CanvasTexture(woodCanvas(256, 256, WOOD.mahogany, 61, 2));
  woodTex.colorSpace = THREE.SRGBColorSpace;
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
  woodTex.repeat.set(3, 1);
  const wood = new THREE.MeshStandardMaterial({ map: woodTex, color: 0x9a7a6a, roughness: 0.45, envMapIntensity: 0.6 });
  const W = 3.2;
  // задняя стенка шкафа — тёплое свечение, на фоне которого читаются силуэты бутылок
  const backGlow = new THREE.Mesh(new THREE.PlaneGeometry(W, 1.1), new THREE.MeshBasicMaterial({
    map: (() => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 64;
      const x = c.getContext('2d')!;
      const gr = x.createLinearGradient(0, 0, 0, 64);
      gr.addColorStop(0, '#120604'); gr.addColorStop(0.5, '#6a3612'); gr.addColorStop(1, '#120604');
      x.fillStyle = gr; x.fillRect(0, 0, 256, 64);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })(), toneMapped: false,
  }));
  backGlow.position.set(0, 1.55, 0.01);
  g.add(backGlow);
  // полки
  for (const y of [1.1, 1.5, 1.9]) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(W, 0.025, 0.22), wood);
    shelf.position.set(0, y, 0.11);
    g.add(shelf);
  }
  // стойка
  const counter = new THREE.Mesh(new RoundedBoxGeometry(W + 0.3, 1.0, 0.55, 3, 0.03), wood);
  counter.position.set(0, d.FLOOR_Y + 0.5 - (d.FLOOR_Y) * 0 , 0.75);
  counter.position.y = 0.5 + d.FLOOR_Y;
  const top = new THREE.Mesh(new RoundedBoxGeometry(W + 0.4, 0.05, 0.65, 3, 0.02), new THREE.MeshPhysicalMaterial({ color: 0x0c0605, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1 }));
  top.position.set(0, d.FLOOR_Y + 1.02, 0.75);
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, W + 0.3, 12), brass);
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, d.FLOOR_Y + 0.18, 1.05);
  void counter; void top; void rail;   // стойку не ставим — из-за стола она читается как лишняя полоса
  // бутылки: один InstancedMesh, разные силуэты через масштаб, цвет — янтарь/зелень/дымчатое стекло
  const prof = [[0, 0], [0.04, 0], [0.042, 0.02], [0.042, 0.17], [0.03, 0.21], [0.014, 0.25], [0.014, 0.31], [0.016, 0.32], [0, 0.32]].map(([x, y]) => new THREE.Vector2(x, y));
  const bottleGeo = new THREE.LatheGeometry(prof, quality > 1 ? 14 : 10);
  const bottleMat = new THREE.MeshPhysicalMaterial({ roughness: 0.08, metalness: 0, clearcoat: 1, envMapIntensity: 1.6, transparent: true, opacity: 0.88, emissive: 0x2a1204, emissiveIntensity: 1 });
  const N = 42;
  const bottles = new THREE.InstancedMesh(bottleGeo, bottleMat, N);
  const colors = [0x8a4a12, 0x5a2a0a, 0x2a4a22, 0x3a3a3a, 0xa86a1a, 0x4a1a12];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  let rnd = 7;
  const r = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  for (let i = 0; i < N; i++) {
    const shelf = i % 3;
    const x = -W / 2 + 0.12 + (Math.floor(i / 3) / (N / 3)) * (W - 0.24) + (r() - 0.5) * 0.04;
    p.set(x, [1.1, 1.5, 1.9][shelf] + 0.0125, 0.11 + (r() - 0.5) * 0.06);
    const s = 0.85 + r() * 0.4;
    sc.set(s * (0.85 + r() * 0.3), s, s * (0.85 + r() * 0.3));
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6);
    bottles.setMatrixAt(i, m.compose(p, q, sc));
    bottles.setColorAt(i, new THREE.Color(colors[Math.floor(r() * colors.length)]));
  }
  g.add(bottles);
  // мягкая подсветка полок — аддитивные полосы
  for (const y of [1.15, 1.55, 1.95]) {
    const strip = wash(W * 0.55, 'rgba(255,150,60,0.5)', 0.35);
    strip.scale.set(1, 0.14, 1);
    strip.position.set(0, y + 0.12, 0.02);
    g.add(strip);
  }
  g.position.set(0, 0, d.BACK + 0.01);
  return g;
}

/** Картина в тяжёлой золочёной раме: тёмная «масляная» живопись, подсвеченная латунной лампой. */
function painting(w: number, h: number, seed: number) {
  const g = new THREE.Group();
  const c = document.createElement('canvas'); c.width = 256; c.height = Math.round(256 * h / w);
  const x = c.getContext('2d')!;
  const gr = x.createLinearGradient(0, 0, 0, c.height);
  gr.addColorStop(0, '#1a120c'); gr.addColorStop(0.6, '#3a2414'); gr.addColorStop(1, '#0e0806');
  x.fillStyle = gr; x.fillRect(0, 0, c.width, c.height);
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  // мазки: смутный пейзаж с всадником/кораблём — читается только как живопись
  for (let i = 0; i < 260; i++) {
    x.globalAlpha = 0.05 + rnd() * 0.1;
    x.fillStyle = ['#6a4a28', '#2a1a10', '#8a6a3a', '#1a2a2a', '#4a2a18'][Math.floor(rnd() * 5)];
    x.beginPath(); x.ellipse(rnd() * c.width, c.height * (0.3 + rnd() * 0.6), 10 + rnd() * 50, 4 + rnd() * 14, rnd() * 3, 0, Math.PI * 2); x.fill();
  }
  x.globalAlpha = 1;
  const canvasTex = new THREE.CanvasTexture(c); canvasTex.colorSpace = THREE.SRGBColorSpace;
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: canvasTex, roughness: 0.6, emissive: 0xffffff, emissiveMap: canvasTex, emissiveIntensity: 0.25 }));
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xa8843e, metalness: 0.9, roughness: 0.38, envMapIntensity: 1.1 });
  const t = 0.07;
  for (const [fw, fh, fx, fy] of [[w + 2 * t, t, 0, h / 2 + t / 2], [w + 2 * t, t, 0, -h / 2 - t / 2], [t, h, -w / 2 - t / 2, 0], [t, h, w / 2 + t / 2, 0]]) {
    const b = new THREE.Mesh(new RoundedBoxGeometry(fw, fh, 0.05, 2, 0.012), frameMat);
    b.position.set(fx, fy, 0.02);
    g.add(b);
  }
  // латунная лампа над картиной и тёплое пятно на холсте
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, w * 0.6, 12), brass);
  lamp.rotation.z = Math.PI / 2;
  lamp.position.set(0, h / 2 + t + 0.06, 0.1);
  const w2 = wash(w * 0.6, 'rgba(255,190,120,0.6)', 0.35);
  w2.position.set(0, h * 0.2, 0.03);
  g.add(art, lamp, w2);
  return g;
}

export class ClubDecor {
  readonly group = new THREE.Group();
  private haze: THREE.Sprite[] = [];

  constructor(d: RoomDims, quality: number) {
    const G = this.group;
    // бра по стенам
    // на дальней стене по бокам бара — окна (daycycle.ts), бра только на боковых стенах
    for (const sx of [-1, 1]) for (const z of [-1.8, 0.6, 3.0]) {
      const s = sconce();
      s.rotation.y = -sx * Math.PI / 2;
      s.position.set(sx * (d.SIDE - 0.02), 1.3, z);
      G.add(s);
    }
    // бар по центру дальней стены
    G.add(backBar(d, quality));
    // картины на боковых стенах между бра
    for (const [sx, z, seed] of [[-1, -0.6, 11], [1, -0.6, 29], [-1, 1.8, 47], [1, 1.8, 83]] as [number, number, number][]) {
      const p = painting(0.9, 0.65, seed);
      p.rotation.y = -sx * Math.PI / 2;
      p.position.set(sx * (d.SIDE - 0.03), 1.45, z);
      G.add(p);
    }
    // ковёр под столом
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 4.7), new THREE.MeshStandardMaterial({ map: rugTexture(quality > 1 ? 768 : 512), color: 0x9a8a80, roughness: 1, envMapIntensity: 0.2 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, d.FLOOR_Y + 0.004, 0.55);
    rug.receiveShadow = true;
    G.add(rug);
    // табачная дымка над столом: несколько огромных мягких спрайтов, медленно плывут
    const smoke = smokeTexture();
    for (let i = 0; i < (quality > 1 ? 7 : 4); i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smoke, transparent: true, opacity: 0.035, depthWrite: false, color: 0xd8c8b8 }));
      sp.scale.setScalar(2.2 + Math.random() * 1.5);
      sp.position.set((Math.random() - 0.5) * 3, 0.9 + Math.random() * 0.9, -1.5 + Math.random() * 2.5);
      sp.userData.v = new THREE.Vector3((Math.random() - 0.5) * 0.02, 0, (Math.random() - 0.5) * 0.015);
      sp.userData.ph = Math.random() * 6;
      this.haze.push(sp);
      G.add(sp);
    }
    // дымку не трогаем (она плывёт), всё остальное — склеить
    for (const s of this.haze) G.remove(s);
    mergeStatic(G);
    for (const s of this.haze) G.add(s);
  }

  update(t: number, dt: number) {
    for (const s of this.haze) {
      s.position.addScaledVector(s.userData.v as THREE.Vector3, dt);
      if (Math.abs(s.position.x) > 2) (s.userData.v as THREE.Vector3).x *= -1;
      if (s.position.z > 1.2 || s.position.z < -2.2) (s.userData.v as THREE.Vector3).z *= -1;
      s.material.rotation = Math.sin(t * 0.05 + s.userData.ph) * 0.4;
    }
  }
}
