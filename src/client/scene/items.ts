// 3D-модели предметов бутика. Купленный предмет лежит на столе у владельца — его видят все.
// Модели процедурные (без файлов): лёгкие, 1–3 тыс. треугольников, общие материалы.
//
// Как добавить предмет:
//   1) в src/shared/Catalog.ts → CATALOG: { id: 'GOLD_LIGHTER', name: 'Золотая зажигалка', note: '...', price: 20000, model: 'lighter' }
//   2) здесь → ITEM_MODELS: lighter: () => { ...вернуть THREE.Object3D, лежащий на сукне (y = 0 — поверхность стола) }
//      Готовую модель .glb можно загрузить через GLTFLoader и вернуть её копию.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** масштаб предметов: как у фишек и рук — чуть крупнее жизни, ближний план */
const K = 1.55;

const lazy = <T>(f: () => T) => { let v: T | null = null; return () => (v ??= f()); };

function stripes(w: number, h: number, period: number, soft = 0.5, vertical = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < (vertical ? w : h); x += period) {
    const grad = vertical ? g.createLinearGradient(x, 0, x + period, 0) : g.createLinearGradient(0, x, 0, x + period);
    grad.addColorStop(0, '#202020'); grad.addColorStop(soft, '#f0f0f0'); grad.addColorStop(1, '#202020');
    g.fillStyle = grad;
    if (vertical) g.fillRect(x, 0, period, h); else g.fillRect(0, x, w, period);
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}

// ───────────────────────── материалы (общие) ─────────────────────────

const M = {
  // смартфон: матовый анодированный алюминий цвета бордо (как на фото) + полированная рамка
  phoneBack: lazy(() => new THREE.MeshPhysicalMaterial({ color: 0x4c1427, metalness: 0.55, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 1.2 })),
  phoneFrame: lazy(() => new THREE.MeshPhysicalMaterial({ color: 0x5a1a2e, metalness: 0.9, roughness: 0.22, envMapIntensity: 1.5 })),
  lensGlass: lazy(() => new THREE.MeshPhysicalMaterial({ color: 0x050507, metalness: 0.2, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.2 })),
  lensRing: lazy(() => new THREE.MeshStandardMaterial({ color: 0x8a5a68, metalness: 1, roughness: 0.18, envMapIntensity: 1.6 })),
  flash: lazy(() => new THREE.MeshStandardMaterial({ color: 0xf2e6cf, roughness: 0.3, emissive: 0x2a2418 })),
  screen: lazy(() => new THREE.MeshPhysicalMaterial({ color: 0x020203, roughness: 0.06, clearcoat: 1, envMapIntensity: 1.8 })),
  // ТТ: воронёная сталь с потёртостями на гранях, бакелитовые щёчки
  blued: lazy(() => new THREE.MeshPhysicalMaterial({ color: 0x1b1d22, metalness: 0.88, roughness: 0.34, clearcoat: 0.25, clearcoatRoughness: 0.3, envMapIntensity: 1.4 })),
  worn: lazy(() => new THREE.MeshStandardMaterial({ color: 0x4a4d54, metalness: 0.95, roughness: 0.28, envMapIntensity: 1.5 })),
  grip: lazy(() => new THREE.MeshStandardMaterial({ color: 0x0c0b0b, roughness: 0.48, metalness: 0.05, bumpMap: stripes(64, 256, 8, 0.5), bumpScale: 2.2, envMapIntensity: 0.9 })),
  serr: lazy(() => new THREE.MeshPhysicalMaterial({ color: 0x1b1d22, metalness: 0.88, roughness: 0.4, bumpMap: stripes(128, 32, 8, 0.5), bumpScale: 2.5, envMapIntensity: 1.3 })),
  // ключ: зеркальный хром и софт-тач пластик
  chrome: lazy(() => new THREE.MeshPhysicalMaterial({ color: 0xe8e8ec, metalness: 1, roughness: 0.07, clearcoat: 0.6, envMapIntensity: 2.4 })),
  softBlack: lazy(() => new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.62, metalness: 0, envMapIntensity: 0.6 })),
  btn: lazy(() => new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.5, envMapIntensity: 0.8 })),
};

const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
  const x = new THREE.Mesh(g, m);
  x.castShadow = true;
  return x;
};

// ───────────────────────── смартфон Pro Max, бордо ─────────────────────────

