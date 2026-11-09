// «Запечённые» текстуры: тяжёлые процедурные текстуры (паркет, стены, бортик, сукно, ковёр, ткань)
// один раз генерируются при сборке и лежат в public/textures/*.webp. В игре они просто скачиваются
// (сотни КБ, параллельно) — вместо секунд расчёта на процессоре телефона.
//
// Нет файла (или ?bake) — текстура считается на месте, как раньше. Пересобрать файлы:  npm run bake

import * as THREE from 'three';
import { Loading } from '../ui/loading';

const BAKE_MODE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('bake');
let manifest: Set<string> | null = null;

/** Загрузить список запечённых текстур (вызывается один раз до создания сцены). */
export async function loadBakeManifest(): Promise<void> {
  if (BAKE_MODE) { manifest = new Set(); return; }
  try {
    const r = await fetch('textures/manifest.json', { cache: 'force-cache' });
    manifest = new Set(r.ok ? (await r.json()).files as string[] : []);
  } catch { manifest = new Set(); }
}

/** В режиме ?bake сюда складываются готовые картинки — их забирает скрипт сборки. */
const recorded: Record<string, string> = {};
let pending = 0;
let total = 0;
let wake: (() => void) | null = null;
/** Дождаться, пока запечённые текстуры скачаются (сплэш висит до этого момента, но не дольше timeout). */
export function bakedReady(timeout = 4000): Promise<void> {
  if (!pending) return Promise.resolve();
  return Promise.race([new Promise<void>(r => { wake = r; }), new Promise<void>(r => setTimeout(r, timeout))]);
}
const done = () => {
  Loading.set('textures', total ? 1 - (pending - 1) / total : 1);
  if (--pending <= 0) { pending = 0; wake?.(); wake = null; }
};
if (BAKE_MODE) (window as unknown as { __baked: Record<string, string> }).__baked = recorded;

type Opts = { srgb: boolean; repeat?: boolean; anisotropy?: number };

function make(o: Opts) {
  const t = new THREE.Texture();
  if (o.srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = o.anisotropy ?? 16;
  if (o.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function fill(t: THREE.Texture, img: TexImageSource) {
  t.image = img;
  t.needsUpdate = true;
}

/**
 * Набор текстур под одним именем: gen() рисует все холсты разом (как раньше),
 * а при наличии запечённых файлов не вызывается вовсе.
 */
export function bakedSet<K extends string>(name: string, opts: Record<K, Opts>, gen: () => Record<K, HTMLCanvasElement>): Record<K, THREE.Texture> {
  const keys = Object.keys(opts) as K[];
  const out = {} as Record<K, THREE.Texture>;
  for (const k of keys) out[k] = make(opts[k]);
  const files = keys.map(k => `${name}.${k}.webp`);
  if (!BAKE_MODE && manifest && files.every(f => manifest!.has(f))) {
    keys.forEach((k, i) => {
      const img = new Image();
      img.decoding = 'async';
      pending++; total++;
      img.onload = () => { fill(out[k], img); done(); };
      img.onerror = () => { const c = gen(); for (const kk of keys) fill(out[kk], c[kk]); done(); };
      img.src = 'textures/' + files[i];
      // без заглушки: WebGL выделяет память под текстуру один раз — по размеру первой картинки
    });
    return out;
  }
  const c = gen();
  keys.forEach((k, i) => {
    fill(out[k], c[k]);
    if (BAKE_MODE) recorded[files[i]] = c[k].toDataURL('image/webp', opts[k].srgb ? 0.9 : 0.85);
  });
  return out;
}

export const bakeMode = BAKE_MODE;
