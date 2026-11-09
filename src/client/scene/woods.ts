// Дерево клуба 1920-х: паркет «ёлочкой», панели буазери, полированный бортик, бордовые кнопки.
// Всё рисуется процедурно один раз при старте (без внешних файлов) — цвет + шероховатость + рельеф.

import * as THREE from 'three';
import { SERIF } from './textures';
import { bakedSet } from './bake';

type RGB = [number, number, number];
interface Palette { dark: RGB; mid: RGB; light: RGB }

export const WOOD = {
  walnut: { dark: [26, 13, 8], mid: [58, 32, 18], light: [92, 56, 32] } as Palette,
  wine: { dark: [38, 6, 14], mid: [86, 18, 34], light: [138, 42, 58] } as Palette,
  mahogany: { dark: [22, 8, 5], mid: [52, 20, 11], light: [96, 44, 24] } as Palette,
};

// ── шум ──
function hash(x: number, y: number, s: number) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, s: number) {
  return vnoise(x, y, s) * 0.55 + vnoise(x * 2.1, y * 2.1, s + 1) * 0.28 + vnoise(x * 4.3, y * 4.3, s + 2) * 0.17;
}

/**
 * Волокно древесины в точке: along — вдоль волокна, across — поперёк (в «миллиметрах» условно).
 * Возвращает 0..1: 0 — тёмная поздняя древесина, 1 — светлая.
 */
function grain(along: number, across: number, seed: number) {
  const warp = fbm(along * 0.012, across * 0.05, seed) * 9;
  const rings = Math.sin((across + warp) * 0.55) * 0.5 + 0.5;
  const fine = vnoise(along * 0.02, across * 1.6, seed + 7);
  const pores = vnoise(along * 0.6, across * 2.5, seed + 9) > 0.86 ? 0.35 : 0;
  return Math.min(1, Math.max(0, rings * 0.55 + fine * 0.45 - pores));
}

