// Руки от первого лица на реалистичной модели (скан кисти + текстуры кожи).
// Скелет расставлен автоматически (tools/hand_rig.py): запястье + по три фаланги на палец.
// Позы смешиваются плавно (экспоненциальное сглаживание), жесты идут по ключам Catmull-Rom.

import * as THREE from 'three';
import { Loading } from '../ui/loading';
import { woolTextures } from './woods';

// ───────────────────────── позы ─────────────────────────

/** Поза кисти: сгиб фаланг (рад), сведение пальцев 0..1, большой палец: сгиб и противопоставление. */
interface HandPose { f: number[][]; spread: number; t: number[]; opp: number }

const P = (f: number[][], spread: number, t: number[], opp: number): HandPose => ({ f, spread, t, opp });

export const POSES = {
  // спокойно лежит на сукне: пальцы чуть согнуты и сведены
  rest: P([[0.16, 0.22, 0.1], [0.14, 0.24, 0.12], [0.2, 0.3, 0.14], [0.26, 0.36, 0.18]], 0.55, [-0.3, 0.05, 0.05], 0.3),
  // левая у карт: пальцы накрывают карты, большой палец подведён под уголок
  peekIdle: P([[0.22, 0.3, 0.14], [0.22, 0.32, 0.16], [0.28, 0.38, 0.18], [0.34, 0.42, 0.2]], 0.6, [-0.2, 0.1, 0.06], 0.4),
  peek: P([[0.42, 0.55, 0.28], [0.46, 0.62, 0.3], [0.58, 0.72, 0.34], [0.7, 0.8, 0.38]], 0.65, [-0.1, 0.12, 0.0], 0.5),
  // пальцы раскрываются, чтобы взять фишки
  reach: P([[0.08, 0.12, 0.06], [0.06, 0.12, 0.06], [0.1, 0.16, 0.08], [0.14, 0.2, 0.1]], 0.4, [-0.35, 0.0, 0.0], 0.2),
  // щепоть: фишки зажаты между большим и пальцами
  grab: P([[0.62, 0.78, 0.46], [0.66, 0.82, 0.48], [0.76, 0.9, 0.5], [0.86, 0.96, 0.52]], 0.75, [-0.18, 0.35, 0.25], 0.75),
  // кулак для стука по столу
  knuckle: P([[1.15, 1.35, 0.8], [1.2, 1.4, 0.82], [1.25, 1.42, 0.84], [1.3, 1.45, 0.86]], 0.85, [-0.3, 0.55, 0.45], 0.9),
};

function lerpPose(a: HandPose, b: HandPose, k: number): HandPose {
  return {
    f: a.f.map((row, i) => row.map((v, j) => v + (b.f[i][j] - v) * k)),
    spread: a.spread + (b.spread - a.spread) * k,
    t: a.t.map((v, i) => v + (b.t[i] - v) * k),
    opp: a.opp + (b.opp - a.opp) * k,
  };
}

// ───────────────────────── загрузка модели ─────────────────────────

interface BoneDef { name: string; parent: number; pos: number[] }
export interface HandAsset { geo: THREE.BufferGeometry; bones: BoneDef[] }

/** Чтение ответа по кусочкам — для полосы загрузки. */
async function readWithProgress(res: Response, onP?: (p: number) => void): Promise<ArrayBuffer> {
  const total = Number(res.headers.get('content-length')) || 0;
  if (!onP || !total || !res.body) { const b = await res.arrayBuffer(); onP?.(1); return b; }
  const reader = res.body.getReader();
  const out = new Uint8Array(total);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > out.length) { // сервер сжал ответ — длина не совпала: дособираем как есть
      const rest = [value];
      for (;;) { const r = await reader.read(); if (r.done) break; rest.push(r.value); }
      const all = new Uint8Array(got + rest.reduce((a, v) => a + v.length, 0));
      all.set(out.subarray(0, got)); let o = got; for (const v of rest) { all.set(v, o); o += v.length; }
      onP(1);
      return all.buffer;
    }
    out.set(value, got); got += value.length;
    onP(got / total);
  }
  return out.buffer.slice(0, got);
}

