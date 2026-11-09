// Фишки: один InstancedMesh на все стопки стола. Цвет — instanceColor, белые вставки — маска в текстуре.

import * as THREE from 'three';
import { chipTexture } from './textures';
import { Tweens, ease } from './Tween';

export const CHIP_R = 0.032;
export const CHIP_H = 0.0078;
const MAX = 900;

const DENOMS: { v: number; c: string }[] = [
  // сочные цвета глиняных фишек, как на референсе: кремовые вставки по ребру
  { v: 25000, c: '#d4a63a' },
  { v: 5000, c: '#7a1428' },
  { v: 1000, c: '#123f9a' },
  { v: 500, c: '#0e7a35' },
  { v: 100, c: '#121214' },
  { v: 25, c: '#9a1830' },
];

interface Chip { p: THREE.Vector3; rot: number; color: THREE.Color; visible: boolean }
interface Pile { anchor: THREE.Vector3; amount: number; chips: Chip[]; maxCols: number }

/** Разложить сумму на фишки (жадно), не больше limit штук. */
function breakdown(amount: number, limit: number): THREE.Color[] {
  const out: THREE.Color[] = [];
  let rest = amount;
  // крупнейший номинал, которым набирается хотя бы ~6 фишек — стопки выглядят солидно
  const top = DENOMS.findIndex(d => amount / d.v >= 6);
  const ds = DENOMS.slice(top < 0 ? DENOMS.length - 1 : top);
  ds.forEach((d, i) => {
    let n = Math.floor(rest / d.v);
    if (i < ds.length - 1 && n > 4) n = Math.max(4, Math.floor(n * 0.6)); // смесь цветов
    rest -= n * d.v;
    while (n-- > 0) out.push(new THREE.Color(d.c));
  });
  if (rest > 0 && amount > 0 && out.length === 0) out.push(new THREE.Color(DENOMS[DENOMS.length - 1].c));
  // сначала крупные снизу
  // слишком много — оставляем самые крупные (визуально «примерно столько же»)
  return out.slice(0, limit);
}

/**
 * Раскладка: фишки одного цвета — в своём столбике (как на референсе), до `per` в высоту.
 * gap — расстояние между столбиками в радиусах фишки.
 */
function layout(colors: THREE.Color[], anchor: THREE.Vector3, per = 10, seed = 0, gap = 2.14): { p: THREE.Vector3; rot: number }[] {
  const offsets: [number, number][] = [[0, 0], [1, 0], [0.5, 0.87], [-0.5, 0.87], [-1, 0], [-0.5, -0.87], [0.5, -0.87], [1.5, 0.87], [2, 0], [1.5, -0.87], [-1.5, 0.87], [-2, 0]];
  const res: { p: THREE.Vector3; rot: number }[] = [];
  let col = 0, h = 0;
  colors.forEach((c, i) => {
    if (i > 0 && (h >= per || !c.equals(colors[i - 1]))) { col++; h = 0; }
    const [ox, oz] = offsets[col % offsets.length];
    const lift = Math.floor(col / offsets.length) * per;
    // лёгкая неровность стопки — но меньше зазора между колоннами, чтобы фишки соседних стопок не входили друг в друга
    const jitter = Math.sin((i + 1) * 12.9898 + seed) * 0.0007;
    res.push({
      p: new THREE.Vector3(
        anchor.x + ox * CHIP_R * gap + jitter,
        CHIP_H / 2 + (h + lift) * CHIP_H,
        anchor.z + oz * CHIP_R * gap - jitter * 0.7,
      ),
      rot: (i * 1.7 + seed) % 6.28,
    });
    h++;
  });
  return res;
}

export class Chips {
  readonly mesh: THREE.InstancedMesh;
  private piles = new Map<string, Pile>();
  private flying: Chip[] = [];
  private dirty = true;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3(1, 1, 1);
  private yAxis = new THREE.Vector3(0, 1, 0);