function phone(): THREE.Object3D {
  const root = new THREE.Group();
  const W = 0.0776, H = 0.1636, T = 0.0088;   // настоящие размеры, метры
  const body = new THREE.Group();
  // экраном вниз — видна спинка с камерами, как на фото
  const frame = mesh(new RoundedBoxGeometry(W, T, H, 5, 0.0085), M.phoneFrame());
  const back = mesh(new RoundedBoxGeometry(W - 0.0016, 0.0006, H - 0.0016, 4, 0.0075), M.phoneBack());
  back.position.y = T / 2 - 0.0001;
  const glass = mesh(new RoundedBoxGeometry(W - 0.002, 0.0006, H - 0.002, 4, 0.0075), M.screen());
  glass.position.y = -T / 2 + 0.0001;
  body.add(frame, back, glass);
  // плато камер: большой скруглённый квадрат во всю ширину верхней части
  const plat = mesh(new RoundedBoxGeometry(W - 0.006, 0.0018, 0.036, 4, 0.0075), M.phoneBack());
  plat.position.set(0, T / 2 + 0.0008, -H / 2 + 0.022);
  body.add(plat);
  const lens = (x: number, z: number) => {
    const ring = mesh(new THREE.CylinderGeometry(0.0072, 0.0074, 0.0024, 32), M.lensRing());
    ring.position.set(x, T / 2 + 0.0026, z);
    const gl = mesh(new THREE.CylinderGeometry(0.0062, 0.0062, 0.0026, 32), M.lensGlass());
    gl.position.set(x, T / 2 + 0.0028, z);
    body.add(ring, gl);
  };
  const lz = -H / 2 + 0.022;
  lens(-0.021, lz - 0.0085); lens(-0.021, lz + 0.0085); lens(-0.0055, lz);
  const flash = mesh(new THREE.CylinderGeometry(0.0032, 0.0032, 0.0019, 20), M.flash());
  flash.position.set(0.024, T / 2 + 0.0019, lz - 0.009);
  const lidar = mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.0019, 20), M.lensGlass());
  lidar.position.set(0.024, T / 2 + 0.0019, lz + 0.009);
  body.add(flash, lidar);
  // кнопки на рамке
  const side = mesh(new THREE.BoxGeometry(0.0012, 0.004, 0.022), M.phoneFrame());
  side.position.set(W / 2 + 0.0004, 0, -0.025);
  body.add(side);
  body.position.y = T / 2;
  body.scale.setScalar(K);
  root.add(body);
  return root;
}

// ───────────────────────── ТТ (Тульский Токарев) ─────────────────────────

function tt(): THREE.Object3D {
  const root = new THREE.Group();
  const p = new THREE.Group();   // модель в плоскости XY (вид сбоку), ствол вдоль −X; потом кладём на бок
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, r = 0.0012) => {
    const b = mesh(new RoundedBoxGeometry(w, h, d, 2, r), m);
    b.position.set(x, y, 0);
    p.add(b);
    return b;
  };
  // затвор-кожух: длинный, с насечкой сзади
  box(0.152, 0.026, 0.0185, M.blued(), -0.004, 0.064);
  const serr = box(0.032, 0.0222, 0.0192, M.serr(), 0.052, 0.064, 0.0008);
  serr.position.z = 0;
  // ствол и втулка
  const muzzle = mesh(new THREE.CylinderGeometry(0.0058, 0.0058, 0.006, 20), M.worn());
  muzzle.rotation.z = Math.PI / 2;
  muzzle.position.set(-0.0815, 0.066, 0);
  p.add(muzzle);
  // мушка и целик
  box(0.004, 0.005, 0.003, M.blued(), -0.072, 0.0785, 0.0006);
  box(0.006, 0.005, 0.009, M.blued(), 0.066, 0.0785, 0.0006);
  // рамка
  box(0.118, 0.013, 0.0172, M.blued(), 0.006, 0.0455);
  // рукоять: наклонная, щёчки с рёбрами
  const gripG = new THREE.Group();
  const gb = mesh(new RoundedBoxGeometry(0.03, 0.074, 0.0172, 2, 0.002), M.blued());
  const cheek = mesh(new RoundedBoxGeometry(0.024, 0.062, 0.0206, 2, 0.003), M.grip());
  cheek.position.y = 0.002;
  gripG.add(gb, cheek);
  const medal = mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.0212, 20), M.worn());   // звёздочка-медальон (условно)
  medal.rotation.x = Math.PI / 2;
  medal.position.y = 0.016;
  gripG.add(medal);
  const mag = mesh(new RoundedBoxGeometry(0.026, 0.006, 0.014, 1, 0.001), M.worn());
  mag.position.y = -0.039;
  gripG.add(mag);
  gripG.position.set(0.046, 0.006, 0);
  gripG.rotation.z = 0.2;
  p.add(gripG);
  // спусковая скоба и крючок
  const guard = mesh(new THREE.TorusGeometry(0.0125, 0.0023, 8, 24, Math.PI * 1.1), M.blued());
  guard.rotation.z = Math.PI * 0.95;
  guard.position.set(0.012, 0.035, 0);
  guard.scale.set(1.25, 1, 1);
  p.add(guard);
  box(0.004, 0.013, 0.004, M.worn(), 0.014, 0.032, 0.0008).rotation.z = 0.35;
  // курок и затворная задержка
  box(0.008, 0.01, 0.007, M.blued(), 0.08, 0.071, 0.0012).rotation.z = -0.4;
  box(0.022, 0.0035, 0.0198, M.worn(), -0.006, 0.054, 0.0008);
  // кладём на бок, рукоятью к игроку
  p.rotation.x = -Math.PI / 2;
  p.position.y = 0.0101;
  p.position.x = -0.006;
  const holder = new THREE.Group();
  holder.add(p);
  holder.scale.setScalar(K * 1.25);
  root.add(holder);
  return root;
}