export async function loadAssets(base: string, rich: boolean, file = 'hands.bin'): Promise<{ left: HandAsset; right: HandAsset; mat: THREE.Material }> {
  // hands.bin (hands_mid.bin / hands_lo.bin — упрощённые); запасное имя .wasm — для хостингов, которые не отдают .bin
  let res = await fetch(base + file);
  if (!res.ok) res = await fetch(base + file.replace(/\.bin$/, '.wasm'));
  const buf = await readWithProgress(res, file === 'hands.bin' ? p => Loading.set('hands', p * 0.85) : undefined);
  const n = new DataView(buf).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n)));
  const start = 4 + n;
  const build = (h: { count: number; index: number; indexType: string; bones: BoneDef[]; offsets: Record<string, number> }): HandAsset => {
    const g = new THREE.BufferGeometry();
    const o = h.offsets;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf, start + o.P, h.count * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(buf, start + o.N, h.count * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buf, start + o.UV, h.count * 2), 2));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint8Array(buf, start + o.SI, h.count * 4), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(new Uint8Array(buf, start + o.SW, h.count * 4), 4, true));
    const idx = h.indexType === 'uint16' ? new Uint16Array(buf, start + o.I, h.index) : new Uint32Array(buf, start + o.I, h.index);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    return { geo: g, bones: h.bones };
  };
  const tl = new THREE.TextureLoader();
  const load = (f: string, srgb: boolean) => new Promise<THREE.Texture>((res) => {
    tl.load(base + f, t => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      res(t);
    }, undefined, () => res(new THREE.Texture()));
  });
  const [map, normalMap, roughnessMap] = await Promise.all([
    load('hand_diffuse.jpg', true), load('hand_normal.jpg', false), load('hand_rough.jpg', false),
  ]);
  // кожа: лёгкий бархатный отлив (sheen) имитирует подповерхностное рассеивание
  const mat = rich
    ? new THREE.MeshPhysicalMaterial({
      map, normalMap, roughnessMap, roughness: 1, metalness: 0,
      normalScale: new THREE.Vector2(0.9, 0.9),
      // «сочная» кожа: тёплый подповерхностный отлив и мягкий жирноватый блик
      sheen: 0.6, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffa890),
      color: new THREE.Color(1.06, 1.0, 0.96), envMapIntensity: 0.7,
      clearcoat: 0.12, clearcoatRoughness: 0.55,
    })
    // телефоны: тот же вид без отлива — дешевле в каждом пикселе
    : new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, roughness: 1, metalness: 0, envMapIntensity: 0.55, emissive: 0x1a0805, emissiveIntensity: 0.25 });
  return { left: build(head.hands.left), right: build(head.hands.right), mat };
}

// ───────────────────────── одна кисть ─────────────────────────

const Y = new THREE.Vector3(0, 1, 0);

export class RealHand {
  readonly root = new THREE.Group();
  readonly bones: THREE.Bone[] = [];
  private axes: THREE.Vector3[] = [];     // ось сгиба каждой кости
  private spreadAng: number[] = [];       // угол каждого пальца относительно среднего
  private pose: HandPose = { ...POSES.rest, f: POSES.rest.f.map(r => [...r]), t: [...POSES.rest.t] };
  target: HandPose = POSES.rest;
  speed = 9;
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();

  constructor(asset: HandAsset, mat: THREE.Material) {
    const defs = asset.bones;
    // кости: позиция каждой — относительно родителя
    defs.forEach((d, i) => {
      const b = new THREE.Bone();
      b.name = d.name;
      const p = new THREE.Vector3(...d.pos);
      if (d.parent >= 0) p.sub(new THREE.Vector3(...defs[d.parent].pos));
      b.position.copy(p);
      this.bones.push(b);
      if (d.parent >= 0) this.bones[d.parent].add(b);
    });
    // оси сгиба: перпендикуляр к направлению фаланги в плоскости ладони
    const middleDir = this.dirOf(defs, 4);
    const angOf = (v: THREE.Vector3) => Math.atan2(v.x, -v.z);
    defs.forEach((_, i) => {
      if (i === 0) { this.axes.push(new THREE.Vector3(1, 0, 0)); this.spreadAng.push(0); return; }
      const dir = this.dirOf(defs, i);
      this.axes.push(new THREE.Vector3().crossVectors(dir, Y).normalize());
      this.spreadAng.push(angOf(dir) - angOf(middleDir));
    });
    const mesh = new THREE.SkinnedMesh(asset.geo, mat);
    mesh.add(this.bones[0]);
    mesh.bind(new THREE.Skeleton(this.bones));
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    this.root.add(mesh);
  }

