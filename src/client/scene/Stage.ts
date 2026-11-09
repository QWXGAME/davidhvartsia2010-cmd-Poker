// Рендерер, камера, окружение, цикл кадров и адаптивная производительность.

import * as THREE from 'three';
import { Tweens } from './Tween';
import { LAMP_Y, LAMP_Z } from './layout';

/** ?fx — держать кино-обработку включённой (для проверки на слабом железе) */
const FORCE_FX = new URLSearchParams(location.search).has('fx');

export interface Frame { t: number; dt: number; now: number }

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 30);
  readonly tweens = new Tweens();
  readonly quality: number; // 2 — флагман/ПК, 1 — средний телефон
  private updaters: ((f: Frame) => void)[] = [];
  private camBase = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  private pointer = new THREE.Vector2();
  private parallax = new THREE.Vector2();
  /** общий заполняющий свет — им управляет время суток */
  amb!: THREE.HemisphereLight;
  private last = 0;
  /** «время анимаций»: идёт медленнее во время замедленной съёмки (олл-ин) */
  private vt = 0;
  private timeScale = 1;
  private slowTo = 1;
  private slowUntil = 0;
  /** Замедленная съёмка: всё (фишки, карты, руки) идёт в scale раз медленнее holdMs миллисекунд, затем плавно разгоняется. */
  slowMo(scale = 0.35, holdMs = 1500) {
    this.slowTo = scale;
    this.slowUntil = performance.now() + holdMs;
  }
  get slowK() { return 1 - this.timeScale; }
  private t0 = performance.now();
  private running = true;
  private onResize: (() => void)[] = [];
  /** вертикальный угол «на карту» для расчёта сквиза */
  camPitch = 0.4;
  /** 0..1 — наезд камеры на общие карты (замедленный ривер) */
  private dollyK = 0;
  private _look = new THREE.Vector3();
  private dollyTarget = new THREE.Vector3(0, 0, 0.34);
  /** высота лампы под ракурс: в портрете выше, чтобы не перекрывать стол */
  lampY = 1.1;

  // адаптивное качество
  private dpr: number;
  private maxDpr: number;
  private minDpr: number;
  private frames = 0;
  private winStart = 0;
  private refresh = 60;
  private refreshSamples: number[] = [];
  private goodWindows = 0;
  lowPower = false;
  private lowPowerCbs: ((low: boolean) => void)[] = [];
  fps = 0;
  /** кино-обработка: мягкое свечение бликов и глубина резкости (дальний план размыт, как на фото) */
  cinematic = false;
  /** в режиме экономии простои рисуются через кадр — телефон не греется */
  isIdle: () => boolean = () => false;
  private skip = false;
  private shadowFrames = 3;
  /** попросить пересчёт теней (несколько кадров подряд — пока идёт движение) */
  requestShadow(frames = 1) { this.shadowFrames = Math.max(this.shadowFrames, frames); }

  constructor(container: HTMLElement) {
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || matchMedia('(pointer: coarse)').matches;
    const cores = navigator.hardwareConcurrency || 4;
    // одинаковая картинка на телефоне и ПК: полное качество везде, частоту держит адаптивная плотность пикселей
    this.quality = 2; void cores;
    // чёткость: родная плотность экрана (до 2.5 на ПК, до 3 на телефонах с маленьким экраном)
    const dev = window.devicePixelRatio || 1;
    this.maxDpr = Math.min(dev, mobile ? 3 : 2.5);
    // пол адаптации: ниже не опускаемся никогда — картинка не «мылится»
    this.minDpr = Math.min(dev, mobile ? 2 : 1.5);
    this.dpr = mobile ? Math.min(this.maxDpr, 2.5) : this.maxDpr;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: mobile ? 'default' : 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Тени «запекаются»: карта теней пересчитывается только когда что-то движется
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x070403);
    this.scene.fog = new THREE.FogExp2(0x0b0705, 0.1);

    this.buildEnvironment();

    const amb = new THREE.HemisphereLight(0x3a2a22, 0x050203, 0.55);
    this.amb = amb;
    this.scene.add(amb);
    // контровой холодный свет из глубины — обрисовывает силуэты
    const rim = new THREE.DirectionalLight(0x8aa0c8, 0.55);
    rim.position.set(0.6, 1.6, -4);
    this.scene.add(rim);
    // тёплая заливка со стороны игрока, чтобы предметы на переднем плане читались
    const fill = new THREE.PointLight(0xffc890, 0.32, 1.9, 1.8);
    fill.position.set(0.1, 0.7, 2.1);
    this.scene.add(fill);

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.pointer.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5);
    });
    document.addEventListener('visibilitychange', () => {
      this.running = !document.hidden;
      if (this.running) this.last = performance.now();
    });
    // на ПК и мощных телефонах — кино-обработка; на слабых выключается сама при просадках
    this.resize();
    this.renderer.setAnimationLoop((now) => this.frame(now));
  }

  /** Карта отражений: тёмная комната, тёплый диск лампы, далёкие бра. Строится один раз. */
  private buildEnvironment() {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x070505);
    const room = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 12), new THREE.MeshBasicMaterial({ color: 0x0a0707, side: THREE.BackSide }));
    room.position.y = 1.5;
    env.add(room);
    const disk = new THREE.Mesh(new THREE.CircleGeometry(0.45, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4, 2.8) }));
    disk.rotation.x = Math.PI / 2;
    disk.position.set(0, LAMP_Y, LAMP_Z);
    env.add(disk);
    const shade = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.08, 8, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.25, 0.12) }));
    shade.rotation.x = Math.PI / 2;
    shade.position.set(0, LAMP_Y + 0.15, LAMP_Z);
    env.add(shade);
    for (const x of [-3, 3]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.9), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.17, 0.08) }));
      s.position.set(x, 1.6, -5.5);
      env.add(s);
    }
    // мягкие длинные софтбоксы над столом — дают красивые блики на лаке
    for (const z of [-0.6, 0.9]) {
      const sb = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.22), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.0, 0.7), side: THREE.DoubleSide }));
      sb.rotation.x = Math.PI / 2;
      sb.position.set(0, 2.1, z);
      env.add(sb);
    }
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.05, 0.04) }));
    strip.position.set(0, 2.5, 5.5);
    strip.rotation.y = Math.PI;
    env.add(strip);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(env, 0.03).texture;
    pm.dispose();
  }

  /** Пост-эффекты убраны: они давали «мыло» (рендер без MSAA + боке) и съедали кадры. */
  enableCinematic(_on: boolean) { this.cinematic = false; }

  private introK = 0;
  private orbitK = 0;
  /** облёт стола на фоне лобби */
  orbit = false;
  private _introPos = new THREE.Vector3();
  private _introLook = new THREE.Vector3();
  /** Осмотр зала при входе за стол: ~4.5 с от бара к своему месту. */
  intro(dur = 4600) {
    this.introK = 1;
    this.tweens.add(dur, k => { this.introK = 1 - k; this.requestShadow(1); }, { key: this._introPos, ease: (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2) });
  }

  /** Плавный наезд камеры к доске и обратно. */
  dolly(on: boolean, dur = 1400, target?: THREE.Vector3) {
    if (target) this.dollyTarget.copy(target);
    const from = this.dollyK, to = on ? 1 : 0;
    this.tweens.add(dur, k => { this.dollyK = from + (to - from) * k; }, { key: this.dollyTarget, ease: (x: number) => x * x * (3 - 2 * x) });
  }

  onFrame(fn: (f: Frame) => void) { this.updaters.push(fn); }
  onResized(fn: () => void) { this.onResize.push(fn); fn(); }
  onLowPower(fn: (low: boolean) => void) { this.lowPowerCbs.push(fn); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const a = w / h;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = a;

    // один и тот же кинематографичный низкий ракурс на телефоне и на ПК — в портрете просто шире охват по вертикали
    const k = THREE.MathUtils.clamp((a - 0.55) / (1.6 - 0.55), 0, 1);
    const sm = k * k * (3 - 2 * k);
    // ракурс как на референсе: взгляд сверху-сзади, ближний борт с табличками внизу кадра
    this.camBase.pos.set(0, THREE.MathUtils.lerp(1.22, 1.1, sm), THREE.MathUtils.lerp(3.05, 2.9, sm));
    this.camBase.look.set(0, THREE.MathUtils.lerp(0.04, -0.02, sm), THREE.MathUtils.lerp(0.6, 0.56, sm));
    this.lampY = THREE.MathUtils.lerp(1.3, 1.15, sm);
    // в портрете подгоняем FOV, чтобы стол влезал по ширине
    const needHalfW = 0.92;
    const dist = this.camBase.pos.distanceTo(this.camBase.look);
    const hfov = 2 * Math.atan(needHalfW / dist);
    const vfovFit = 2 * Math.atan(Math.tan(hfov / 2) / a) * 180 / Math.PI;
    this.camera.fov = THREE.MathUtils.clamp(Math.max(vfovFit, THREE.MathUtils.lerp(64, 50, sm)), 40, 82);
    this.camera.updateProjectionMatrix();
    const d = new THREE.Vector3().subVectors(this.camBase.look, this.camBase.pos).normalize();
    this.camPitch = Math.asin(-d.y);
    for (const fn of this.onResize) fn();
  }

  get viewportHeightPx() { return this.renderer.domElement.height; }

  private frame(now: number) {
    if (!this.running) return;
    const rdt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    // замедление входит быстро и отпускает мягко
    const want = now < this.slowUntil ? this.slowTo : 1;
    this.timeScale += (want - this.timeScale) * Math.min(1, rdt * (want < this.timeScale ? 9 : 2.2));
    if (Math.abs(this.timeScale - 1) < 0.002) this.timeScale = 1;
    const dt = rdt * this.timeScale;
    this.vt += rdt * 1000 * this.timeScale;
    const t = (now - this.t0) / 1000;

    this.measure(now, dt);

    // камера: дыхание + лёгкий параллакс мыши
    this.parallax.lerp(this.pointer, Math.min(1, dt * 3));
    const cam = this.camera;
    cam.position.copy(this.camBase.pos);
    cam.position.x += Math.sin(t * 0.21) * 0.012 + this.parallax.x * 0.08;
    cam.position.y += Math.sin(t * 0.33) * 0.008 - this.parallax.y * 0.04;
    const look = this.camBase.look;
    this._look.copy(look);
    if (this.dollyK > 0.0005) {
      const k = this.dollyK;
      // камера опускается и наклоняется к картам, лёгкое «дыхание» от напряжения
      const close = new THREE.Vector3(this.dollyTarget.x, 0.62 + Math.sin(t * 1.1) * 0.006, this.dollyTarget.z + 0.95);
      cam.position.lerp(close, k * 0.75);
      this._look.lerp(this.dollyTarget, k);
    }
    // лобби: камера медленно облетает пустой стол под лампой — живой фон меню
    this.orbitK += ((this.orbit ? 1 : 0) - this.orbitK) * Math.min(1, dt * 1.2);
    if (this.orbitK > 0.0005) {
      const a = t * 0.06;
      this._introPos.set(Math.sin(a) * 2.4, 1.35 + Math.sin(t * 0.13) * 0.08, 0.45 + Math.cos(a) * 2.4);
      this._introLook.set(0, -0.05, 0.45);
      cam.position.lerp(this._introPos, this.orbitK);
      this._look.lerp(this._introLook, this.orbitK);
      this.requestShadow(1);
    }
    if (this.introK > 0.0005) {
      // «осмотр зала»: камера начинает с бара у дальней стены и плавно садится на своё место
      const k = this.introK;
      const a = (1 - k) * 0.9;
      this._introPos.set(Math.sin(a * 2.2) * 0.9, 1.55 - (1 - k) * 0.2, 1.5 + (1 - k) * 0.6);
      this._introLook.set(Math.sin(a * 1.6) * -0.8, 1.35 - (1 - k) * 1.0, -3.4 + (1 - k) * 2.4);
      cam.position.lerp(this._introPos, k);
      this._look.lerp(this._introLook, k);
    }
    cam.lookAt(this._look);

    this.tweens.update(this.vt);
    const f = { t, dt, now };
    for (const u of this.updaters) u(f);
    if (this.lowPower && this.shadowFrames === 0 && this.isIdle()) {
      this.skip = !this.skip;
      if (this.skip) return;
    }
    if (this.shadowFrames > 0) { this.renderer.shadowMap.needsUpdate = true; this.shadowFrames--; }
    this.renderer.render(this.scene, cam);
  }

  /** Адаптивная плотность пикселей: держим частоту экрана, не греем телефон. */
  private measure(now: number, dt: number) {
    if (this.refreshSamples.length < 90) {
      if (dt > 0) this.refreshSamples.push(1 / dt);
      if (this.refreshSamples.length === 90) {
        const s = [...this.refreshSamples].sort((a, b) => a - b);
        const med = s[45];
        this.refresh = med > 200 ? 240 : med > 155 ? 165 : med > 130 ? 144 : med > 100 ? 120 : med > 80 ? 90 : 60;
      }
      return;
    }
    this.frames++;
    if (!this.winStart) this.winStart = now;
    const span = now - this.winStart;
    if (span < 1500) return;
    this.fps = (this.frames * 1000) / span;
    this.frames = 0;
    this.winStart = now;
    const target = this.refresh * 0.86;
    if (this.fps < target) {
      this.goodWindows = 0;
      if (this.dpr > this.minDpr && !FORCE_FX) {
        this.dpr = Math.max(this.minDpr, this.dpr - 0.25);
        this.renderer.setPixelRatio(this.dpr);
        for (const fn of this.onResize) fn();
      } else if (!this.lowPower && this.fps < this.refresh * 0.7) {
        this.lowPower = true;
        for (const fn of this.lowPowerCbs) fn(true);
      }
    } else if (this.fps > this.refresh * 0.97) {
      if (++this.goodWindows >= 4 && this.dpr < this.maxDpr) {
        this.goodWindows = 0;
        this.dpr = Math.min(this.maxDpr, this.dpr + 0.25);
        this.renderer.setPixelRatio(this.dpr);
        for (const fn of this.onResize) fn();
      }
    }
  }

  get pixelRatio() { return this.dpr; }

  project(v: THREE.Vector3, out: { x: number; y: number; visible: boolean }) {
    const p = v.clone().project(this.camera);
    out.x = (p.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-p.y * 0.5 + 0.5) * window.innerHeight;
    out.visible = p.z < 1;
    return out;
  }
}