function shade(p: Palette, g: number, tint: number): RGB {
  const t = g * tint;
  const a = t < 0.5 ? p.dark : p.mid, b = t < 0.5 ? p.mid : p.light;
  const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function finish(c: HTMLCanvasElement, srgb: boolean, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Просто доска: вертикальное волокно. */
export function woodCanvas(w: number, h: number, p: Palette, seed: number, scale = 1, horizontal = false): HTMLCanvasElement {
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gv = horizontal ? grain(x * scale, y * scale, seed) : grain(y * scale, x * scale, seed);
    const [r, gg, b] = shade(p, gv, 1);
    const i = (y * w + x) * 4;
    d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ───────────────────────── паркет «ёлочкой» ─────────────────────────

/**
 * Ёлочка: плашки 1×n под 45°. В «ступенчатых» координатах плашка H_k = [k,k+n)×[k,k+1),
 * V_k = [k+n,k+n+1)×[k−n+1,k+1); полосы повторяются со сдвигом (−n, n). Поворот на 45° даёт ёлочку.
 */
export function parquetTextures(size: number) {
  return bakedSet(`parquet-${size}`, { map: { srgb: true }, rough: { srgb: false }, bump: { srgb: false } }, () => parquetCanvases(size));
}

function parquetCanvases(size: number) {
  const n = 4;
  const s = size / 8 / Math.SQRT2;      // ширина плашки в пикселях (8 плашек на тайл)
  const [c, g] = canvas(size, size);
  const [rc, rg] = canvas(size, size);
  const [bc, bg] = canvas(size, size);
  const img = g.createImageData(size, size), rimg = rg.createImageData(size, size), bimg = bg.createImageData(size, size);
  const d = img.data, rd = rimg.data, bd = bimg.data;
  const P = WOOD.walnut;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const u = px + 0.5, v = py + 0.5;
    const x = (u - v) / (Math.SQRT2 * s), y = (u + v) / (Math.SQRT2 * s);
    // какая полоса и какая плашка
    let found = false, along = 0, across = 0, id = 0, edge = 1;
    const m0 = Math.floor((x - y) / (2 * n));
    for (let m = m0 - 1; m <= m0 + 2 && !found; m++) {
      const xx = x + m * n, yy = y - m * n;
      let k = Math.floor(yy);
      if (xx >= k && xx < k + n) {
        found = true; along = xx - k; across = yy - k; id = k * 2 + m * 1000;
        edge = Math.min(along, n - along, across, 1 - across);
        break;
      }
      k = Math.floor(xx) - n;
      if (yy >= k - n + 1 && yy < k + 1) {
        found = true; along = yy - (k - n + 1); across = xx - (k + n); id = k * 2 + 1 + m * 1000;
        edge = Math.min(along, n - along, across, 1 - across);
      }
    }
    const tint = 0.78 + hash(id, 3, 11) * 0.42;
    const gv = grain(along * 60 + hash(id, 1, 5) * 900, across * 60 + hash(id, 2, 6) * 300, 17);
    let [r, gg, b] = shade(P, gv, tint);
    const ePx = edge * s;
    const gap = ePx < 0.9 ? 0.18 : ePx < 2.2 ? 0.55 + (ePx - 0.9) * 0.3 : 1;
    r *= gap; gg *= gap; b *= gap;
    const i = (py * size + px) * 4;
    d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
    // полированный лак: гладко, щели — матовые
    const rough = ePx < 1.6 ? 200 : 46 + (1 - gv) * 30 + hash(id, 9, 1) * 18;
    rd[i] = rd[i + 1] = rd[i + 2] = rough; rd[i + 3] = 255;
    const h = ePx < 1.2 ? 40 : 200 + gv * 30;
    bd[i] = bd[i + 1] = bd[i + 2] = h; bd[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); rg.putImageData(rimg, 0, 0); bg.putImageData(bimg, 0, 0);
  return { map: c, rough: rc, bump: bc };
}

// ───────────────────────── буазери ─────────────────────────

/**
 * Секция стены (ширина 1 : высота 2): нижняя филёнка, поясок, высокая верхняя филёнка с калёвкой,
 * карниз. Цвет, шероховатость и рельеф — отдельными картами.
 */
export function boiserieTextures(w: number) {
  const h = w * 2;
  const base = woodCanvas(w, h, WOOD.walnut, 31, 512 / w);
  const [c, g] = canvas(w, h);
  const [bc, bg] = canvas(w, h);
  g.drawImage(base, 0, 0);
  bg.fillStyle = '#808080'; bg.fillRect(0, 0, w, h);
  const u = w / 512;
  // рамка-калёвка: светлая фаска сверху-слева, тень снизу-справа
  const panel = (x: number, y: number, pw: number, ph: number) => {
    // утопленное поле филёнки
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x, y, pw, ph);
    const bev = 14 * u;
    g.lineWidth = bev;
    g.strokeStyle = 'rgba(255,214,160,0.13)';
    g.beginPath(); g.moveTo(x, y + ph); g.lineTo(x, y); g.lineTo(x + pw, y); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.beginPath(); g.moveTo(x + pw, y); g.lineTo(x + pw, y + ph); g.lineTo(x, y + ph); g.stroke();
    // тонкая золочёная нитка внутри — как в клубах той эпохи
    g.lineWidth = 2 * u;
    g.strokeStyle = 'rgba(200,160,80,0.28)';
    g.strokeRect(x + 26 * u, y + 26 * u, pw - 52 * u, ph - 52 * u);
    // рельеф
    bg.fillStyle = '#5a5a5a'; bg.fillRect(x, y, pw, ph);
    bg.lineWidth = bev; bg.strokeStyle = '#d0d0d0'; bg.strokeRect(x + bev / 2, y + bev / 2, pw - bev, ph - bev);
    bg.lineWidth = 3 * u; bg.strokeStyle = '#a0a0a0'; bg.strokeRect(x + 26 * u, y + 26 * u, pw - 52 * u, ph - 52 * u);
  };
  const m = 46 * u;
  panel(m, 150 * u, w - 2 * m, h * 0.52);            // верхняя высокая филёнка
  const railY = 150 * u + h * 0.52 + 60 * u;
  // поясок (chair rail)
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, railY, w, 34 * u);
  g.fillStyle = 'rgba(255,214,160,0.12)'; g.fillRect(0, railY, w, 6 * u);
  bg.fillStyle = '#e0e0e0'; bg.fillRect(0, railY, w, 34 * u);
  panel(m, railY + 80 * u, w - 2 * m, h - railY - 150 * u);   // нижняя филёнка
  // карниз сверху и плинтус снизу
  g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(0, 0, w, 60 * u); g.fillRect(0, h - 50 * u, w, 50 * u);
  g.fillStyle = 'rgba(255,214,160,0.1)'; g.fillRect(0, 60 * u, w, 5 * u);
  bg.fillStyle = '#f0f0f0'; bg.fillRect(0, 0, w, 60 * u); bg.fillRect(0, h - 50 * u, w, 50 * u);
  // стыки секций
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 0, 3 * u, h); g.fillRect(w - 3 * u, 0, 3 * u, h);
  return { map: finish(c, true), bump: finish(bc, false) };
}