  /** направление фаланги: к дочерней кости (у последней — продолжение предыдущей) */
  private dirOf(defs: BoneDef[], i: number): THREE.Vector3 {
    const child = defs.findIndex(d => d.parent === i);
    const a = new THREE.Vector3(...defs[i].pos);
    if (child >= 0) return new THREE.Vector3(...defs[child].pos).sub(a).normalize();
    return a.sub(new THREE.Vector3(...defs[defs[i].parent].pos)).normalize();
  }

  /** плавно подтянуть позу к цели и выставить кости */
  update(dt: number) {
    const k = 1 - Math.exp(-this.speed * dt);
    this.pose = lerpPose(this.pose, this.target, k);
    const p = this.pose;
    for (let fi = 0; fi < 4; fi++) {
      for (let j = 0; j < 3; j++) {
        const bi = 1 + fi * 3 + j;
        this.q.setFromAxisAngle(this.axes[bi], -p.f[fi][j]);
        if (j === 0) {
          // сведение пальцев к среднему
          this.q2.setFromAxisAngle(Y, this.spreadAng[bi] * p.spread * 0.75);
          this.q.premultiply(this.q2);
        }
        this.bones[bi].quaternion.copy(this.q);
      }
    }
    // большой палец: противопоставление (к пальцам) + сгиб
    for (let j = 0; j < 3; j++) {
      const bi = 13 + j;
      this.q.setFromAxisAngle(this.axes[bi], -p.t[j]);
      if (j === 0) {
        this.q2.setFromAxisAngle(Y, this.spreadAng[bi] * p.opp * 0.6);
        this.q.premultiply(this.q2);
      }
      this.bones[bi].quaternion.copy(this.q);
    }
  }

  ringBone() { return this.bones[7]; } // безымянный, первая фаланга
  ringOffset() { return this.bones[8].position.clone().multiplyScalar(0.38); }
}

// ───────────────────────── рукав ─────────────────────────

// шерстяной пиджак: тёмно-графитовая саржа с мягким бархатным отливом (sheen) — как настоящая ткань под лампой
const wool = woolTextures(256);
wool.map.repeat.set(5, 9); wool.bump.repeat.set(5, 9);
const sleeveMat = new THREE.MeshPhysicalMaterial({
  map: wool.map, bumpMap: wool.bump, bumpScale: 1.4, color: 0x171920, roughness: 0.85, metalness: 0,
  sheen: 0.7, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x4a4e66), envMapIntensity: 0.4,
});
const cuffMat = new THREE.MeshStandardMaterial({ color: 0xeae5da, roughness: 0.72 });

/**
 * Рукав с манжетой, пристыкованный к срезу запястья модели.
 * Срез ищется по геометрии (вершины у самого дальнего края по +z), поэтому кисть не сдвигается,
 * а манжета заходит на запястье на ~1.5 см — щели нет при любой позе и жесте.
 */
