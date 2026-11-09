// Процедурные текстуры: сукно с запечённым светом, карты, фишки, латунные таблички, дым.
// Ни одного внешнего файла — всё рисуется на canvas один раз при старте.

import * as THREE from 'three';
import { bakedSet } from './bake';
import { CardCode, rankOf, suitOf, rankLabel } from '../../shared/Cards';

export const SERIF = '"Playfair Display", "Didot", "Bodoni 72", Georgia, "Times New Roman", serif';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function tex(c: HTMLCanvasElement, srgb = true, aniso = 16) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Детерминированный шум, чтобы сукно выглядело одинаково у всех
function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────── Сукно ─────────────────────────

export interface FeltBakeInfo {
  /** границы сукна в мировых координатах (x, z) */
  minX: number; maxX: number; minZ: number; maxZ: number;
  /** запечённые тени от статичных предметов: x, z, rx, rz, сила, угол */
  shadows: { x: number; z: number; rx: number; rz: number; a: number; rot?: number }[];
  lampZ: number;
  stadium: { r: number; l: number };
}

let feltNoise: HTMLCanvasElement | null = null;

function velvetNoise(w: number, h: number): HTMLCanvasElement {
  if (feltNoise) return feltNoise;
  const [c, g] = canvas(w, h);
  const rnd = mulberry(1925);
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, w, h);
  // «мятый бархат» — крупные мягкие пятна
  // «мятый бархат», как на референсе: вытянутые мягкие пятна разного тона
  for (let i = 0; i < 900; i++) {
    const x = rnd() * w, y = rnd() * h, r = 30 + rnd() * 170;
    const light = rnd() > 0.42;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.05 + rnd() * 0.08;
    grad.addColorStop(0, light ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.2})`);
    grad.addColorStop(1, 'rgba(128,128,128,0)');
    g.fillStyle = grad;
    g.beginPath(); g.ellipse(x, y, r, r * (0.4 + rnd() * 0.8), rnd() * Math.PI, 0, Math.PI * 2); g.fill();
  }
  // штрихи ворса
  g.globalAlpha = 0.06;
  const strokes = Math.round(w * h / 60);
  for (let i = 0; i < strokes; i++) {
    const x = rnd() * w, y = rnd() * h, len = 3 + rnd() * 7;
    g.strokeStyle = rnd() > 0.5 ? '#fff' : '#000';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + len * 0.3, y + len); g.stroke();
  }
  g.globalAlpha = 1;
  // мелкое зерно
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 20;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  feltNoise = c;
  return c;
}

export function makeFeltTexture(color: string, info: FeltBakeInfo, quality: number): THREE.Texture {
  const W = quality > 1 ? 2048 : 1536;
  return bakedSet(`felt-${color.replace('#', '')}-${W}`, { map: { srgb: true, repeat: false } }, () => ({ map: feltCanvas(color, info, W) })).map;
}

function feltCanvas(color: string, info: FeltBakeInfo, W: number): HTMLCanvasElement {   // чёткая фактура ворса вблизи
  const H = Math.round(W * (info.maxZ - info.minZ) / (info.maxX - info.minX));
  const [c, g] = canvas(W, H);
  const toPx = (x: number, z: number) => [
    ((x - info.minX) / (info.maxX - info.minX)) * W,
    ((z - info.minZ) / (info.maxZ - info.minZ)) * H,
  ];
  const sx = W / (info.maxX - info.minX);

  g.fillStyle = color;
  g.fillRect(0, 0, W, H);

  // фактура бархата (overlay)
  g.globalCompositeOperation = 'overlay';
  g.drawImage(velvetNoise(W, H), 0, 0, W, H);
  g.globalCompositeOperation = 'source-over';

  // тонкая саржа сукна: еле заметная диагональная ткань — видна вблизи, придаёт «дорогую» фактуру
  {
    const img = g.getImageData(0, 0, W, H), d = img.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const tw = ((x + y) & 3) < 2 ? 5 : -5;
      const tw2 = ((x - y) & 7) === 0 ? -3 : 0;
      d[i] += tw + tw2; d[i + 1] += (tw + tw2) * 0.6; d[i + 2] += (tw + tw2) * 0.7;
    }
    g.putImageData(img, 0, 0);
  }
  // герб клуба тон-в-тон в дальней части стола: венок, пика и монограмма QWX с золотой нитью
  {
    const [cx, cy] = toPx(0, -0.62);
    const R = 0.2 * sx;
    g.save();
    g.translate(cx, cy);
    g.scale(1, (H / (info.maxZ - info.minZ)) / sx);   // компенсация растяжения холста по z
    // тиснение: тень + свет
    const emboss = (dx: number, dy: number, style: string) => {
      g.save(); g.translate(dx, dy); g.strokeStyle = style; g.fillStyle = style;
      g.lineWidth = R * 0.03;
      g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.stroke();
      g.lineWidth = R * 0.012;
      g.beginPath(); g.arc(0, 0, R * 0.9, 0, Math.PI * 2); g.stroke();
      // венок из листьев
      for (let k = 0; k < 2; k++) for (let i = 0; i < 11; i++) {
        const a = Math.PI * (0.62 + i * 0.07) * (k ? -1 : 1) + (k ? Math.PI * 2 : 0);
        const lx = Math.cos(a + Math.PI / 2) * R * 0.78 * (k ? -1 : 1), ly = Math.sin(a + Math.PI / 2) * R * 0.78;
        g.save(); g.translate(lx, ly); g.rotate(a + (k ? -0.6 : 0.6));
        g.beginPath(); g.ellipse(0, 0, R * 0.075, R * 0.03, 0, 0, Math.PI * 2); g.fill(); g.restore();
      }
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `700 ${R * 0.5}px ${SERIF}`;
      g.fillText('♠', 0, -R * 0.28);
      g.font = `700 ${R * 0.42}px ${SERIF}`;
      g.fillText('QWX', 0, R * 0.22);
      g.font = `600 ${R * 0.1}px ${SERIF}`;
      g.fillText('·  CLUB  ·', 0, R * 0.55);
      g.restore();
    };
    emboss(R * 0.012, R * 0.012, 'rgba(0,0,0,0.22)');
    emboss(-R * 0.008, -R * 0.008, 'rgba(255,220,200,0.07)');
    emboss(0, 0, 'rgba(212,175,90,0.13)');
    g.restore();
  }

  // запечённые тени предметов
  for (const s of info.shadows) {
    const [x, y] = toPx(s.x, s.z);
    g.save();
    g.translate(x, y);
    g.rotate(s.rot || 0);
    g.scale(1, s.rz / s.rx);
    const r = s.rx * sx;
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0, `rgba(0,0,0,${s.a})`);
    grad.addColorStop(0.55, `rgba(0,0,0,${s.a * 0.55})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  // запечённый свет лампы: тёплое пятно в центре, глубокая тьма к краям
  g.globalCompositeOperation = 'multiply';
  {
    const [lx, lz] = toPx(0, info.lampZ);
    const R = Math.max(W, H) * 0.7;
    const grad = g.createRadialGradient(lx, lz, 0, lx, lz, R);
    grad.addColorStop(0, '#fff4e2');
    grad.addColorStop(0.3, '#efdcc2');
    grad.addColorStop(0.55, '#b39a80');
    grad.addColorStop(0.78, '#54443a');
    grad.addColorStop(1, '#1c1412');
    g.fillStyle = grad;
    g.save();
    g.translate(lx, lz); g.scale(1.5, 0.95); g.translate(-lx, -lz);
    g.fillRect(-W, -H, W * 3, H * 3);
    g.restore();
  }
  // мягкая тень от бортика по краю сукна (AO)
  {
    const r = info.stadium.r * sx, l = info.stadium.l * sx;
    const [cx, cz] = toPx(0, 0);
    g.strokeStyle = 'rgba(40,30,30,1)';
    for (let i = 0; i < 14; i++) {
      g.globalAlpha = 0.09;
      g.lineWidth = (14 - i) * W / 260;
      g.beginPath();
      g.moveTo(cx - r, cz - l); g.lineTo(cx - r, cz + l);
      g.arc(cx, cz + l, r, Math.PI, 0, true);
      g.lineTo(cx + r, cz - l);
      g.arc(cx, cz - l, r, 0, Math.PI, true);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
  g.globalCompositeOperation = 'screen';
  {
    // лёгкий тёплый «хот-спот» от лампы
    const [lx, lz] = toPx(0, info.lampZ);
    const grad = g.createRadialGradient(lx, lz, 0, lx, lz, W * 0.38);
    grad.addColorStop(0, 'rgba(255,214,150,0.16)');
    grad.addColorStop(1, 'rgba(255,214,150,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  }
  g.globalCompositeOperation = 'source-over';
  return c;
}

// ───────────────────────── Карты ─────────────────────────

export const CARD_W = 0.15;
export const CARD_H = 0.21;
const CW = 512, CH = 716;   // логические координаты рисования
const CS = 1;                // полное разрешение 512×716 — индексы и масти идеально чёткие (в памяти не больше 20 лиц)
function cardCanvas() {
  const [c, g] = canvas(Math.round(CW * CS), Math.round(CH * CS));
  g.scale(CS, CS);
  return [c, g] as const;
}

const SUIT_GLYPH: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED = '#a01428';
const INK = '#141012';
const cardCache = new Map<string, THREE.Texture>();

function roundClip(g: CanvasRenderingContext2D) {
  g.clearRect(0, 0, CW, CH);
  const r = 40;
  g.beginPath();
  g.moveTo(r, 0); g.arcTo(CW, 0, CW, CH, r); g.arcTo(CW, CH, 0, CH, r); g.arcTo(0, CH, 0, 0, r); g.arcTo(0, 0, CW, 0, r);
  g.closePath();
  g.clip();
}

function paper(g: CanvasRenderingContext2D) {
  roundClip(g);
  const grad = g.createLinearGradient(0, 0, CW, CH);
  grad.addColorStop(0, '#fbf9f4');
  grad.addColorStop(1, '#efe9dc');
  g.fillStyle = grad;
  g.fillRect(0, 0, CW, CH);
  const rnd = mulberry(7);
  g.globalAlpha = 0.05;
  for (let i = 0; i < 5600; i++) {
    g.fillStyle = rnd() > 0.5 ? '#8a7a60' : '#fff';
    g.fillRect(rnd() * CW, rnd() * CH, 2, 2);
  }
  g.globalAlpha = 1;
}

export function cardFace(code: CardCode): THREE.Texture {
  const cached = cardCache.get(code);
  if (cached) { cardCache.delete(code); cardCache.set(code, cached); return cached; }
  // держим в видеопамяти не больше 20 лиц; вытесненная текстура перезальётся, если снова понадобится
  if (cardCache.size >= 20) { const [k, old] = cardCache.entries().next().value!; cardCache.delete(k); old.dispose(); }
  const [c, g] = cardCanvas();
  paper(g);
  const suit = suitOf(code), rank = rankOf(code);
  const col = suit === 'h' || suit === 'd' ? RED : INK;
  const glyph = SUIT_GLYPH[suit];
  const label = rankLabel(rank);

  // классическая карта: индекс в углах, масти раскладкой как в настоящей колоде, без картинок в центре
  const pip = (x: number, y: number, size: number, flip: boolean) => {
    g.save();
    g.translate(x, y);
    if (flip) g.rotate(Math.PI);
    g.font = `400 ${size}px ${SERIF}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = col;
    g.fillText(glyph, 0, 0);
    g.restore();
  };
  const corner = () => {
    g.fillStyle = col;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = `700 ${label.length > 1 ? 132 : 168}px ${SERIF}`;
    g.fillText(label, 82, 160);
    g.font = `400 120px ${SERIF}`;
    g.fillText(glyph, 82, 270);
  };
  corner();
  g.save(); g.translate(CW, CH); g.rotate(Math.PI); corner(); g.restore();

  // поле для мастей — между угловыми индексами
  const X = (u: number) => CW * (0.5 + (u - 0.5) * 1.0);
  const Y = (v: number) => CH * (0.17 + (v - 0.2) / 0.6 * 0.66);
  const L = 0.385, M = 0.5, R = 0.615;
  const PIPS: Record<number, [number, number][]> = {
    2: [[M, 0.2], [M, 0.8]],
    3: [[M, 0.2], [M, 0.5], [M, 0.8]],
    4: [[L, 0.2], [R, 0.2], [L, 0.8], [R, 0.8]],
    5: [[L, 0.2], [R, 0.2], [M, 0.5], [L, 0.8], [R, 0.8]],
    6: [[L, 0.2], [R, 0.2], [L, 0.5], [R, 0.5], [L, 0.8], [R, 0.8]],
    7: [[L, 0.2], [R, 0.2], [M, 0.35], [L, 0.5], [R, 0.5], [L, 0.8], [R, 0.8]],
    8: [[L, 0.2], [R, 0.2], [M, 0.35], [L, 0.5], [R, 0.5], [M, 0.65], [L, 0.8], [R, 0.8]],
    9: [[L, 0.2], [R, 0.2], [L, 0.4], [R, 0.4], [M, 0.5], [L, 0.6], [R, 0.6], [L, 0.8], [R, 0.8]],
    10: [[L, 0.2], [R, 0.2], [M, 0.3], [L, 0.4], [R, 0.4], [L, 0.6], [R, 0.6], [M, 0.7], [L, 0.8], [R, 0.8]],
  };
  if (rank === 14) {
    // туз — одна крупная масть по центру
    pip(CW / 2, CH / 2, 250, false);
  } else if (rank >= 11) {
    // валет, дама, король — только угловые индексы, центр чистый
  } else {
    for (const [u, v] of PIPS[rank] || []) pip(X(u), Y(v), 98, v > 0.5);
  }
  const t = tex(c, true, 16);
  cardCache.set(code, t);
  return t;
}

/** Рубашки карт: фон, узор, рамка. Выбор игрока хранится в localStorage (pn.back). */
export const CARD_BACKS: Record<string, { name: string; bg: string; line: string; frame: string; swatch: string }> = {
  navy: { name: 'Полночь', bg: '#141a28', line: 'rgba(190,198,214,0.42)', frame: '#d6dce8', swatch: '#1d2638' },
  bordeaux: { name: 'Бордо', bg: '#4a0f1d', line: 'rgba(226,190,120,0.40)', frame: '#d9b56a', swatch: '#5e1426' },
  emerald: { name: 'Изумруд', bg: '#0d3326', line: 'rgba(214,196,140,0.38)', frame: '#cdb978', swatch: '#11452f' },
  onyx: { name: 'Оникс', bg: '#0c0b0d', line: 'rgba(212,175,55,0.40)', frame: '#d4af37', swatch: '#1a171b' },
};
let backTex: THREE.Texture | null = null;
let backStyle = (() => { try { const v = localStorage.getItem('pn.back'); return v && CARD_BACKS[v] ? v : 'navy'; } catch { return 'navy'; } })();
export const currentBack = () => backStyle;

function drawBack(g: CanvasRenderingContext2D, style: string) {
  const st = CARD_BACKS[style] || CARD_BACKS.navy;
  g.save();
  g.clearRect(0, 0, CW, CH);
  roundClip(g);
  g.fillStyle = '#f6f3ec';
  g.fillRect(0, 0, CW, CH);
  const m = 28;
  g.fillStyle = st.bg;
  g.fillRect(m, m, CW - 2 * m, CH - 2 * m);
  g.save();
  g.beginPath(); g.rect(m + 4, m + 4, CW - 2 * m - 8, CH - 2 * m - 8); g.clip();
  g.strokeStyle = st.line;
  g.lineWidth = 2.6;
  for (let i = -CH; i < CW + CH; i += 20) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + CH, CH); g.stroke();
    g.beginPath(); g.moveTo(i, CH); g.lineTo(i + CH, 0); g.stroke();
  }
  g.restore();
  g.strokeStyle = st.frame;
  g.lineWidth = 3.5;
  g.strokeRect(m + 4, m + 4, CW - 2 * m - 8, CH - 2 * m - 8);
  g.restore();
}

export function cardBack(): THREE.Texture {
  if (backTex) return backTex;
  const [c, g] = cardCanvas();
  drawBack(g, backStyle);
  backTex = tex(c, true, 8);
  return backTex;
}

/** Сменить рубашку у всех карт сразу: тот же холст и та же текстура, просто перерисовка. */
export function setCardBack(style: string) {
  if (!CARD_BACKS[style]) return;
  backStyle = style;
  try { localStorage.setItem('pn.back', style); } catch { /* */ }
  if (!backTex) return;
  const c = backTex.image as HTMLCanvasElement;
  drawBack(c.getContext('2d')!, style);
  backTex.needsUpdate = true;
}

// ───────────────────────── Фишки ─────────────────────────
// R — светотень/детали, G — маска белых вставок. Цвет фишки приходит из instanceColor.

export function chipTexture(): THREE.Texture {
  const [c, g] = canvas(1024, 512);
  // левая половина: ребро — частые кремовые вставки-«кирпичики», как у казино-фишек
  g.fillStyle = 'rgb(225,0,0)';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 24; i++) {
    const x = (i / 24) * 512;
    g.fillStyle = 'rgb(240,255,0)';
    g.fillRect(x + 4, 60, 11, 392);
  }
  g.fillStyle = 'rgb(160,0,0)';
  g.fillRect(0, 0, 512, 24); g.fillRect(0, 488, 512, 24);
  // правая половина: торец
  const cx = 768, cy = 256;
  g.fillStyle = 'rgb(225,0,0)';
  g.fillRect(512, 0, 512, 512);
  // внешний пояс вставок
  for (let i = 0; i < 24; i++) {
    g.save(); g.translate(cx, cy); g.rotate((i / 24) * Math.PI * 2);
    g.fillStyle = 'rgb(240,255,0)';
    g.fillRect(-9, -252, 18, 46);
    g.restore();
  }
  // внутренний диск чуть темнее с тонким кремовым кольцом и «гравировкой»
  g.fillStyle = 'rgb(200,0,0)';
  g.beginPath(); g.arc(cx, cy, 165, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgb(235,255,0)'; g.lineWidth = 6;
  g.beginPath(); g.arc(cx, cy, 150, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, 138, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 48; i++) {
    g.save(); g.translate(cx, cy); g.rotate((i / 48) * Math.PI * 2);
    g.fillStyle = 'rgb(235,180,0)';
    g.fillRect(-2, -128, 4, 14);
    g.restore();
  }
  g.fillStyle = 'rgb(235,255,0)';
  g.font = `700 64px ${SERIF}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('♠', cx, cy + 4);
  g.strokeStyle = 'rgb(120,0,0)'; g.lineWidth = 10;
  g.beginPath(); g.arc(cx, cy, 200, 0, Math.PI * 2); g.stroke();
  return tex(c, false, 8);
}

// ───────────────────────── Латунная табличка ─────────────────────────

export function brassPlate(text: string, active = false): THREE.CanvasTexture {
  const [c, g] = canvas(512, 128);
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, active ? '#f2d98a' : '#c9a24e');
  grad.addColorStop(0.45, active ? '#d9b45a' : '#9c7a32');
  grad.addColorStop(1, active ? '#a8862e' : '#5c4418');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 128);
  // шлифовка
  const rnd = mulberry(3);
  g.globalAlpha = 0.08;
  for (let i = 0; i < 300; i++) {
    g.fillStyle = rnd() > 0.5 ? '#fff' : '#000';
    g.fillRect(0, rnd() * 128, 512, 1);
  }
  g.globalAlpha = 1;
  g.strokeStyle = 'rgba(40,28,8,0.6)';
  g.lineWidth = 4;
  g.strokeRect(8, 8, 496, 112);
  // винты
  for (const x of [26, 486]) {
    g.fillStyle = '#4a3610';
    g.beginPath(); g.arc(x, 64, 7, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,240,200,0.5)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x - 5, 64); g.lineTo(x + 5, 64); g.stroke();
  }
  // гравировка: тёмная буква + светлый край снизу
  let size = 54;
  g.font = `italic 600 ${size}px ${SERIF}`;
  while (g.measureText(text).width > 400 && size > 26) { size -= 2; g.font = `italic 600 ${size}px ${SERIF}`; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,236,180,0.45)';
  g.fillText(text, 256, 67);
  g.fillStyle = '#2b1d06';
  g.fillText(text, 256, 64);
  const t = tex(c, true, 4) as THREE.CanvasTexture;
  return t;
}

// ───────────────────────── Дым, свечение ─────────────────────────

export function smokeTexture(): THREE.Texture {
  const [c, g] = canvas(128, 128);
  const rnd = mulberry(11);
  for (let i = 0; i < 26; i++) {
    const x = 64 + (rnd() - 0.5) * 50, y = 64 + (rnd() - 0.5) * 50, r = 14 + rnd() * 30;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.22)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // мягкая маска по краю
  g.globalCompositeOperation = 'destination-in';
  const m = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  m.addColorStop(0, 'rgba(0,0,0,1)');
  m.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = m;
  g.fillRect(0, 0, 128, 128);
  return tex(c, true, 1);
}

export function glowTexture(inner = 'rgba(255,220,160,1)'): THREE.Texture {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.45)'));
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return tex(c, true, 1);
}

