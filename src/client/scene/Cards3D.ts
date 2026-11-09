// Карты: пул из 17 объектов (12 карманных + 5 борда). Раздача, переворот, сквиз, сброс.

import * as THREE from 'three';
import { CardCode } from '../../shared/Cards';
import { CARD_H, CARD_W, cardBack, cardFace } from './textures';
import { Tweens, ease } from './Tween';
import { DECK } from './layout';

// Карта — сетка 10×14: её можно мягко изгибать (уголок при подсматривании).
// Скругления углов — прозрачностью текстуры (alphaTest), поэтому сетка остаётся простой.
const SEG_X = 10, SEG_Y = 14;
const BASE = new THREE.PlaneGeometry(CARD_W, CARD_H, SEG_X, SEG_Y);
const EPS = 0.00045; // половина толщины карты

function makeFaceGeo() { return BASE.clone(); }
/** рубашка: та же сетка, развёрнута наружу (обратный обход, зеркальные UV) */
function makeBackGeo() {
  const g = BASE.clone();
  const idx = g.index!;
  for (let i = 0; i < idx.count; i += 3) { const b = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, b); }
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setZ(i, -1);
  return g;
}

// изгиб: уголок «верх-лево» лица (там индекс карты) загибается к рубашке
const CORNER = new THREE.Vector2(-CARD_W / 2, CARD_H / 2);
const DIR = CORNER.clone().normalize();
const FOLD = 0.085; // глубина загиба от угла

/**
 * Карта. Иерархия: root (позиция на столе, поворот вокруг вертикали)
 *  → hinge (шарнир на дальнем крае — для сквиза)
 *    → flip (переворот)
 *      → face / back
 */
export class Card3D {
  readonly root = new THREE.Group();
  readonly hinge = new THREE.Group();
  readonly flip = new THREE.Group();
  readonly faceMat: THREE.MeshStandardMaterial;
  private faceGeo = makeFaceGeo();
  private backGeo = makeBackGeo();
  code: CardCode | null = null;
  faceUp = false;
  lift = 0;      // подъём ближнего края 0..1
  liftMax = 0.4; // рад
  bend = 0;      // загиб уголка 0..1
  private bent = 0;
  inUse = false;
  /** собственная подсветка лица — общие карты чуть ярче, чтобы читались */
  baseGlow = 0;

  constructor() {
    this.faceMat = new THREE.MeshStandardMaterial({ color: 0xcfc9bd, roughness: 0.75, metalness: 0, envMapIntensity: 0.25, emissive: 0x000000, alphaTest: 0.5 });
    const backMat = new THREE.MeshStandardMaterial({ map: cardBack(), color: 0xc4beb2, roughness: 0.6, envMapIntensity: 0.25, alphaTest: 0.5 });
    const face = new THREE.Mesh(this.faceGeo, this.faceMat);
    const back = new THREE.Mesh(this.backGeo, backMat);
    face.position.z = EPS;
    back.position.z = -EPS;
    this.flip.add(face, back);
    // карта лежит на столе: плоскость XY → XZ
    this.flip.rotation.x = -Math.PI / 2;
    this.flip.position.set(0, 0, CARD_H / 2);
    this.hinge.position.set(0, 0.0014, -CARD_H / 2);
    this.hinge.add(this.flip);
    this.root.add(this.hinge);
    this.root.visible = false;
  }

  setCode(code: CardCode | null) {
    if (code === this.code) return;
    this.code = code;
    if (code) { this.faceMat.map = cardFace(code); this.faceMat.emissiveMap = this.faceMat.map; this.faceMat.needsUpdate = true; }
  }

  /** face-up: лицо вверх; face-down: рубашка вверх */
  setFaceUp(v: boolean) {
    this.faceUp = v;
    this.flip.rotation.x = v ? -Math.PI / 2 : Math.PI / 2;
  }

  setHighlight(v: number) {
    const b = this.baseGlow;
    this.faceMat.emissive.setRGB(b + 0.32 * v, b + 0.24 * v, b * 0.92 + 0.06 * v);
  }

  applyLift() {
    this.hinge.rotation.x = -this.lift * this.liftMax;
    if (Math.abs(this.bend - this.bent) > 0.002) this.applyBend();
  }