function armFor(geo: THREE.BufferGeometry): THREE.Group {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  let maxZ = -Infinity;
  for (let i = 0; i < pos.count; i++) maxZ = Math.max(maxZ, pos.getZ(i));
  let cx = 0, cy = 0, n = 0;
  const band = 0.012;
  for (let i = 0; i < pos.count; i++) if (pos.getZ(i) > maxZ - band) { cx += pos.getX(i); cy += pos.getY(i); n++; }
  cx /= n; cy /= n;
  let rx = 0, ry = 0;
  for (let i = 0; i < pos.count; i++) if (pos.getZ(i) > maxZ - band) {
    rx = Math.max(rx, Math.abs(pos.getX(i) - cx)); ry = Math.max(ry, Math.abs(pos.getY(i) - cy));
  }
  const g = new THREE.Group();
  const shape = new THREE.Group();          // единичный радиус → эллипс запястья
  shape.scale.set(rx, 1, ry);
  const overlap = 0.016, cuffL = 0.045, sleeveL = 0.42;
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(1.13, 1.18, cuffL, 28), cuffMat);
  cuff.position.y = cuffL / 2;
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, sleeveL, 28, 1, true), sleeveMat);
  sleeve.position.y = cuffL * 0.72 + sleeveL / 2;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(1.31, 0.07, 8, 28), sleeveMat);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = cuffL * 0.72;
  shape.add(cuff, sleeve, lip);
  const link = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.003, 16),
    new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 1, roughness: 0.28 }));
  link.position.set(rx * 1.17, cuffL * 0.45, 0);
  link.rotation.z = Math.PI / 2;
  g.add(shape, link);
  for (const m of [cuff, sleeve, lip, link]) m.castShadow = true;
  g.position.set(cx, cy, maxZ - overlap);
  // предплечье уходит назад к камере и чуть вверх
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.07, 1).normalize());
  return g;
}

// ───────────────────────── жесты ─────────────────────────

type Gesture = 'knock' | 'push' | 'flick' | 'bet' | 'riffle';
export const GESTURE_DUR: Record<Gesture, number> = { knock: 0.95, push: 1.05, flick: 0.9, bet: 2.0, riffle: 3.2 };

// [время 0..1, dx, dy, dz, крен кисти]
const BET_PATH: number[][] = [
  [0, 0, 0, 0, 0],
  [0.28, 0.07, 0.035, 0.0, 0.04],
  [0.4, 0.075, 0.008, -0.01, 0.1],     // пальцы смыкаются на фишках
  [0.52, 0.06, 0.055, -0.05, 0.08],    // поднимает
  [0.78, -0.56, 0.035, -0.3, 0.03],    // несёт к ставке
  [0.86, -0.57, 0.006, -0.31, 0.0],    // бережно кладёт
  [1, 0, 0, 0, 0],
];
const RIFFLE_PATH: number[][] = [
  [0, 0, 0, 0, 0],
  [0.16, -0.01, 0.035, -0.04, 0.06],
  [0.24, -0.012, 0.026, -0.05, 0.1],
  [0.8, -0.012, 0.028, -0.05, 0.1],
  [0.9, -0.008, 0.04, -0.035, 0.04],
  [1, 0, 0, 0, 0],
];
// тасовка — на свободном сукне между картами и своей стопкой (не внутри стопки)
const RIFFLE_SPOT = new THREE.Vector3(0.36, 0, 1.5);

function keyframes(keys: number[][], k: number): number[] {
  let i = 0;
  while (i < keys.length - 2 && k > keys[i + 1][0]) i++;
  const a = keys[Math.max(0, i - 1)], b = keys[i], c = keys[i + 1], d = keys[Math.min(keys.length - 1, i + 2)];
  const t = (k - b[0]) / Math.max(1e-6, c[0] - b[0]);
  const t2 = t * t, t3 = t2 * t;
  const out: number[] = [];
  for (let j = 1; j < b.length; j++) {
    const p0 = a[j], p1 = b[j], p2 = c[j], p3 = d[j];
    out.push(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3));
  }
  return out;
}

const smooth01 = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

// ───────────────────────── обе руки ─────────────────────────

const SCALE = 1.72;   // крупнее реальных — ближний план, как на референсе
const RIGHT_AT = { pos: new THREE.Vector3(0.46, 0.064, 1.7), yaw: 0.38 };
const LEFT_AT = { pos: new THREE.Vector3(-0.31, 0.064, 1.74), yaw: -0.72 };

