// Соперники — люди в костюмах-тройках за краем света: лица в полутьме, на свету — руки, манжеты и сукно.
// Тело — гладкие лофт-формы (торс, плечи, лацканы), ткань — шерстяная саржа с бархатным отливом.
// Руки — та же скан-модель, что у игрока, но упрощённая (≈2 тыс. треугольников на кисть).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SEATS } from './layout';
import { loadAssets, RealHand, POSES } from './Hands';
import { woolTextures } from './woods';

const wool = woolTextures(256);
wool.map.repeat.set(4, 4); wool.bump.repeat.set(4, 4);

const SUITS = [0x101116, 0x14110f, 0x0e1118, 0x131315, 0x120f11];

function suitMat(color: number) {
  return new THREE.MeshPhysicalMaterial({
    map: wool.map, bumpMap: wool.bump, bumpScale: 1.2, color, roughness: 0.84, metalness: 0,
    sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(0x3c4054), envMapIntensity: 0.3,
  });
}
const mats = {
  shirt: new THREE.MeshStandardMaterial({ color: 0xd9d4ca, roughness: 0.72 }),
  tie: new THREE.MeshPhysicalMaterial({ color: 0x3a0d18, roughness: 0.45, sheen: 1, sheenColor: new THREE.Color(0x7a2a3a), sheenRoughness: 0.4 }),
  // лицо и шея — тёплая кожа, но в полумраке (свет лампы до лиц почти не доходит)
  // кожа лица: тёплая, с бархатным отливом по контуру — свет лампы обрисовывает нос, скулы, подбородок
  skin: new THREE.MeshPhysicalMaterial({ color: 0x5a3626, roughness: 0.58, envMapIntensity: 0.2, sheen: 0.6, sheenColor: new THREE.Color(0xc08068), sheenRoughness: 0.5 }),
  hair: new THREE.MeshStandardMaterial({ color: 0x080605, roughness: 0.85, metalness: 0, envMapIntensity: 0.08 }),
  cuff: new THREE.MeshStandardMaterial({ color: 0xe6e1d6, roughness: 0.7 }),
};

type Part = 'suit' | 'shirt' | 'tie' | 'skin' | 'hair';

function place(g: THREE.BufferGeometry, p: [number, number, number], r: [number, number, number] = [0, 0, 0], s: [number, number, number] = [1, 1, 1]) {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(...s)));
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  return g;
}

/** Торс пиджака: лофт по профилю — талия, грудь, плечи, сужение к шее. */
function torso(broad: number) {
  // плавный профиль: сплайн через опорные точки — покатые плечи без углов и «шарниров»
  const pts: [number, number][] = [[0.15, 0], [0.156, 0.1], [0.172, 0.22], [0.198, 0.33], [0.212, 0.39], [0.2, 0.44], [0.15, 0.475], [0.08, 0.497], [0.046, 0.505]];
  const spline = new THREE.SplineCurve(pts.map(([r, y]) => new THREE.Vector2(r * broad, y)));
  const g = new THREE.LatheGeometry(spline.getPoints(40), 48);
  g.scale(1.25, 1, 0.62);   // овальное сечение: шире в плечах, плоский корпус
  return g;
}

/**
 * Рука одним плавным рукавом: от плеча через локоть к запястью, сужаясь к манжете.
 * Конец уходит под кисть — тело, рукав и рука читаются единым силуэтом.
 */