  constructor(private tweens: Tweens) {
    const geo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 28, 1);
    // UV: боковина → левая половина атласа, торцы → правая
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const nrm = geo.attributes.normal as THREE.BufferAttribute;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      if (Math.abs(nrm.getY(i)) > 0.5) {
        uv.setXY(i, 0.5 + (pos.getX(i) / CHIP_R * 0.5 + 0.5) * 0.5, pos.getZ(i) / CHIP_R * 0.5 + 0.5);
      } else {
        uv.setX(i, uv.getX(i) * 0.5);
      }
    }
    const map = chipTexture();
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.34, metalness: 0.0, envMapIntensity: 1.25 });
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <map_fragment>', `
          vec4 chipTex = texture2D( map, vMapUv );
          float chipShade = chipTex.r / 0.88;
          float chipInsert = chipTex.g;
        `)
        .replace('#include <color_fragment>', `
          #if defined( USE_INSTANCING_COLOR ) || defined( USE_COLOR )
            vec3 base = vColor;
          #else
            vec3 base = vec3(1.0);
          #endif
          diffuseColor.rgb = mix(base * 1.08, vec3(0.92, 0.84, 0.6), chipInsert) * chipShade;
        `);
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  amount(key: string) { return this.piles.get(key)?.amount ?? 0; }
  anchor(key: string) { return this.piles.get(key)?.anchor; }

  /** Мгновенно установить стопку. */
  set(key: string, amount: number, anchor: THREE.Vector3, limit = 30, per = 10) {
    const pile = this.piles.get(key);
    if (pile && pile.amount === amount && pile.anchor.equals(anchor)) return;
    const colors = breakdown(amount, limit);
    const mine = key === 'stack0';
    const slots = layout(colors, anchor, mine ? 14 : per, key.length * 3.1, mine ? 2.35 : 2.05);
    this.piles.set(key, {
      anchor: anchor.clone(), amount, maxCols: per,
      chips: colors.map((c, i) => ({ p: slots[i].p, rot: slots[i].rot, color: c, visible: true })),
    });
    this.dirty = true;
  }

  /**
   * Перелёт фишек: из стопки `from` (или точки) в стопку `to`.
   * Итоговые суммы задаются явно — стопки пересобираются по прилёту.
   */
  fly(from: THREE.Vector3, to: string, toAnchor: THREE.Vector3, toAmount: number, moved: number, opts: { delay?: number; limit?: number; dur?: number; low?: boolean; high?: boolean; done?: () => void } = {}) {
    const colors = breakdown(Math.max(moved, 1), Math.min(opts.high ? 24 : 12, opts.limit ?? 12));
    const dur = opts.dur ?? 760;
    const flyers: Chip[] = colors.map((c, i) => {
      const start = new THREE.Vector3(from.x + (Math.random() - 0.5) * 0.02, CHIP_H * (i + 1), from.z + (Math.random() - 0.5) * 0.02);
      return { p: start, rot: Math.random() * 6, color: c, visible: !(opts.delay && opts.delay > 0) };
    });
    const targetSlots = layout(flyers.map(f => f.color), toAnchor, 10, 7);
    this.flying.push(...flyers);
    let finished = 0;
    flyers.forEach((ch, i) => {
      const a = ch.p.clone();
      const b = targetSlots[i].p.clone().add(new THREE.Vector3(0, CHIP_H * (opts.high ? 0.5 : 3), 0));
      // в руке фишки несут низко и ровно; выигрыш летит к победителю высокой дугой
      const arc = opts.low ? 0.045 : opts.high ? 0.14 + a.distanceTo(b) * 0.2 : 0.06 + a.distanceTo(b) * 0.12;
      this.tweens.add(dur, (k) => {
        ch.visible = true;
        ch.p.lerpVectors(a, b, k);
        ch.p.y += Math.sin(k * Math.PI) * arc;
        if (k > 0.85) ch.p.y += Math.sin((k - 0.85) / 0.15 * Math.PI) * 0.006; // отскок
        if (!opts.low) ch.rot += opts.high ? 0.11 : 0.06;
        this.dirty = true;
      }, {
        delay: (opts.delay ?? 0) + i * (opts.low ? 8 : opts.high ? 30 : 42),
        ease: ease.inOutCubic,
        done: () => {
          finished++;
          ch.visible = false;
          if (finished === flyers.length) {
            this.flying = this.flying.filter(f => !flyers.includes(f));
            this.set(to, toAmount, toAnchor);
            this.dirty = true;
            opts.done?.();
          }
        },
      });
    });
  }

  /** Перелить стопку целиком в другую (сборы в банк, выплата победителю). */
  pour(fromKey: string, toKey: string, toAnchor: THREE.Vector3, toAmount: number, opts: { delay?: number; dur?: number; limit?: number; high?: boolean; done?: () => void } = {}) {
    const src = this.piles.get(fromKey);
    if (!src || src.amount === 0) { this.set(toKey, toAmount, toAnchor); opts.done?.(); return; }
    const from = src.anchor.clone();
    const moved = src.amount;
    this.piles.delete(fromKey);
    this.dirty = true;
    this.fly(from, toKey, toAnchor, toAmount, moved, opts);
  }

  clear(key: string) {
    if (this.piles.delete(key)) this.dirty = true;
  }

  keys() { return [...this.piles.keys()]; }

  update() {
    if (!this.dirty) return;
    this.dirty = false;
    let n = 0;
    const col = this.mesh.instanceColor!;
    const push = (c: Chip) => {
      if (!c.visible || n >= MAX) return;
      this.q.setFromAxisAngle(this.yAxis, c.rot);
      this.m.compose(c.p, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      col.setXYZ(n, c.color.r, c.color.g, c.color.b);
      n++;
    };
    for (const p of this.piles.values()) for (const c of p.chips) push(c);
    for (const c of this.flying) push(c);
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    col.needsUpdate = true;
  }
}
