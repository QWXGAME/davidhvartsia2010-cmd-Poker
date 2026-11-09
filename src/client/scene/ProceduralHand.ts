// Руки от первого лица, как на референсе: левая у карт, правая лежит на сукне с перстнем.
// Пальцы — цепочки капсул; поза запекается в одну геометрию (1 draw call на материал).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const skinMat = new THREE.MeshStandardMaterial({ color: 0x8c5f4b, roughness: 0.62, metalness: 0, emissive: 0x1a0805, emissiveIntensity: 0.35 });
const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x141826, roughness: 0.86, metalness: 0.02 });
export const nailMat = new THREE.MeshStandardMaterial({ color: 0xd9a99a, roughness: 0.35, metalness: 0 });
export const cuffMat = new THREE.MeshStandardMaterial({ color: 0xeae5da, roughness: 0.7 });

export type Pose = { curl: [number, number, number][]; spread: number[]; thumb: [number, number, number]; thumbYaw: number };

export const POSE_REST: Pose = {
  curl: [[0.1, 0.22, 0.14], [0.08, 0.2, 0.14], [0.12, 0.24, 0.16], [0.16, 0.28, 0.18]],
  spread: [-0.05, -0.01, 0.03, 0.08],
  thumb: [0.25, 0.15, 0.1], thumbYaw: 0.55,
};
const POSE_PEEK: Pose = {
  curl: [[0.3, 0.45, 0.3], [0.32, 0.5, 0.32], [0.42, 0.6, 0.38], [0.55, 0.7, 0.42]],
  spread: [-0.03, 0.0, 0.03, 0.07],
  thumb: [0.15, 0.1, 0.25], thumbYaw: 0.55,
};

const FINGERS = [
  { x: -0.027, len: [0.05, 0.031, 0.024], r: 0.0093 }, // указательный
  { x: -0.0088, len: [0.055, 0.034, 0.025], r: 0.0097 }, // средний
  { x: 0.0098, len: [0.051, 0.032, 0.024], r: 0.0091 },  // безымянный
  { x: 0.0275, len: [0.041, 0.025, 0.02], r: 0.0081 },   // мизинец
];

const UP = new THREE.Vector3(0, 1, 0);

/** Гладкая сужающаяся трубка по кривой с округлым кончиком — палец без «бусин». */
function taperTube(pts: THREE.Vector3[], radii: number[], flat = 0.8, segs = 22, rad = 14): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  const rAt = (u: number) => {
    const f = u * (radii.length - 1), i = Math.min(radii.length - 2, Math.floor(f));
    return THREE.MathUtils.lerp(radii[i], radii[i + 1], f - i);
  };
  const T = new THREE.Vector3(), B = new THREE.Vector3(), N = new THREE.Vector3(), P = new THREE.Vector3(), V = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    curve.getPointAt(u, P);
    curve.getTangentAt(u, T);
    B.crossVectors(T, UP).normalize();
    N.crossVectors(B, T).normalize();
    const r = rAt(u);
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      V.copy(B).multiplyScalar(c * r).addScaledVector(N, sn * r * flat);
      pos.push(P.x + V.x, P.y + V.y, P.z + V.z);
      const n = new THREE.Vector3().copy(B).multiplyScalar(c * flat).addScaledVector(N, sn).normalize();
      nrm.push(n.x, n.y, n.z);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < rad; j++) {
    const a = i * (rad + 1) + j, b = a + rad + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  // кончик
  const tipR = radii[radii.length - 1];
  const end = curve.getPointAt(1), dir = curve.getTangentAt(1);
  const cap = new THREE.SphereGeometry(tipR, 14, 10);
  cap.scale(1, flat, 1);
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(dir, UP).normalize(), UP, dir.clone().negate());
  cap.applyMatrix4(m).translate(end.x, end.y, end.z);
  return mergeGeometries([clean(g), clean(cap)])!;
}

function clean(g: THREE.BufferGeometry) {
  let x = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal') x.deleteAttribute(k);
  return x;
}

/** Точки сустава пальца: старт внутри ладони, дальше по фалангам со сгибом вниз. */
function fingerPath(base: THREE.Vector3, yaw: number, len: number[], curl: number[]) {
  const pts = [base.clone().add(new THREE.Vector3(0, 0, 0.014)), base.clone()];
  let pitch = 0;
  const p = base.clone();
  len.forEach((L, j) => {
    pitch += curl[j];
    const d = new THREE.Vector3(0, -Math.sin(pitch), -Math.cos(pitch)).applyAxisAngle(UP, yaw);
    p.addScaledVector(d, L);
    pts.push(p.clone());
  });
  return pts;
}

