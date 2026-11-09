// Время суток по Москве: высокие окна с бархатными шторами, за стеклом — небо и огни города.
// Днём зал светлее и холоднее, на рассвете и закате — тёплый косой луч через окно, ночью — нуар под лампой.
// Всё считается раз в секунду и плавно перетекает; на кадр — только пара uniform'ов (дёшево).
// Для просмотра: ?hour=7.5 — зафиксировать час, ?daycycle — прогнать сутки за 2 минуты.

import * as THREE from 'three';
import type { Stage } from './Stage';

const FLOOR_Y = -0.75, BACK = -3.6;
const WIN_W = 1.05, WIN_H = 2.1, WIN_X = 2.42, WIN_Y = FLOOR_Y + 0.75 + WIN_H / 2;

interface Key {
  h: number;
  skyTop: string; skyBot: string; sun: string;
  sunI: number;        // сила солнечного света через окно
  shaft: number;       // видимость лучей и светового пятна
  city: number;        // огни города
  amb: number; ambSky: string; ambGround: string;
  fog: string; fogD: number;
  exp: number; env: number;
  sunY: number;        // высота солнечного диска в окне (0 низ … 1 верх; <0 — за горизонтом)
}

// опорные точки суток (час по Москве) — между ними плавная интерполяция
const KEYS: Key[] = [
  { h: 0, skyTop: '#03050c', skyBot: '#0c1424', sun: '#000000', sunI: 0, shaft: 0, city: 1, amb: 0.5, ambSky: '#3a2a22', ambGround: '#050203', fog: '#0b0705', fogD: 0.1, exp: 1.1, env: 1, sunY: -0.5 },
  { h: 4.5, skyTop: '#05081a', skyBot: '#161a33', sun: '#000000', sunI: 0, shaft: 0, city: 0.9, amb: 0.5, ambSky: '#3a2a26', ambGround: '#050203', fog: '#0b0706', fogD: 0.1, exp: 1.1, env: 1, sunY: -0.3 },
  { h: 6, skyTop: '#1c2550', skyBot: '#c9746a', sun: '#ff9a6a', sunI: 0.5, shaft: 0.45, city: 0.55, amb: 0.62, ambSky: '#5a3a36', ambGround: '#0a0506', fog: '#140c0b', fogD: 0.09, exp: 1.12, env: 1.05, sunY: 0.05 },
  { h: 7.3, skyTop: '#46609c', skyBot: '#ffc28a', sun: '#ffb27a', sunI: 1.6, shaft: 1, city: 0.15, amb: 1.0, ambSky: '#7a5a4a', ambGround: '#120a08', fog: '#1e1512', fogD: 0.08, exp: 1.15, env: 1.15, sunY: 0.22 },
  { h: 10, skyTop: '#4d7cbc', skyBot: '#aec6de', sun: '#fff0d8', sunI: 1.9, shaft: 0.6, city: 0, amb: 1.55, ambSky: '#a49482', ambGround: '#22170f', fog: '#3a3029', fogD: 0.05, exp: 1.3, env: 1.6, sunY: 0.7 },
  { h: 14, skyTop: '#4a7bc0', skyBot: '#a9c2dc', sun: '#fff6ea', sunI: 2.0, shaft: 0.5, city: 0, amb: 1.65, ambSky: '#a89a8a', ambGround: '#241811', fog: '#3c332b', fogD: 0.048, exp: 1.32, env: 1.65, sunY: 0.95 },
  { h: 17.3, skyTop: '#4b67a6', skyBot: '#ffbf72', sun: '#ffa552', sunI: 1.8, shaft: 1, city: 0.05, amb: 1.15, ambSky: '#86604a', ambGround: '#140b08', fog: '#241812', fogD: 0.075, exp: 1.17, env: 1.2, sunY: 0.3 },
  { h: 19, skyTop: '#1d2552', skyBot: '#d0645a', sun: '#ff6e4a', sunI: 0.55, shaft: 0.5, city: 0.55, amb: 0.68, ambSky: '#5c3834', ambGround: '#0a0506', fog: '#140b0a', fogD: 0.09, exp: 1.12, env: 1.05, sunY: 0.04 },
  { h: 21, skyTop: '#060a18', skyBot: '#1a1d38', sun: '#000000', sunI: 0, shaft: 0, city: 1, amb: 0.52, ambSky: '#3a2a24', ambGround: '#050203', fog: '#0b0705', fogD: 0.1, exp: 1.1, env: 1, sunY: -0.4 },
  { h: 24, skyTop: '#03050c', skyBot: '#0c1424', sun: '#000000', sunI: 0, shaft: 0, city: 1, amb: 0.5, ambSky: '#3a2a22', ambGround: '#050203', fog: '#0b0705', fogD: 0.1, exp: 1.1, env: 1, sunY: -0.5 },
];