// ───────────────────────── бордовые кнопки ─────────────────────────

let wineBase: HTMLCanvasElement | null = null;

/**
 * Лицо кнопки: полированное винное дерево, надпись — инкрустация слоновой костью
 * (светлая, контрастная, с тонкой тенью) — читается с любого угла. Отдельная карта свечения — только буквы.
 */
export function woodButtonTextures(label: string, sub: string) {
  const W = 1024, H = 360;
  // волокно считаем в половинном размере и растягиваем — разницы не видно, а старт в 4 раза быстрее
  if (!wineBase) wineBase = woodCanvas(W / 2, H / 2, WOOD.wine, 53, 1.1, true);
  const [c, g] = canvas(W, H);
  const [ec, eg] = canvas(W, H);
  g.drawImage(wineBase, 0, 0, W, H);   // волокно идёт вдоль кнопки
  // мягкий блик по центру и затемнение к краям — объём полированной поверхности
  const v = g.createRadialGradient(W / 2, H * 0.35, 20, W / 2, H / 2, W * 0.62);
  v.addColorStop(0, 'rgba(255,190,190,0.10)'); v.addColorStop(0.6, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  // тонкая латунная окантовка
  // тонкая золотая рамка-филёнка по краю кнопки
  g.lineWidth = 6; g.strokeStyle = 'rgba(20,6,4,0.65)'; g.strokeRect(20, 20, W - 40, H - 40);
  g.lineWidth = 3; g.strokeStyle = 'rgba(214,176,96,0.55)'; g.strokeRect(30, 30, W - 60, H - 60);
  g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.strokeRect(30, 30, W - 60, H - 60);
  eg.fillStyle = '#000'; eg.fillRect(0, 0, W, H);

  g.textAlign = 'center'; g.textBaseline = 'middle';
  eg.textAlign = 'center'; eg.textBaseline = 'middle';
  let size = 140;
  const font = (s: number) => `700 ${s}px ${SERIF}`;
  g.font = font(size);
  while (g.measureText(label).width > W - 160 && size > 70) { size -= 4; g.font = font(size); }
  const y = sub ? H * 0.38 : H * 0.53;
  // гравировка, залитая сусальным золотом: тёмная канавка → золото с бликом → светлая кромка
  g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillText(label, W / 2 + 3, y + 5);
  const gold = g.createLinearGradient(0, y - size / 2, 0, y + size / 2);
  gold.addColorStop(0, '#fff3c4'); gold.addColorStop(0.45, '#f0cf6a'); gold.addColorStop(0.55, '#c9982f'); gold.addColorStop(1, '#f6dc8e');
  g.fillStyle = gold; g.fillText(label, W / 2, y);
  g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,248,220,0.35)'; g.strokeText(label, W / 2 - 1, y - 1);
  eg.font = font(size); eg.fillStyle = '#fff'; eg.fillText(label, W / 2, y);
  if (sub) {
    g.font = `700 92px ${SERIF}`;
    g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillText(sub, W / 2 + 2, H * 0.76 + 3);
    g.fillStyle = '#f0cf6a'; g.fillText(sub, W / 2, H * 0.76);
    eg.font = `700 92px ${SERIF}`; eg.fillStyle = '#ccc'; eg.fillText(sub, W / 2, H * 0.76);
  }
  const map = finish(c, true, false);
  const emissiveMap = finish(ec, true, false);
  return { map, emissiveMap };
}