  /** Мягкий загиб уголка: всё, что дальше линии сгиба, наматывается на цилиндр. */
  private applyBend() {
    this.bent = this.bend;
    const theta = this.bend * 2.35;
    const R = theta > 0.001 ? FOLD / theta : 1e6;
    const base = BASE.attributes.position as THREE.BufferAttribute;
    const fp = this.faceGeo.attributes.position as THREE.BufferAttribute;
    const fn = this.faceGeo.attributes.normal as THREE.BufferAttribute;
    const bp = this.backGeo.attributes.position as THREE.BufferAttribute;
    const bn = this.backGeo.attributes.normal as THREE.BufferAttribute;
    const lx = CORNER.x - DIR.x * FOLD, ly = CORNER.y - DIR.y * FOLD;
    for (let i = 0; i < base.count; i++) {
      let x = base.getX(i), y = base.getY(i), z = 0;
      let nx = 0, ny = 0, nz = 1;
      const sd = (x - lx) * DIR.x + (y - ly) * DIR.y;
      if (sd > 0 && theta > 0.001) {
        const a = sd / R;
        const along = R * Math.sin(a) - sd;
        x += DIR.x * along; y += DIR.y * along;
        z = -R * (1 - Math.cos(a)); // к рубашке — прочь от сукна
        nx = DIR.x * Math.sin(a); ny = DIR.y * Math.sin(a); nz = Math.cos(a);
      }
      fp.setXYZ(i, x, y, z); fn.setXYZ(i, nx, ny, nz);
      bp.setXYZ(i, x, y, z); bn.setXYZ(i, -nx, -ny, -nz);
    }
    fp.needsUpdate = fn.needsUpdate = bp.needsUpdate = bn.needsUpdate = true;
    this.faceGeo.computeBoundingSphere();
    this.backGeo.computeBoundingSphere();
  }
}

export class Cards3D {
  readonly group = new THREE.Group();
  readonly pool: Card3D[] = [];
  readonly deckMesh: THREE.Group;