export class Hands {
  readonly group = new THREE.Group();
  private leftRig = new THREE.Group();
  private rightRig = new THREE.Group();
  private left: RealHand | null = null;
  private right: RealHand | null = null;
  private leftBase = new THREE.Group();
  private rightBase = new THREE.Group();
  private ringBand = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 1, roughness: 0.22, envMapIntensity: 1.8 });
  private ringGem = new THREE.MeshStandardMaterial({ color: 0x7a5a12, metalness: 0.6, roughness: 0.15, envMapIntensity: 2.2 });
  private gesture: { kind: Gesture; t: number; dur: number } | null = null;
  private riffleChips: THREE.InstancedMesh | null = null;
  private ticked = 0;
  private t = 0;
  onTick?: () => void;
  onReady?: () => void;
  get isReady() { return !!this.right; }
  private m4 = new THREE.Matrix4();
  private q4 = new THREE.Quaternion();
  private e4 = new THREE.Euler();
  private one = new THREE.Vector3(1, 1, 1);
  private v4 = new THREE.Vector3();

  constructor(base = 'models/', rich = true) {
    for (const [b, at] of [[this.rightBase, RIGHT_AT], [this.leftBase, LEFT_AT]] as const) {
      b.position.copy(at.pos);
      b.rotation.set(-0.05, at.yaw, 0);
      b.scale.setScalar(SCALE);
    }
    this.rightRig.add(this.rightBase);
    this.leftRig.add(this.leftBase);
    this.group.add(this.rightRig, this.leftRig);
    loadAssets(base, rich, rich ? 'hands.bin' : 'hands_mid.bin').then(({ left, right, mat }) => {
      this.left = new RealHand(left, mat);
      this.right = new RealHand(right, mat);
      this.left.target = POSES.peekIdle;
      this.leftBase.add(this.left.root, armFor(left.geo));
      this.rightBase.add(this.right.root, armFor(right.geo));
      this.addRing(this.right);
      Loading.done('hands');
      this.onReady?.();
    }).catch(e => { console.error('hands', e); Loading.done('hands'); this.onReady?.(); });
  }

  private addRing(h: RealHand) {
    const ring = new THREE.Group();
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.0098, 0.0026, 10, 32), this.ringBand);
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.0068, 0.0076, 0.0045, 20), this.ringBand);
    bezel.position.y = 0.0112;
    const gem = new THREE.Mesh(new THREE.CylinderGeometry(0.0054, 0.0054, 0.0018, 20), this.ringGem);
    gem.position.y = 0.0136;
    ring.add(band, bezel, gem);
    for (const m of [band, bezel, gem]) m.castShadow = true;
    ring.position.copy(h.ringOffset());
    // кольцо надето вдоль фаланги
    const dir = h.ringOffset().normalize();
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    h.ringBone().add(ring);
  }

  setRing(_id: string) { /* печатка клуба */ }

  play(kind: Gesture) {
    this.gesture = { kind, t: 0, dur: GESTURE_DUR[kind] };
    this.ticked = 0;
    if (this.riffleChips) this.riffleChips.count = 0;
  }

  get busy() { return !!this.gesture; }
  get gestureKind() { return this.gesture?.kind; }

  attachChips(geo: THREE.BufferGeometry, mat: THREE.Material, colors: THREE.Color[]) {
    const m = new THREE.InstancedMesh(geo, mat, 8);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(24), 3);
    for (let i = 0; i < 8; i++) m.setColorAt(i, colors[i % colors.length]);
    m.count = 0;
    m.castShadow = true;
    m.frustumCulled = false;
    this.riffleChips = m;
    this.group.add(m);
  }

  /** Тасовка: две стопки по четыре наклоняются друг к другу и сливаются, фишка за фишкой. */
  private animateRiffle(k: number) {
    const m = this.riffleChips;
    if (!m) return;
    if (k < 0.2 || k > 0.86) { m.count = 0; return; }
    m.count = 8;
    const H = 0.0078, gap = 0.034;
    const tilt = k < 0.32 ? 0 : k < 0.44 ? (k - 0.32) / 0.12 : Math.max(0, 1 - (k - 0.44) / 0.06);
    for (let j = 0; j < 8; j++) {
      const side = j % 2 === 0 ? -1 : 1;
      const level = Math.floor(j / 2);
      const start = 0.46 + j * 0.03;
      const e = smooth01((k - start) / 0.05);
      if (k - start >= 0.05 && this.ticked <= j) { this.ticked = j + 1; this.onTick?.(); }
      const y = H / 2 + (level * H) * (1 - e) + (j * H) * e + tilt * 0.004 * level;
      this.v4.set(RIFFLE_SPOT.x + side * gap * 0.5 * (1 - e), y, RIFFLE_SPOT.z);
      this.e4.set(0, j * 0.7, side * 0.35 * tilt * (1 - e));
      this.q4.setFromEuler(this.e4);
      this.m4.compose(this.v4, this.q4, this.one);
      m.setMatrixAt(j, this.m4);
    }
    m.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, peek: number) {
    this.t += dt;
    const L = this.left, R = this.right;
    this.leftRig.position.set(0, 0, 0);
    this.rightRig.position.set(0, 0, 0);
    this.rightBase.rotation.z = 0;
    // дыхание: едва заметное движение кистей
    const breathe = Math.sin(this.t * 1.1) * 0.0012;
    this.rightBase.position.y = RIGHT_AT.pos.y + breathe;
    this.leftBase.position.y = LEFT_AT.pos.y + breathe * 0.8;

    // левая рука ведёт ближний край карт вверх
    const p = smooth01(peek);
    this.leftBase.rotation.x = -0.05 - p * 0.16;
    this.leftRig.position.set(0.02 * p, 0.02 * p, -0.035 * p);
    let leftPose: HandPose = lerpPose(POSES.peekIdle, POSES.peek, p);
    let rightPose: HandPose = POSES.rest;

    const g = this.gesture;
    if (g) {
      g.t += dt;
      const k = Math.min(1, g.t / g.dur);
      const bell = Math.sin(k * Math.PI);
      if (g.kind === 'knock') {
        // кулак, два удара костяшками по сукну
        const tap = Math.abs(Math.sin(k * Math.PI * 2));
        this.leftRig.position.y += tap * 0.04;
        this.leftRig.position.z -= bell * 0.03;
        leftPose = lerpPose(leftPose, POSES.knuckle, smooth01(bell * 2.2));
      } else if (g.kind === 'bet') {
        const o = keyframes(BET_PATH, k);
        this.rightRig.position.set(o[0], o[1], o[2]);
        this.rightBase.rotation.z = o[3];
        // раскрыть ладонь → взять → нести → отпустить
        const grip = k < 0.28 ? 0 : k < 0.4 ? smooth01((k - 0.28) / 0.12) : k < 0.82 ? 1 : 1 - smooth01((k - 0.82) / 0.08);
        const open = k < 0.3 ? smooth01(k / 0.25) : 0;
        rightPose = lerpPose(lerpPose(POSES.rest, POSES.reach, open), POSES.grab, grip);
      } else if (g.kind === 'riffle') {
        const o = keyframes(RIFFLE_PATH, k);
        this.rightRig.position.set(o[0], o[1], o[2]);
        this.rightBase.rotation.z = o[3];
        const hold = smooth01((k - 0.12) / 0.12) * (1 - smooth01((k - 0.84) / 0.1));
        const wiggle = Math.sin(this.t * 9) * 0.06 * hold;
        rightPose = lerpPose(POSES.rest, POSES.grab, hold * 0.55);
        rightPose = { ...rightPose, f: rightPose.f.map((r, i) => r.map(v => v + (i % 2 ? wiggle : -wiggle))) };
        this.animateRiffle(k);
      } else if (g.kind === 'push') {
        const e = bell * bell * (3 - 2 * bell);
        this.rightRig.position.set(-0.17 * e, 0.012 * bell, -0.3 * e);
        rightPose = lerpPose(POSES.rest, POSES.reach, bell);
      } else {
        // откинуть карты
        this.leftRig.position.set(0.05 * bell, 0.02 * bell, -0.16 * bell);
        leftPose = lerpPose(leftPose, POSES.reach, bell);
      }
      if (k >= 1) { this.gesture = null; if (this.riffleChips) this.riffleChips.count = 0; }
    }
    if (L) { L.target = leftPose; L.speed = g ? 10 : 5.5; L.update(dt); }
    if (R) { R.target = rightPose; R.speed = g ? 10 : 5.5; R.update(dt); }
  }
}