// ───────────────────────── бортик стола ─────────────────────────

/** Полированное тёмное красное дерево (махагон): цвет + рельеф волокна. Атласный лак, без зеркала. */
export function railWoodTextures(size: number) {
  return bakedSet(`railwood-${size}`, { map: { srgb: true }, bump: { srgb: false } }, () => railWoodCanvases(size));
}

function railWoodCanvases(size: number) {
  const base = woodCanvas(size, size, WOOD.mahogany, 91, 900 / size, true);
  // «пламенный» махагон: поперечные переливы фигуры (fiddleback) и глубина — как у дорогих столов
  {
    const g = base.getContext('2d')!;
    const img = g.getImageData(0, 0, size, size), d = img.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const fig = Math.sin(x * 0.09 + fbm(x * 0.004, y * 0.02, 77) * 9) * 0.5 + 0.5;
      const k = 0.86 + fig * 0.3;
      d[i] = Math.min(255, d[i] * k * 1.06); d[i + 1] = Math.min(255, d[i + 1] * k); d[i + 2] = Math.min(255, d[i + 2] * k * 0.94);
    }
    g.putImageData(img, 0, 0);
  }
  const [bc, bg] = canvas(size, size);
  bg.drawImage(base, 0, 0);
  bg.globalCompositeOperation = 'saturation';
  bg.fillStyle = '#808080'; bg.fillRect(0, 0, size, size);
  return { map: base, bump: bc };
}

// ───────────────────────── ткань пиджака ─────────────────────────

/** Шерсть с диагональной саржей: карта рельефа плетения + лёгкий меланж цвета. */
export function woolTextures(size = 256) {
  return bakedSet(`wool-${size}`, { map: { srgb: true }, bump: { srgb: false } }, () => woolCanvases(size));
}

function woolCanvases(size: number) {
  const [c, g] = canvas(size, size);
  const [bc, bg] = canvas(size, size);
  const img = g.createImageData(size, size), bimg = bg.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const tw = Math.sin((x + y) * Math.PI / 4) * 0.5 + 0.5;            // саржа 45°
    const fibre = vnoise(x * 0.9, y * 0.12, 3) * 0.6 + vnoise(x * 0.15, y * 1.1, 4) * 0.4;
    const mel = fbm(x * 0.05, y * 0.05, 8);
    const i = (y * size + x) * 4;
    const v = 0.78 + mel * 0.22 + (fibre - 0.5) * 0.18;
    img.data[i] = 255 * v * 0.92; img.data[i + 1] = 255 * v * 0.95; img.data[i + 2] = 255 * v; img.data[i + 3] = 255;
    const h = 90 + tw * 110 + (fibre - 0.5) * 60;
    bimg.data[i] = bimg.data[i + 1] = bimg.data[i + 2] = h; bimg.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); bg.putImageData(bimg, 0, 0);
  return { map: c, bump: bc };
}

// ───────────────────────── стены клуба: шёлковые обои с дамаском + деревянные панели ─────────────────────────