// ───────────────────────── ключ от внедорожника ─────────────────────────

function keyFob(): THREE.Object3D {
  const root = new THREE.Group();
  // силуэт корпуса: каплевидный овал, сужающийся к лезвию
  const s = new THREE.Shape();
  const L = 0.074, R = 0.019, r = 0.0105;
  s.moveTo(-L / 2, 0);
  s.absarc(-L / 2 + R, 0, R, Math.PI, Math.PI * 1.5, false);
  s.bezierCurveTo(-L / 2 + R + 0.02, -R, L / 2 - r - 0.012, -r - 0.002, L / 2 - r, -r);
  s.absarc(L / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.bezierCurveTo(L / 2 - r - 0.012, r + 0.002, -L / 2 + R + 0.02, R, -L / 2 + R, R);
  s.absarc(-L / 2 + R, 0, R, Math.PI / 2, Math.PI, false);
  const shell = mesh(new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 5, curveSegments: 28 }), M.chrome());
  shell.rotation.x = -Math.PI / 2;
  shell.position.y = 0.004;
  // чёрная софт-тач вставка сверху
  const inset = new THREE.Shape();
  const sc = 0.82;
  inset.moveTo(-L / 2 * sc, 0);
  inset.absarc(-L / 2 * sc + R * sc, 0, R * sc, Math.PI, Math.PI * 1.5, false);
  inset.lineTo(L / 2 * sc - r, -r * 0.85);
  inset.lineTo(L / 2 * sc - r, r * 0.85);
  inset.lineTo(-L / 2 * sc + R * sc, R * sc);
  inset.absarc(-L / 2 * sc + R * sc, 0, R * sc, Math.PI / 2, Math.PI, false);
  const top = mesh(new THREE.ExtrudeGeometry(inset, { depth: 0.0015, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0008, bevelSegments: 2, curveSegments: 20 }), M.softBlack());
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.0162;
  // кнопки: закрыть, открыть, багажник — просто рельефные клавиши без логотипов
  const keyBtn = (x: number, z: number) => {
    const b = mesh(new RoundedBoxGeometry(0.012, 0.0016, 0.011, 2, 0.0015), M.btn());
    b.position.set(x, 0.0192, z);
    root.add(b);
  };
  keyBtn(-0.014, -0.0075); keyBtn(-0.014, 0.0075); keyBtn(0.006, 0);
  // хромированный «глазок» на торце
  const cap = mesh(new THREE.CylinderGeometry(0.0034, 0.0034, 0.017, 16), M.chrome());
  cap.rotation.z = Math.PI / 2;
  cap.position.set(-L / 2 - 0.004, 0.0085, 0);
  // чёрный хвостовик со стороны лезвия
  const tail = mesh(new RoundedBoxGeometry(0.018, 0.012, 0.016, 2, 0.003), M.softBlack());
  tail.position.set(L / 2 + 0.004, 0.0075, 0);
  root.add(shell, top, cap, tail);
  root.scale.setScalar(K * 1.45);
  return root;
}

export const ITEM_MODELS: Record<string, () => THREE.Object3D> = {
  phone,
  tt,
  keyfob: keyFob,
};