  constructor(private tweens: Tweens) {
    for (let i = 0; i < 17; i++) {
      const c = new Card3D();
      this.pool.push(c);
      this.group.add(c.root);
    }
    // колода, из которой летят карты
    this.deckMesh = new THREE.Group();
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe9e2d3, roughness: 0.6 });
    const stack = new THREE.Mesh(
      new THREE.BoxGeometry(CARD_W * 0.98, 0.022, CARD_H * 0.98),
      [edgeMat, edgeMat, new THREE.MeshStandardMaterial({ map: cardBack(), roughness: 0.45, alphaTest: 0.5 }), edgeMat, edgeMat, edgeMat],
    );
    // верхняя грань BoxGeometry — индекс 2; поворачиваем текстуру как у карт
    stack.position.y = 0.011;
    this.deckMesh.add(stack);
    this.deckMesh.position.copy(DECK);
    this.deckMesh.rotation.y = 0.35;
    this.group.add(this.deckMesh);
  }

  take(): Card3D {
    const c = this.pool.find(p => !p.inUse) || this.pool[0];
    c.inUse = true;
    c.lift = 0; c.bend = 0; c.applyLift();
    c.baseGlow = 0;
    c.setHighlight(0);
    c.root.visible = true;
    c.root.scale.setScalar(1);
    if (c.root.userData.noShadow) {
      c.root.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      c.root.userData.noShadow = false;
    }
    return c;
  }

  release(c: Card3D) {
    c.inUse = false;
    c.root.visible = false;
    c.code = null;
    this.tweens.cancel(c);
  }

  /** Полёт карты из колоды на место; поворот по пути, приземление с лёгким скольжением. */
  deal(c: Card3D, to: THREE.Vector3, rotY: number, opts: { delay?: number; faceUp?: boolean; dur?: number; onLand?: () => void; onStart?: () => void } = {}) {
    const from = DECK.clone().setY(0.024);
    const startRot = this.deckMesh.rotation.y;
    c.setFaceUp(false);
    c.root.position.copy(from);
    c.root.rotation.set(0, startRot, 0);
    c.root.visible = (opts.delay ?? 0) <= 0;
    const dist = from.distanceTo(to);
    const spin = Math.PI * 2 * (dist > 1.2 ? 1 : 0) + rotY - startRot;
    let started = false;
    this.tweens.add(opts.dur ?? 560 + dist * 200, (k) => {
      if (!started) { started = true; c.root.visible = true; opts.onStart?.(); }
      c.root.position.lerpVectors(from, to, k);
      c.root.position.y = 0.002 + Math.sin(k * Math.PI) * (0.05 + dist * 0.04);
      c.root.rotation.y = startRot + spin * k;
    }, {
      key: c, delay: opts.delay, ease: ease.outQuint,
      done: () => {
        c.root.position.copy(to);
        c.root.rotation.y = rotY;
        if (opts.faceUp) this.flipTo(c, true);
        opts.onLand?.();
      },
    });
  }

  flipTo(c: Card3D, up: boolean, delay = 0, dur = 540) {
    if (c.faceUp === up) return;
    const from = c.flip.rotation.x;
    const to = up ? -Math.PI / 2 : Math.PI / 2;
    c.faceUp = up;
    const baseY = c.root.position.y;
    this.tweens.add(dur, (k) => {
      c.flip.rotation.x = from + (to - from) * k;
      c.root.position.y = baseY + Math.sin(k * Math.PI) * (dur > 1000 ? 0.09 : 0.045);
    }, { delay, ease: ease.inOutCubic, key: c.flip });
  }

  /** Фолд: карты рубашкой вверх с броском отлетают к колоде — дуга, вращение, лёгкий наклон в воздухе. */
  muck(c: Card3D, delay = 0) {
    const from = c.root.position.clone();
    const to = new THREE.Vector3(DECK.x - 0.13 + Math.random() * 0.06, 0.003, DECK.z + 0.04 + Math.random() * 0.06);
    const r0 = c.root.rotation.y;
    const lift0 = c.lift;
    const spin = (Math.random() < 0.5 ? -1 : 1) * (2.2 + Math.random() * 1.2);
    const dist = from.distanceTo(to);
    if (c.faceUp) this.flipTo(c, false, delay, 300);
    this.tweens.add(560 + dist * 120, (k) => {
      c.root.position.lerpVectors(from, to, k);
      c.root.position.y += Math.sin(k * Math.PI) * (0.08 + dist * 0.05);
      c.root.rotation.y = r0 + spin * k;
      c.root.rotation.z = Math.sin(k * Math.PI) * 0.35;   // «планирует» в воздухе
      c.lift = lift0 * (1 - k); c.bend = Math.min(c.bend, c.lift); c.applyLift();
      c.root.scale.setScalar(1 - k * 0.12);
    }, { key: c, delay, ease: ease.outCubic, done: () => { c.root.rotation.z = 0; this.release(c); } });
  }

  /** Перед раздачей колода коротко тасуется: делится на две половины, «риффл» с прогибом, карты сыплются в одну стопку. */
  shuffle(onRiffle?: () => void): Promise<void> {
    const free = this.pool.filter(p => !p.inUse).slice(0, 12);
    if (free.length < 6) return Promise.resolve();
    const n = free.length;
    const rotY = this.deckMesh.rotation.y;
    const right = new THREE.Vector3(Math.cos(rotY), 0, -Math.sin(rotY));
    const base = DECK.clone();
    this.deckMesh.visible = false;
    const H = 0.0018;
    return new Promise(res => {
      free.forEach((c, i) => {
        c.inUse = true;
        c.setFaceUp(false);
        c.lift = 0; c.bend = 0; c.applyLift();
        c.root.visible = true;
        c.root.scale.setScalar(1);
        c.root.rotation.set(0, rotY, 0);
        c.root.position.copy(base).setY(0.002 + i * H);
        const side = i % 2 ? 1 : -1;
        const half = new THREE.Vector3().copy(base).addScaledVector(right, side * 0.075);
        const order = i;       // вперемешку: левая/правая половины по очереди
        // 1) делим колоду
        this.tweens.add(260, k => {
          c.root.position.lerpVectors(base, half, k);
          c.root.position.y = 0.002 + Math.floor(i / 2) * H + Math.sin(k * Math.PI) * 0.025;
          c.root.rotation.z = -side * 0.22 * k;   // прогиб половинок
        }, { key: c, delay: i * 10, ease: ease.inOutCubic, done: () => {
          // 2) риффл — карты по одной падают в центр
          const from = c.root.position.clone();
          this.tweens.add(150, k => {
            c.root.position.lerpVectors(from, base, k);
            c.root.position.y = from.y + (0.002 + order * H - from.y) * k + Math.sin(k * Math.PI) * 0.012;
            c.root.rotation.z = -side * 0.22 * (1 - k);
          }, { key: c, delay: 140 + order * 22 - i * 10, ease: ease.outCubic, done: () => {
            if (order === 0) onRiffle?.();
            if (order === n - 1) {
              // 3) подравнять стопку — и в колоду
              this.tweens.add(180, () => {}, { done: () => {
                for (const x of free) { x.root.rotation.z = 0; this.release(x); }
                this.deckMesh.visible = true;
                res();
              } });
            }
          } });
        } });
      });
    });
  }

  /** Сильная комбинация победителя: карты мягко «дышат» золотым светом. */
  glow(cards: Card3D[], strength = 1, dur = 2600) {
    for (const c of cards) {
      this.tweens.add(dur, k => {
        const pulse = 0.5 + 0.5 * Math.sin(k * Math.PI * 5 - Math.PI / 2);
        c.setHighlight(1 + strength * 0.9 * pulse * (1 - k * 0.6));
      }, { key: c.faceMat, ease: ease.linear, done: () => c.setHighlight(1) });
    }
  }

  /** Собрать все карты к колоде (конец раздачи). */
  sweep(): Promise<void> {
    const used = this.pool.filter(p => p.inUse);
    if (!used.length) return Promise.resolve();
    return new Promise(res => {
      let left = used.length;
      used.forEach((c, i) => {
        const from = c.root.position.clone();
        const to = DECK.clone().setY(0.03);
        const lift0 = c.lift;
        this.tweens.add(380, (k) => {
          c.root.position.lerpVectors(from, to, k);
          c.root.position.y += Math.sin(k * Math.PI) * 0.06;
          c.lift = lift0 * (1 - k); c.bend = Math.min(c.bend, c.lift); c.applyLift();
          c.root.scale.setScalar(1 - k * 0.3);
        }, { key: c, delay: i * 18, ease: ease.inOutCubic, done: () => { this.release(c); if (--left === 0) res(); } });
      });
    });
  }
}