/** Узор дамаска: симметричный «медальон» из завитков (рисуется в ячейке cw×ch с центром cx,cy). */
function damaskMotif(g: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  g.save();
  g.translate(cx, cy);
  for (const sx of [-1, 1]) {
    g.save();
    g.scale(sx, 1);
    g.beginPath();
    // внешний лист
    g.moveTo(0, -s);
    g.bezierCurveTo(s * 0.55, -s * 0.75, s * 0.7, -s * 0.2, s * 0.32, s * 0.12);
    g.bezierCurveTo(s * 0.62, s * 0.3, s * 0.5, s * 0.78, 0, s);
    g.lineTo(0, s * 0.62);
    g.bezierCurveTo(s * 0.26, s * 0.5, s * 0.3, s * 0.28, s * 0.12, s * 0.12);
    g.bezierCurveTo(s * 0.36, -s * 0.15, s * 0.3, -s * 0.55, 0, -s * 0.66);
    g.closePath();
    g.fill();
    // завиток
    g.beginPath();
    g.arc(s * 0.46, -s * 0.42, s * 0.12, 0, Math.PI * 1.6);
    g.lineWidth = s * 0.045;
    g.stroke();
    g.restore();
  }
  // сердцевина
  g.beginPath();
  g.ellipse(0, 0, s * 0.09, s * 0.22, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

export function clubWallTextures(w: number) {
  return bakedSet(`clubwall-${w}`, { map: { srgb: true }, bump: { srgb: false } }, () => clubWallCanvases(w));
}

function clubWallCanvases(w: number) {
  const h = w * 2;
  const u = w / 512;
  const base = woodCanvas(w, h, WOOD.walnut, 37, 512 / w);
  const [c, g] = canvas(w, h);
  const [bc, bg] = canvas(w, h);
  g.drawImage(base, 0, 0);
  bg.fillStyle = '#808080'; bg.fillRect(0, 0, w, h);

  const top = 70 * u, railY = h * 0.6, frame = 26 * u;
  // ── шёлковые обои: глубокое бордо, узор чуть светлее, тонкий золотой отсвет по краю мотива
  const wx = frame, wy = top + frame, ww = w - 2 * frame, wh = railY - top - 2 * frame;
  g.save();
  g.beginPath(); g.rect(wx, wy, ww, wh); g.clip();
  const silk = g.createLinearGradient(0, wy, 0, wy + wh);
  silk.addColorStop(0, '#24080f'); silk.addColorStop(0.5, '#2e0b14'); silk.addColorStop(1, '#1e060c');
  g.fillStyle = silk; g.fillRect(wx, wy, ww, wh);
  // мелкая шёлковая полоска
  g.globalAlpha = 0.07;
  for (let x = wx; x < wx + ww; x += 3 * u) { g.fillStyle = x % (6 * u) < 3 * u ? '#000' : '#5a1a28'; g.fillRect(x, wy, 1.5 * u, wh); }
  g.globalAlpha = 1;
  const cell = ww / 2;
  for (let row = -1; row * cell * 1.3 < wh + cell; row++) {
    for (let col = -1; col <= 2; col++) {
      const cx = wx + col * cell + (row % 2 ? cell / 2 : 0) + cell / 2;
      const cy = wy + row * cell * 1.3 + cell * 0.65;
      g.fillStyle = 'rgba(92,26,40,0.55)';
      g.strokeStyle = 'rgba(92,26,40,0.55)';
      damaskMotif(g, cx, cy, cell * 0.36);
      g.fillStyle = 'rgba(196,150,80,0.05)';
      damaskMotif(g, cx - 1.2 * u, cy - 1.2 * u, cell * 0.36);
      bg.fillStyle = '#9a9a9a'; bg.strokeStyle = '#9a9a9a';
      damaskMotif(bg, cx, cy, cell * 0.36);
    }
  }
  g.restore();
  bg.fillStyle = 'rgba(0,0,0,0)';
  // рамка-молдинг вокруг обоев с золочёной ниткой
  const mold = (x: number, y: number, mw: number, mh: number) => {
    g.lineWidth = 12 * u;
    g.strokeStyle = 'rgba(255,214,160,0.12)';
    g.beginPath(); g.moveTo(x, y + mh); g.lineTo(x, y); g.lineTo(x + mw, y); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.beginPath(); g.moveTo(x + mw, y); g.lineTo(x + mw, y + mh); g.lineTo(x, y + mh); g.stroke();
    g.lineWidth = 2.2 * u; g.strokeStyle = 'rgba(206,164,86,0.45)';
    g.strokeRect(x + 8 * u, y + 8 * u, mw - 16 * u, mh - 16 * u);
    bg.lineWidth = 12 * u; bg.strokeStyle = '#e0e0e0'; bg.strokeRect(x, y, mw, mh);
  };
  mold(wx, wy, ww, wh);
  // поясок (chair rail) и нижняя деревянная филёнка
  g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(0, railY - 8 * u, w, 40 * u);
  g.fillStyle = 'rgba(255,214,160,0.14)'; g.fillRect(0, railY - 8 * u, w, 5 * u);
  g.fillStyle = 'rgba(206,164,86,0.35)'; g.fillRect(0, railY + 14 * u, w, 2 * u);
  bg.fillStyle = '#f0f0f0'; bg.fillRect(0, railY - 8 * u, w, 40 * u);
  const ly = railY + 70 * u, lh = h - ly - 90 * u;
  g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(frame + 10 * u, ly, w - 2 * frame - 20 * u, lh);
  mold(frame + 10 * u, ly, w - 2 * frame - 20 * u, lh);
  // карниз и плинтус
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, 0, w, top); g.fillRect(0, h - 60 * u, w, 60 * u);
  g.fillStyle = 'rgba(255,214,160,0.1)'; g.fillRect(0, top - 6 * u, w, 4 * u); g.fillRect(0, h - 60 * u, w, 3 * u);
  bg.fillStyle = '#f4f4f4'; bg.fillRect(0, 0, w, top); bg.fillRect(0, h - 60 * u, w, 60 * u);
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 0, 3 * u, h); g.fillRect(w - 3 * u, 0, 3 * u, h);
  return { map: c, bump: bc };
}