function sleeveTube(a: THREE.Vector3, elbow: THREE.Vector3, wrist: THREE.Vector3, r0: number, r1: number) {
  const curve = new THREE.CatmullRomCurve3([a, elbow, wrist], false, 'centripetal');
  const TS = 32, RS = 16;
  const g = new THREE.TubeGeometry(curve, TS, 1, RS, false);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= TS; i++) {
    const t = i / TS;
    curve.getPointAt(t, c);
    const rad = r0 + (r1 - r0) * t;
    for (let j = 0; j <= RS; j++) {
      const k = i * (RS + 1) + j;
      v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(rad).add(c);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Голова с лицом: сфера, «вылепленная» смещением вдоль нормали — нос, надбровья, глазницы,
 * скулы, подбородок, сужение челюсти. В полумраке читается как живое лицо, без мультяшности.
 */
function headGeo(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.092, 48, 36);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  const bump = (x: number, y: number, z: number, w: number) => {
    const d = (n.x - x) ** 2 + (n.y - y) ** 2 + (n.z - z) ** 2;
    return Math.exp(-d / (w * w));
  };
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.copy(v).normalize();
    let k = 0;
    k += 0.2 * bump(0, -0.12, -0.99, 0.1);                       // нос
    k += 0.06 * bump(0, -0.3, -0.95, 0.07);                      // кончик/крылья носа
    k += 0.06 * bump(0, 0.2, -0.97, 0.22) * (1 - bump(0, 0.2, -0.97, 0.06)); // надбровная дуга
    for (const sx of [-1, 1]) {
      k -= 0.075 * bump(sx * 0.36, 0.08, -0.93, 0.13);           // глазницы
      k += 0.045 * bump(sx * 0.55, -0.12, -0.83, 0.18);          // скулы
      k += 0.05 * bump(sx * 0.99, 0.0, 0.0, 0.16);               // уши (бугорки по бокам)
    }
    k += 0.07 * bump(0, -0.72, -0.68, 0.16);                     // подбородок
    k -= 0.03 * bump(0, -0.48, -0.88, 0.08);                     // ямка под губой
    const jaw = n.y < -0.2 ? 1 - Math.min(1, (-0.2 - n.y) * 0.35) : 1; // челюсть уже книзу
    v.multiplyScalar(1 + k);
    v.x *= jaw;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Фигура в локальных координатах: сидит лицом к −Z (к столу), кромка сукна — z = −0.5. */
function buildParts(variant: number): Record<Part, THREE.BufferGeometry> {
  // только силуэт: торс с плечами, шея, голова. Без рукавов-«труб», шляп и мелочей
  const parts: Record<Part, THREE.BufferGeometry[]> = { suit: [], shirt: [], tie: [], skin: [], hair: [] };
  const lean = 0.16;
  const broad = 1 + (variant % 3) * 0.05;
  parts.suit.push(place(torso(broad), [0, 0.0, 0.04], [-lean, 0, 0]));
  // узкая полоска воротника рубашки — единственная светлая деталь силуэта
  parts.shirt.push(place(new THREE.CylinderGeometry(0.05, 0.056, 0.03, 18, 1, true), [0, 0.505, -0.02], [-0.15, 0, 0]));
  parts.skin.push(place(new THREE.CylinderGeometry(0.044, 0.05, 0.09, 14), [0, 0.54, -0.02]));
  parts.skin.push(place(headGeo(), [0, 0.65, -0.04], [0.1, 0, 0], [0.86, 1.14, 1.0]));
  if (variant === 1) {
    // федора: поля и тулья с лентой
    parts.hair.push(place(new THREE.CylinderGeometry(0.155, 0.16, 0.008, 40), [0, 0.735, -0.04], [-0.1, 0, 0]));
    parts.hair.push(place(new THREE.CylinderGeometry(0.078, 0.095, 0.1, 32), [0, 0.785, -0.04], [-0.1, 0, 0]));
  }
  parts.hair.push(place(new THREE.SphereGeometry(0.097, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), [0, 0.672, -0.03], [-0.3, 0, 0], [0.9, 1.05, 1.06]));
  // пустые слоты, чтобы набор материалов был одинаковым
  parts.tie.push(place(new THREE.BoxGeometry(0.001, 0.001, 0.001), [0, 0.5, 0]));
  const out = {} as Record<Part, THREE.BufferGeometry>;
  for (const k of Object.keys(parts) as Part[]) out[k] = mergeGeometries(parts[k])!;
  return out;
}

/** руки соперников — чёрный силуэт с едва заметным бликом кожи */
const silhouetteHand = new THREE.MeshStandardMaterial({ color: 0x0d0a09, roughness: 0.55, metalness: 0, envMapIntensity: 0.35 });

// упрощённые руки — грузятся один раз на всех соперников
let handAssets: ReturnType<typeof loadAssets> | null = null;

export class Figure {
  readonly group = new THREE.Group();
  readonly body = new THREE.Group();
  private target = { lean: 0 };
  private rightHand = new THREE.Group();
  private leftHand = new THREE.Group();
  private hands: RealHand[] = [];
  private chip: THREE.Mesh;
  private thinking = false;
  private habit: 'drum' | 'chip' | 'rub' = 'drum';
  private habitT = 0;
  private think = 0;
  private cur = { lean: 0 };
  private phase = Math.random() * 10;
  ringMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 1, roughness: 0.25, envMapIntensity: 1.6 });

  private suit: THREE.Material;
  private broad: number;

  constructor(geo: Record<Part, THREE.BufferGeometry>, visualSeat: number, variant: number) {
    this.broad = 1 + (variant % 3) * 0.05;
    const s = SEATS[visualSeat];
    const suit = suitMat(SUITS[visualSeat % SUITS.length]);
    this.suit = suit;
    for (const k of Object.keys(geo) as Part[]) {
      const m = new THREE.Mesh(geo[k], k === 'suit' ? suit : mats[k]);
      this.body.add(m);
    }
    // кисти с манжетами — лежат на сукне у края
    for (const sx of [-1, 1]) {
      const hand = sx > 0 ? this.rightHand : this.leftHand;
      // кисть: от манжеты на кромке бортика вниз, ладонью на сукно (локальная y 0.135 — уровень сукна)
      // кисти лежат на бортике — тёмный силуэт, на карты не заходят
      // ладонь лежит поверх лакированного бортика (верх борта ≈ 0.06 над сукном), пальцы не уходят в сукно
      hand.position.set(sx * 0.15, 0.248, -0.35);
      hand.rotation.set(-0.04, sx * 0.35, 0);
      hand.userData.base = { p: hand.position.clone(), r: hand.rotation.clone() };
      this.body.add(hand);
    }
    this.attachHands();
    const chipMat = new THREE.MeshStandardMaterial({ color: [0x7a1428, 0x121214, 0x5a1020][visualSeat % 3], roughness: 0.35 });
    this.chip = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.005, 24), chipMat);
    this.chip.visible = false;
    this.body.add(this.chip);
    this.group.add(this.body);
    this.group.position.copy(s.figure);
    this.group.position.y = -0.12;
    this.group.scale.setScalar(0.92);
    this.group.lookAt(new THREE.Vector3(0, this.group.position.y, 0).setZ(s.figure.z * 0.2));
    this.group.rotateY(Math.PI);
    this.group.visible = false;
  }

  private attachHands() {
    handAssets ??= loadAssets('models/', false, 'hands_lo.bin');
    handAssets.then(({ left, right }) => {
      const mat = silhouetteHand;
      for (const [asset, holder, isRight] of [[right, this.rightHand, true], [left, this.leftHand, false]] as const) {
        const h = new RealHand(asset, mat);
        h.target = POSES.rest;
        h.speed = 30;
        h.update(1);
        h.root.scale.setScalar(1.3);
        h.root.position.set(0, -0.006, 0.0);
        holder.add(h.root);
        this.hands.push(h);
        // запястье модели (дальний край по +z) → координаты тела; туда приходит рукав
        const pos = asset.geo.getAttribute('position') as THREE.BufferAttribute;
        let maxZ = -Infinity;
        for (let i = 0; i < pos.count; i++) maxZ = Math.max(maxZ, pos.getZ(i));
        let cx = 0, cy = 0, n = 0;
        for (let i = 0; i < pos.count; i++) if (pos.getZ(i) > maxZ - 0.012) { cx += pos.getX(i); cy += pos.getY(i); n++; }
        holder.updateMatrix(); h.root.updateMatrix();
        const wrist = new THREE.Vector3(cx / n, cy / n, maxZ - 0.01).applyMatrix4(h.root.matrix).applyMatrix4(holder.matrix);
        const sx = isRight ? 1 : -1, b = this.broad;
        const tube = new THREE.Mesh(sleeveTube(
          new THREE.Vector3(sx * 0.17 * b, 0.4, 0.03),
          new THREE.Vector3(sx * 0.25 * b, 0.25, -0.12),
          wrist, 0.062, 0.04), this.suit);
        tube.castShadow = true;
        // белая манжета рубашки на стыке рукава и кисти — как на референсе
        const dir = wrist.clone().sub(new THREE.Vector3(sx * 0.25 * b, 0.25, -0.12)).normalize();
        const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.038, 0.03, 20), mats.cuff);
        cuff.position.copy(wrist).addScaledVector(dir, -0.022);
        cuff.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        this.body.add(tube, cuff);
        if (isRight) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0095, 0.0028, 8, 20), this.ringMat);
          ring.position.copy(h.ringOffset());
          ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), h.ringOffset().normalize());
          h.ringBone().add(ring);
        }
      }
    }).catch(() => { /* без рук — только манжеты */ });
  }

  set present(v: boolean) { this.group.visible = v; }

  setThinking(v: boolean) {
    if (v && !this.thinking) {
      this.habit = (['drum', 'chip', 'rub'] as const)[Math.floor(Math.random() * 3)];
      this.habitT = 0;
    }
    this.thinking = v;
  }
  setLean(v: number) { this.target.lean = v; }

  update(t: number, dt: number) {
    if (!this.group.visible) return;
    this.cur.lean += (this.target.lean - this.cur.lean) * Math.min(1, dt * 3);
    this.body.position.y = Math.sin(t * 1.3 + this.phase) * 0.005;
    this.body.rotation.x = this.cur.lean * 0.12 + Math.sin(t * 0.4 + this.phase) * 0.008;
    this.body.position.z = -this.cur.lean * 0.04;
    this.animateHands(t, dt);
  }

  private animateHands(t: number, dt: number) {
    this.think += ((this.thinking ? 1 : 0) - this.think) * Math.min(1, dt * 3);
    this.habitT += dt;
    if (this.thinking && this.habitT > 3.5 + Math.random() * 2) {
      this.habitT = 0;
      this.habit = (['drum', 'chip', 'rub'] as const)[Math.floor(Math.random() * 3)];
    }
    const k = this.think;
    const R = this.rightHand, L = this.leftHand;
    const rb = R.userData.base as { p: THREE.Vector3; r: THREE.Euler };
    const lb = L.userData.base as { p: THREE.Vector3; r: THREE.Euler };
    R.position.copy(rb.p); R.rotation.copy(rb.r);
    L.position.copy(lb.p); L.rotation.copy(lb.r);
    this.chip.visible = false;
    // пальцы: в покое расслаблены, в раздумьях — чуть собраны
    const pose = k > 0.5 && this.habit === 'chip' ? POSES.grab : POSES.rest;
    for (const h of this.hands) { h.target = pose; h.speed = 6; h.update(dt); }
    if (k < 0.01) return;
    if (this.habit === 'drum') {
      const burst = (t * 0.7) % 1 < 0.55 ? 1 : 0;
      const tap = Math.max(0, Math.sin(t * 15)) * burst;
      R.rotation.x = rb.r.x - tap * 0.06 * k;
      R.position.y = rb.p.y + tap * 0.004 * k;
    } else if (this.habit === 'chip') {
      this.chip.visible = true;
      const s = Math.sin(t * 1.8);
      R.rotation.x = rb.r.x + 0.06 * k;
      this.chip.position.set(rb.p.x + s * 0.02, rb.p.y + 0.03 + Math.abs(Math.cos(t * 1.8)) * 0.006, rb.p.z - 0.08);
      this.chip.rotation.set(Math.PI / 2, 0, t * 5.5);
      this.chip.scale.setScalar(k);
    } else {
      const s = (Math.sin(t * 1.3) * 0.5 + 0.5) * k;
      // потирает пальцы — кисть почти на месте, рукав не отрывается
      R.rotation.y = rb.r.y + s * 0.08;
      L.rotation.y = lb.r.y - s * 0.08;
      R.rotation.z = s * 0.05;
    }
  }
}

export class Figures {
  readonly group = new THREE.Group();
  readonly list: Figure[] = [];

  constructor() {
    const variants = [0, 1, 2].map(buildParts);
    for (let v = 1; v < 6; v++) {
      const f = new Figure(variants[v % 3], v, v % 3);
      this.list[v] = f;
      this.group.add(f.group);
    }
  }

  update(t: number, dt: number) {
    for (const f of this.list) f?.update(t, dt);
  }
}