/**
 * Кисть: запястье в начале координат, пальцы вдоль -Z, тыльная сторона вверх.
 * Возвращает геометрию кожи, ногтей и матрицу безымянного пальца для перстня.
 */
export function buildHand(pose: Pose, mirror: boolean): { geo: THREE.BufferGeometry; nails: THREE.BufferGeometry; ringAt: THREE.Matrix4 } {
  const S = 1.6;
  const skin: THREE.BufferGeometry[] = [];
  const nails: THREE.BufferGeometry[] = [];

  // ладонь: гладкий эллипсоид — плоский снизу, мягкий купол сверху, сужается к запястью
  const palm = new THREE.SphereGeometry(1, 48, 32);
  const pp = palm.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pp.count; i++) {
    let x = pp.getX(i) * 0.045, y = pp.getY(i) * 0.017;
    const z = pp.getZ(i) * 0.056;
    // «подушка» ладони: широкая и плоская, без углов
    const squareness = 1 + 0.18 * (1 - Math.abs(pp.getZ(i)));
    x *= squareness;
    const toWrist = THREE.MathUtils.clamp(z / 0.056, 0, 1);
    x *= 1 - toWrist * 0.22;
    if (y < 0) y *= 0.6;
    pp.setXYZ(i, x, y, z);
  }
  palm.computeVertexNormals();
  palm.translate(0, 0.003, -0.05);
  skin.push(clean(palm));
  // мышца большого пальца
  const thenar = new THREE.SphereGeometry(1, 18, 12);
  thenar.scale(0.02, 0.016, 0.034).rotateY(0.35).translate(-0.03, -0.004, -0.03);
  skin.push(clean(thenar));
  // запястье
  const wrist = new THREE.CylinderGeometry(0.029, 0.031, 0.06, 20);
  wrist.rotateX(Math.PI / 2).scale(1, 0.78, 1).translate(0, 0, 0.02);
  skin.push(clean(wrist));

  let ringAt = new THREE.Matrix4();
  FINGERS.forEach((f, i) => {
    const base = new THREE.Vector3(f.x, 0.004, -0.096);
    const pts = fingerPath(base, pose.spread[i], f.len, pose.curl[i]);
    const r = f.r;
    skin.push(taperTube(pts, [r * 1.05, r * 1.04, r * 0.96, r * 0.88, r * 0.8]));
    // ноготь
    const tip = pts[pts.length - 1], prev = pts[pts.length - 2];
    const dir = tip.clone().sub(prev).normalize();
    const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
    const up = new THREE.Vector3().crossVectors(side, dir).normalize();
    const nail = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    nail.scale(r * 0.72, r * 0.18, r * 1.05);
    nail.applyMatrix4(new THREE.Matrix4().makeBasis(side, up, dir.clone().negate()));
    const at = tip.clone().addScaledVector(dir, -r * 0.7).addScaledVector(up, r * 0.62);
    nail.translate(at.x, at.y, at.z);
    nails.push(clean(nail));
    // перстень — на первой фаланге безымянного
    if (i === 2) {
      const a = pts[1], b = pts[2];
      const d = b.clone().sub(a).normalize();
      const sd = new THREE.Vector3().crossVectors(d, UP).normalize();
      const u = new THREE.Vector3().crossVectors(sd, d).normalize();
      const p = a.clone().lerp(b, 0.42);
      ringAt = new THREE.Matrix4().makeBasis(sd, u, d.clone().negate()).setPosition(p);
    }
  });

  // большой палец: от основания ладони вбок и вперёд
  const tb = new THREE.Vector3(-0.036, -0.006, -0.03);
  const tdir = (yaw: number, pitch: number) => new THREE.Vector3(0, -Math.sin(pitch), -Math.cos(pitch)).applyAxisAngle(UP, yaw);
  const t1 = tb.clone().addScaledVector(tdir(pose.thumbYaw, pose.thumb[0]), 0.034);
  const t2 = t1.clone().addScaledVector(tdir(pose.thumbYaw * 0.55, pose.thumb[0] + pose.thumb[1]), 0.03);
  const t3 = t2.clone().addScaledVector(tdir(pose.thumbYaw * 0.35, pose.thumb[0] + pose.thumb[1] + pose.thumb[2]), 0.024);
  skin.push(taperTube([tb.clone().add(new THREE.Vector3(0.01, 0, 0.012)), tb, t1, t2, t3], [0.013, 0.0128, 0.012, 0.0108, 0.0096], 0.78));

  const sc = new THREE.Matrix4().makeScale(mirror ? -S : S, S, S);
  const fix = (g: THREE.BufferGeometry) => {
    g.applyMatrix4(sc);
    if (mirror) {
      // зеркало выворачивает треугольники — возвращаем обход
      const pa = g.attributes.position as THREE.BufferAttribute, na = g.attributes.normal as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i += 3) for (const at of [pa, na]) {
        const x = at.getX(i + 1), y = at.getY(i + 1), z = at.getZ(i + 1);
        at.setXYZ(i + 1, at.getX(i + 2), at.getY(i + 2), at.getZ(i + 2));
        at.setXYZ(i + 2, x, y, z);
      }
    }
    return g;
  };
  const geo = fix(mergeGeometries(skin)!);
  const nailGeo = fix(mergeGeometries(nails)!);
  ringAt.premultiply(sc);
  // перстень без масштаба руки по X-зеркалу: собираем заново позицию+поворот
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  ringAt.decompose(p, q, s);
  return { geo, nails: nailGeo, ringAt: new THREE.Matrix4().compose(p, q, new THREE.Vector3(S, S, S)) };
}