// ───────────────────────── ковёр под столом ─────────────────────────

/** Старый персидский ковёр: тёмно-красное поле, медальон, каймы, мелкий узор и потёртость. */
export function rugTexture(size: number) {
  return bakedSet(`rug-${size}`, { map: { srgb: true, repeat: false } }, () => ({ map: rugCanvas(size) })).map;
}

function rugCanvas(size: number) {
  const W = size, H = Math.round(size * 1.3);
  const [c, g] = canvas(W, H);
  g.fillStyle = '#3a0c10'; g.fillRect(0, 0, W, H);
  const band = (inset: number, width: number, color: string) => { g.strokeStyle = color; g.lineWidth = width; g.strokeRect(inset, inset, W - 2 * inset, H - 2 * inset); };
  band(W * 0.03, W * 0.05, '#14182a');
  band(W * 0.075, W * 0.012, '#9a7a3c');
  band(W * 0.1, W * 0.03, '#5a1218');
  band(W * 0.125, W * 0.008, '#9a7a3c');
  // мелкий узор каймы
  g.fillStyle = '#7a6230';
  for (let i = 0; i < 60; i++) {
    const t = i / 60;
    for (const [x, y] of [[W * 0.03 + t * W * 0.94, W * 0.03], [W * 0.03 + t * W * 0.94, H - W * 0.03], [W * 0.03, W * 0.03 + t * (H - W * 0.06)], [W - W * 0.03, W * 0.03 + t * (H - W * 0.06)]]) {
      g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillRect(-W * 0.008, -W * 0.008, W * 0.016, W * 0.016); g.restore();
    }
  }
  // центральный медальон
  g.save();
  g.translate(W / 2, H / 2);
  for (const [r, col] of [[0.3, '#14182a'], [0.26, '#6a1a1c'], [0.18, '#9a7a3c'], [0.15, '#2a0a0e'], [0.07, '#8a6a32']] as [number, string][]) {
    g.fillStyle = col;
    g.beginPath();
    for (let k = 0; k <= 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const rr = W * r * (k % 2 ? 0.82 : 1);
      g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 1.25);
    }
    g.fill();
  }
  g.restore();
  // угловые четвертинки медальона
  for (const [x, y] of [[0.14, 0.14], [0.86, 0.14], [0.14, 0.86], [0.86, 0.86]]) {
    g.fillStyle = '#14182a';
    g.beginPath(); g.arc(W * x, H * y, W * 0.12, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#6a1a1c';
    g.beginPath(); g.arc(W * x, H * y, W * 0.07, 0, Math.PI * 2); g.fill();
  }
  // ворс и потёртость
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const wear = fbm(x * 0.012, y * 0.012, 21);
    const pile = (hash(x, y, 4) - 0.5) * 26;
    const k = 0.62 + wear * 0.55;
    d[i] = d[i] * k + pile; d[i + 1] = d[i + 1] * k + pile; d[i + 2] = d[i + 2] * k + pile;
  }
  g.putImageData(img, 0, 0);
  return c;
}