const C = (s: string) => new THREE.Color(s);

/** Час по Москве (UTC+3, без перехода на летнее время), дробный. */
export function moscowHour(now = Date.now()) {
  return (((now / 3600_000 + 3) % 24) + 24) % 24;
}

/** Силуэт города для окна: R — дома, G — горящие окна. Рисуется один раз. */
function cityTexture() {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // два плана домов: дальний ниже и плотнее
  for (const layer of [0, 1]) {
    let x = 0;
    while (x < W) {
      const w = 18 + rnd() * (layer ? 46 : 30);
      const h = layer ? 40 + rnd() * 110 : 30 + rnd() * 60;
      const top = H - h;
      g.fillStyle = 'rgb(255,0,0)';
      g.fillRect(x, top, w - 2, h);
      // шпиль или водонапорная башня изредка
      if (layer && rnd() < 0.12) g.fillRect(x + w / 2 - 2, top - 18, 4, 18);
      // окна
      for (let wy = top + 6; wy < H - 6; wy += 9) for (let wx = x + 4; wx < x + w - 6; wx += 7) {
        if (rnd() < (layer ? 0.32 : 0.22)) { g.fillStyle = `rgb(255,${Math.floor(140 + rnd() * 115)},0)`; g.fillRect(wx, wy, 3, 4); }
      }
      x += w;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

/** Мягкая текстура луча/светового пятна. */
function softTexture(kind: 'shaft' | 'patch') {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  if (kind === 'shaft') {
    const gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const side = g.createLinearGradient(0, 0, 128, 0);
    side.addColorStop(0, 'rgba(0,0,0,1)'); side.addColorStop(0.2, 'rgba(0,0,0,0)'); side.addColorStop(0.8, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = side; g.fillRect(0, 0, 128, 128);
  } else {
    // пятно света от окна с тенью переплёта
    const gr = g.createRadialGradient(64, 64, 10, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,0.85)';
    g.fillRect(61, 0, 6, 128); g.fillRect(0, 50, 128, 5);
  }
  return new THREE.CanvasTexture(c);
}

const skyVert = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const skyFrag = /* glsl */`
  uniform vec3 skyTop; uniform vec3 skyBot; uniform vec3 sun; uniform float sunY; uniform float city; uniform float time;
  uniform sampler2D cityMap;
  varying vec2 vUv;
  void main() {
    vec3 col = mix(skyBot, skyTop, smoothstep(0.0, 1.0, vUv.y));
    // солнце и его ореол
    vec2 sp = vec2(0.62, mix(0.12, 0.92, sunY));
    float d = distance(vUv * vec2(1.0, 1.75), sp * vec2(1.0, 1.75));
    col += sun * (smoothstep(0.075, 0.06, d) * 2.2 + exp(-d * 6.0) * 0.55);
    // звёзды ночью
    float st = fract(sin(dot(floor(vUv * vec2(90.0, 150.0)), vec2(12.9898, 78.233))) * 43758.5453);
    col += vec3(0.9, 0.9, 1.0) * step(0.996, st) * city * smoothstep(0.45, 0.9, vUv.y) * (0.6 + 0.4 * sin(time * 2.0 + st * 40.0));
    // город: нижние 45% окна
    vec2 cu = vec2(vUv.x, vUv.y / 0.45);
    if (cu.y < 1.0) {
      vec4 c = texture2D(cityMap, cu);
      vec3 bld = mix(skyBot * 0.18, vec3(0.012, 0.014, 0.022), city);
      col = mix(col, bld, c.r);
      float flick = 0.85 + 0.15 * sin(time * 0.7 + cu.x * 40.0);
      col += vec3(1.0, 0.62, 0.28) * c.r * step(0.1, c.g) * c.g * city * 1.6 * flick;
    }
    // стекло: лёгкий блик и затемнение к краям
    col *= 0.82 + 0.18 * smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
    col += vec3(0.04) * smoothstep(0.6, 1.0, 1.0 - abs(vUv.x - vUv.y * 0.5 - 0.2) * 3.0);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class DayCycle {
  readonly group = new THREE.Group();
  private sky: THREE.ShaderMaterial;
  private sunLight: THREE.DirectionalLight;
  private shafts: THREE.MeshBasicMaterial[] = [];
  private patches: THREE.MeshBasicMaterial[] = [];
  private cur: Key;
  private target: Key;
  private acc = 99;
  private acc2 = 0;
  private fixed: number | null = null;
  private demo = false;
  private bg = new THREE.Color();

  constructor(private stage: Stage, quality: number) {
    const q = new URLSearchParams(location.search);
    if (q.has('hour')) this.fixed = Number(q.get('hour')) % 24;
    this.demo = q.has('daycycle');

    this.sky = new THREE.ShaderMaterial({
      vertexShader: skyVert, fragmentShader: skyFrag, fog: false,
      uniforms: {
        skyTop: { value: new THREE.Color() }, skyBot: { value: new THREE.Color() }, sun: { value: new THREE.Color() },
        sunY: { value: 0 }, city: { value: 1 }, time: { value: 0 }, cityMap: { value: cityTexture() },
      },
    });

    const wood = new THREE.MeshStandardMaterial({ color: 0x1a0d08, roughness: 0.45, metalness: 0, envMapIntensity: 0.7 });
    const velvet = new THREE.MeshStandardMaterial({ color: 0x3a0a14, roughness: 0.92, metalness: 0, envMapIntensity: 0.2 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08a48, metalness: 1, roughness: 0.32, envMapIntensity: 1.2 });

    for (const sx of [-1, 1]) {
      const w = new THREE.Group();
      // небо за стеклом чуть в глубине проёма
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(WIN_W, WIN_H), this.sky);
      glass.position.z = 0.004;
      w.add(glass);
      // рама, переплёт и подоконник
      const bar = (bw: number, bh: number, x: number, y: number, d = 0.05) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, d), wood);
        m.position.set(x, y, 0);
        w.add(m);
      };
      bar(WIN_W + 0.16, 0.08, 0, WIN_H / 2 + 0.04, 0.09);
      bar(WIN_W + 0.16, 0.08, 0, -WIN_H / 2 - 0.04, 0.09);
      bar(0.08, WIN_H + 0.16, -WIN_W / 2 - 0.04, 0, 0.09);
      bar(0.08, WIN_H + 0.16, WIN_W / 2 + 0.04, 0, 0.09);
      bar(0.035, WIN_H, 0, 0);
      for (const y of [-0.28, 0.42]) bar(WIN_W, 0.03, 0, y * WIN_H);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(WIN_W + 0.34, 0.04, 0.2), wood);
      sill.position.set(0, -WIN_H / 2 - 0.1, 0.08);
      w.add(sill);
      // карниз и тяжёлые бархатные шторы, собранные по бокам
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, WIN_W + 0.9, 12), brass);
      rod.rotation.z = Math.PI / 2;
      rod.position.set(0, WIN_H / 2 + 0.2, 0.14);
      w.add(rod);
      for (const side of [-1, 1]) {
        const cw = 0.42, ch = WIN_H + 0.62;
        const geo = new THREE.PlaneGeometry(cw, ch, 18, 1);
        const p = geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i);
          p.setZ(i, Math.sin((x / cw + 0.5) * Math.PI * 7) * 0.03);
        }
        geo.computeVertexNormals();
        const cur = new THREE.Mesh(geo, velvet);
        cur.position.set(side * (WIN_W / 2 + 0.16), -0.06, 0.12);
        w.add(cur);
      }
      w.position.set(sx * WIN_X, WIN_Y, BACK + 0.03);
      this.group.add(w);

      // световое пятно на полу перед окном (дёшево — везде) и лучи в воздухе (на ПК)
      const pm = new THREE.MeshBasicMaterial({ map: softTexture('patch'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffd8a8, fog: false });
      const patch = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.1), pm);
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(sx * (WIN_X - 0.25), FLOOR_Y + 0.006, BACK + 1.35);
      this.group.add(patch);
      this.patches.push(pm);
      if (quality > 1) {
        const sm = new THREE.MeshBasicMaterial({ map: softTexture('shaft'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: 0xffd8a8, fog: false });
        for (const [off, tilt, wd] of [[-0.25, 0.32, 0.55], [0.18, 0.4, 0.75]] as [number, number, number][]) {
          const shaft = new THREE.Mesh(new THREE.PlaneGeometry(wd, 3.4), sm);
          shaft.position.set(sx * (WIN_X + off) - sx * 0.55, WIN_Y - 1.05, BACK + 0.75);
          shaft.rotation.set(-0.35, 0, -sx * tilt);
          this.group.add(shaft);
        }
        this.shafts.push(sm);
      }
    }

    // солнце из окон за спинами соперников: контровой тёплый свет на стол, пол и силуэты, без теней (дёшево)
    this.sunLight = new THREE.DirectionalLight(0xffffff, 0);
    this.sunLight.position.set(-1.2, WIN_Y + 1.2, BACK);
    this.sunLight.target.position.set(0.3, -0.4, 1.2);
    this.group.add(this.sunLight, this.sunLight.target);

    const now = this.sample(this.hour());
    this.cur = now;
    this.target = now;
    this.apply(1);
  }

  private hour() {
    if (this.fixed != null) return this.fixed;
    if (this.demo) return (performance.now() / 5000) % 24;   // сутки за 2 минуты
    return moscowHour();
  }

  /** параметры на дробный час: интерполяция между опорными точками */
  private sample(h: number): Key {
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const k0 = (h - a.h) / (b.h - a.h);
    const k = k0 * k0 * (3 - 2 * k0);
    const mixc = (x: string, y: string) => '#' + C(x).lerp(C(y), k).getHexString();
    const mixn = (x: number, y: number) => x + (y - x) * k;
    return {
      h, skyTop: mixc(a.skyTop, b.skyTop), skyBot: mixc(a.skyBot, b.skyBot), sun: mixc(a.sun, b.sun),
      sunI: mixn(a.sunI, b.sunI), shaft: mixn(a.shaft, b.shaft), city: mixn(a.city, b.city),
      amb: mixn(a.amb, b.amb), ambSky: mixc(a.ambSky, b.ambSky), ambGround: mixc(a.ambGround, b.ambGround),
      fog: mixc(a.fog, b.fog), fogD: mixn(a.fogD, b.fogD), exp: mixn(a.exp, b.exp), env: mixn(a.env, b.env),
      sunY: mixn(a.sunY, b.sunY),
    };
  }

  /** плавно подвести текущее состояние к целевому */
  private apply(k: number) {
    const c = this.cur, t = this.target;
    const lc = (x: string, y: string) => '#' + C(x).lerp(C(y), k).getHexString();
    const ln = (x: number, y: number) => x + (y - x) * k;
    this.cur = {
      h: t.h, skyTop: lc(c.skyTop, t.skyTop), skyBot: lc(c.skyBot, t.skyBot), sun: lc(c.sun, t.sun),
      sunI: ln(c.sunI, t.sunI), shaft: ln(c.shaft, t.shaft), city: ln(c.city, t.city),
      amb: ln(c.amb, t.amb), ambSky: lc(c.ambSky, t.ambSky), ambGround: lc(c.ambGround, t.ambGround),
      fog: lc(c.fog, t.fog), fogD: ln(c.fogD, t.fogD), exp: ln(c.exp, t.exp), env: ln(c.env, t.env), sunY: ln(c.sunY, t.sunY),
    };
    const s = this.cur, u = this.sky.uniforms;
    (u.skyTop.value as THREE.Color).set(s.skyTop);
    (u.skyBot.value as THREE.Color).set(s.skyBot);
    (u.sun.value as THREE.Color).set(s.sun);
    u.sunY.value = s.sunY;
    u.city.value = s.city;
    this.sunLight.color.set(s.sun === '#000000' ? '#ffffff' : s.sun);
    this.sunLight.intensity = s.sunI;   // свет всегда в сцене (ночью — 0): иначе смена числа источников пересобирает шейдеры и даёт рывок
    for (const m of this.shafts) { m.opacity = 0.085 * s.shaft; m.color.set(s.sun); }
    for (const m of this.patches) { m.opacity = 0.22 * s.shaft; m.color.set(s.sun); }
    const st = this.stage;
    st.amb.intensity = s.amb;
    st.amb.color.set(s.ambSky);
    st.amb.groundColor.set(s.ambGround);
    const fog = st.scene.fog as THREE.FogExp2;
    fog.color.set(s.fog);
    fog.density = s.fogD;
    this.bg.set(s.fog).multiplyScalar(0.7);
    (st.scene.background as THREE.Color).copy(this.bg);
    st.renderer.toneMappingExposure = s.exp;
    st.scene.environmentIntensity = s.env;
  }

  /** раз в секунду пересчитываем цель; переход между состояниями занимает ~3 с */
  update(t: number, dt: number) {
    this.sky.uniforms.time.value = t;
    this.acc += dt;
    if (this.acc >= (this.demo ? 0.1 : 1)) {
      this.acc = 0;
      this.target = this.sample(this.hour());
    }
    // цвета и свет меняются медленно — обновлять 10 раз в секунду достаточно
    this.acc2 += dt;
    if (this.acc2 >= 0.1) { this.apply(Math.min(1, this.acc2 * (this.demo ? 8 : 1.2))); this.acc2 = 0; }
  }
}