function arm(wrist: THREE.Vector3, dir: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  const len = 0.9;
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.085, len, 20, 1, true), sleeveMat);
  sleeve.position.y = len / 2 + 0.045;
  const sleeveEnd = new THREE.Mesh(new THREE.TorusGeometry(0.064, 0.007, 6, 20), sleeveMat);
  sleeveEnd.rotation.x = Math.PI / 2;
  sleeveEnd.position.y = 0.047;
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.09, 20, 1, false), cuffMat);
  cuff.position.y = 0.03;
  // запонка
  const link = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.004, 12), new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 1, roughness: 0.3 }));
  link.position.set(0.053, 0.03, 0);
  link.rotation.z = Math.PI / 2;
  g.add(sleeve, sleeveEnd, cuff, link);
  g.position.copy(wrist);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return g;
}

type Gesture = 'knock' | 'push' | 'flick' | 'bet' | 'riffle';
export const GESTURE_DUR: Record<Gesture, number> = { knock: 0.6, push: 0.85, flick: 0.6, bet: 1.45, riffle: 2.8 };

// путь правой руки при тасовании фишек: к стопке, задержка над ней, обратно
const RIFFLE_PATH: number[][] = [
  [0, 0, 0, 0, 0],
  [0.16, -0.01, 0.03, -0.04, 0.06],
  [0.24, -0.012, 0.022, -0.05, 0.1],
  [0.8, -0.012, 0.024, -0.05, 0.1],
  [0.9, -0.008, 0.035, -0.035, 0.04],
  [1, 0, 0, 0, 0],
];
const RIFFLE_SPOT = new THREE.Vector3(0.27, 0, 1.3);

// [время 0..1, dx, dy, dz, наклон кисти] — путь правой руки при ставке
const BET_PATH: number[][] = [
  [0, 0, 0, 0, 0],
  [0.3, 0.1, 0.03, 0.0, 0.05],
  [0.4, 0.105, 0.006, -0.005, 0.12],  // пальцы смыкаются на фишках
  [0.52, 0.08, 0.05, -0.04, 0.1],     // поднимает
  [0.78, -0.58, 0.03, -0.3, 0.04],    // несёт к ставке
  [0.86, -0.59, 0.004, -0.31, 0.0],   // опускает
  [1, 0, 0, 0, 0],
];

/** Плавная интерполяция по ключам (Catmull-Rom по времени). */
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