export function shaftTexture(): THREE.Texture {
  const [c, g] = canvas(64, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,225,170,0.55)');
  grad.addColorStop(0.5, 'rgba(255,215,160,0.14)');
  grad.addColorStop(1, 'rgba(255,210,150,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 256);
  // мягкие края по горизонтали
  g.globalCompositeOperation = 'destination-in';
  const h = g.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)');
  h.addColorStop(0.5, 'rgba(0,0,0,1)');
  h.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = h;
  g.fillRect(0, 0, 64, 256);
  return tex(c, true, 1);
}

export function blobShadowTexture(): THREE.Texture {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.6)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return tex(c, true, 1);
}

/** Тёмные деревянные панели в глубине зала. */
export function wallTexture(): THREE.Texture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#1d120c';
  g.fillRect(0, 0, 256, 256);
  const rnd = mulberry(5);
  g.globalAlpha = 0.25;
  for (let i = 0; i < 160; i++) {
    g.strokeStyle = rnd() > 0.5 ? '#3a2416' : '#0c0705';
    g.lineWidth = 1 + rnd() * 2;
    const y = rnd() * 256;
    g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(80, y + rnd() * 6, 170, y - rnd() * 6, 256, y); g.stroke();
  }
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.fillRect(0, 0, 6, 256);
  g.fillRect(128, 0, 4, 256);
  const t = tex(c, true, 2);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Тёмный махагон под лаком: волокна и мягкие годичные кольца. */
export function lacquerWoodTexture(): THREE.Texture {
  const [c, g] = canvas(512, 512);
  const grad = g.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, '#1c0c07'); grad.addColorStop(0.5, '#261009'); grad.addColorStop(1, '#170905');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  const rnd = mulberry(77);
  for (let i = 0; i < 260; i++) {
    const y = rnd() * 512, amp = 4 + rnd() * 14, ph = rnd() * 6;
    g.strokeStyle = rnd() > 0.55 ? `rgba(70,32,16,${0.15 + rnd() * 0.25})` : `rgba(5,2,1,${0.2 + rnd() * 0.3})`;
    g.lineWidth = 0.6 + rnd() * 2.2;
    g.beginPath();
    for (let x = 0; x <= 512; x += 16) {
      const yy = y + Math.sin(x / 90 + ph) * amp + Math.sin(x / 23 + ph * 2) * amp * 0.15;
      if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
    }
    g.stroke();
  }
  const t = tex(c, true, 8);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * Карта нормалей хрусталя: ромбическая «алмазная» огранка в нижней части (v < cut),
 * гладкое стекло выше. Высоты → нормали через центральные разности.
 */
export function crystalNormalMap(cut = 0.62, flutes = false): THREE.Texture {
  const W = 512, H = 512;
  const hgt = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const v = 1 - y / H;
    for (let x = 0; x < W; x++) {
      let hv = 0;
      if (v < cut) {
        if (flutes) {
          // вертикальные желобки (пепельница)
          const u = (x / W) * 18;
          hv = Math.abs((u % 1) - 0.5) * 2;
        } else {
          // ромбы: две диагональные сетки
          const u = (x / W) * 16, w = (v / cut) * 5;
          const a = Math.abs(((u + w) % 1) - 0.5), b = Math.abs(((u - w + 100) % 1) - 0.5);
          hv = 1 - Math.min(a, b) * 2;
        }
        // мягкий переход к гладкой части
        hv *= Math.min(1, (cut - v) / 0.04);
      }
      hgt[y * W + x] = hv;
    }
  }
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);
  const s = 2.2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const l = hgt[y * W + ((x - 1 + W) % W)], r = hgt[y * W + ((x + 1) % W)];
    const t = hgt[Math.max(0, y - 1) * W + x], b = hgt[Math.min(H - 1, y + 1) * W + x];
    let nx = (l - r) * s, ny = (b - t) * s, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y * W + x) * 4;
    img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = tex(c, false, 8);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