export class Hands {
  readonly group = new THREE.Group();
  private ringBand = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 1, roughness: 0.24, envMapIntensity: 1.8 });
  private ringGem = new THREE.MeshStandardMaterial({ color: 0x7a5a12, metalness: 0.6, roughness: 0.15, envMapIntensity: 2.2 });
  readonly left = new THREE.Group();
  readonly right = new THREE.Group();
  private leftRig = new THREE.Group();
  private rightRig = new THREE.Group();
  private t = 0;
  private gesture: { kind: Gesture; t: number; dur: number } | null = null;
  /** восемь фишек для тасовки — две стопки сливаются в одну */
  private riffleChips: THREE.InstancedMesh | null = null;
  private ticked = 0;
  onTick?: () => void;
  private m4 = new THREE.Matrix4();
  private q4 = new THREE.Quaternion();
  private e4 = new THREE.Euler();
  private one = new THREE.Vector3(1, 1, 1);
  private v4 = new THREE.Vector3();

  constructor() {
    // правая: спокойно лежит на сукне, пальцы к центру
    const R = buildHand(POSE_REST, false);
    this.right.add(new THREE.Mesh(R.geo, skinMat), new THREE.Mesh(R.nails, nailMat));
    // перстень-печатка на безымянном
    const ring = new THREE.Group();
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.0118, 0.0032, 10, 28), this.ringBand);
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0095, 0.006, 20), this.ringBand);
    bezel.position.y = 0.0135;
    const gem = new THREE.Mesh(new THREE.CylinderGeometry(0.0068, 0.0068, 0.0022, 20), this.ringGem);
    gem.position.y = 0.0168;
    ring.add(band, bezel, gem);
    band.rotation.x = 0; // кольцо вокруг оси пальца (Z)
    ring.applyMatrix4(R.ringAt);

    this.right.add(ring);
    this.right.position.set(0.44, 0.03, 1.6);
    this.right.rotation.set(-0.05, 0.42, 0.04);
    this.rightRig.add(this.right, arm(new THREE.Vector3(0.505, 0.035, 1.67), new THREE.Vector3(0.45, 0.02, 1)));
    this.group.add(this.rightRig);

    // левая: тянется к картам, большой палец под уголком
    const L = buildHand(POSE_PEEK, true);
    this.left.add(new THREE.Mesh(L.geo, skinMat), new THREE.Mesh(L.nails, nailMat));
    this.left.position.set(-0.19, 0.035, 1.66);
    this.left.rotation.set(-0.06, -0.7, -0.06);
    this.leftRig.add(this.left, arm(new THREE.Vector3(-0.262, 0.04, 1.73), new THREE.Vector3(-0.62, 0.02, 1)));
    this.group.add(this.leftRig);
  }

  setRing(id: string) {
    // печатка клуба: золото с гравировкой
    void id;
    this.ringBand.color.set('#d4af37');
    this.ringGem.color.set('#7a5a12');
  }

  /** Жесты: стук по сукну на чек, толчок фишек на ставку, сброс карт. */
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
      const side = j % 2 === 0 ? -1 : 1;       // стопка A / B
      const level = Math.floor(j / 2);          // высота в своей стопке
      // момент, когда фишка «проскальзывает» в общую стопку (снизу вверх, поочерёдно)
      const start = 0.46 + j * 0.03;
      const s = THREE.MathUtils.clamp((k - start) / 0.05, 0, 1);
      const e = s * s * (3 - 2 * s);
      if (s >= 1 && this.ticked <= j) { this.ticked = j + 1; this.onTick?.(); }
      const x = RIFFLE_SPOT.x + side * gap * (1 - e) * 0.5 + side * gap * 0.5 * (1 - e);
      const y = H / 2 + (level * H) * (1 - e) + (j * H) * e + tilt * 0.004 * level;
      this.v4.set(x - side * gap * 0.5 * (1 - e), y, RIFFLE_SPOT.z);
      this.e4.set(0, j * 0.7, side * 0.35 * tilt * (1 - e));
      this.q4.setFromEuler(this.e4);
      this.m4.compose(this.v4, this.q4, this.one);
      m.setMatrixAt(j, this.m4);
    }
    m.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, peek: number) {
    this.t += dt;
    // левая рука ведёт ближний край карт вверх: подтягивается к ним, кисть приподнимается
    const p = peek * peek * (3 - 2 * peek);
    this.left.rotation.x = -0.06 - p * 0.24;
    this.left.position.y = 0.035 + p * 0.012;
    this.leftRig.position.set(0.025 * p, 0.028 * p, -0.045 * p);
    this.rightRig.position.set(0, 0, 0);
    this.leftRig.rotation.set(0, 0, 0);
    this.right.rotation.z = 0.04;
    const g = this.gesture;
    if (!g) return;
    g.t += dt;
    const k = Math.min(1, g.t / g.dur);
    const bell = Math.sin(k * Math.PI);
    if (g.kind === 'knock') {
      // два коротких удара костяшками
      const tap = Math.abs(Math.sin(k * Math.PI * 2));
      this.leftRig.position.y = tap * 0.045;
      this.leftRig.position.z = -bell * 0.03;
    } else if (g.kind === 'riffle') {
      const o = keyframes(RIFFLE_PATH, k);
      this.rightRig.position.set(o[0], o[1], o[2]);
      this.right.rotation.z = 0.04 + o[3];
      this.animateRiffle(k);
    } else if (g.kind === 'bet') {
      // рука идёт к стопке, берёт фишки, несёт и бережно кладёт перед собой
      const o = keyframes(BET_PATH, k);
      this.rightRig.position.set(o[0], o[1], o[2]);
      this.right.rotation.z = 0.04 + o[3];
    } else if (g.kind === 'push') {
      // рука тянется к стопке и толкает фишки к центру
      const ease = bell * bell * (3 - 2 * bell);
      this.rightRig.position.set(-0.17 * ease, 0.012 * bell, -0.3 * ease);
    } else {
      // отбросить карты
      this.leftRig.position.set(0.05 * bell, 0.02 * bell, -0.16 * bell);
    }
    if (k >= 1) { this.gesture = null; if (this.riffleChips) this.riffleChips.count = 0; }
  }
}
