// Живой табачный дым на canvas: мягкие клубы поднимаются, закручиваются, расползаются и тают.
// Рисуется в половинном разрешении (дым мягкий — разницы не видно), спит, когда скрыт или вкладка не активна.
// Тот же код (в виде обычного JS) встроен в сайт клуба — site/index.html.

interface Puff { x: number; y: number; vx: number; vy: number; r: number; gr: number; a: number; life: number; age: number; rot: number; vr: number; seed: number; tex: number }

function puffTexture(seed: number, warm: boolean) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  // клуб = много полупрозрачных мягких шариков, сгущающихся к центру — получается рыхлая «вата» дыма
  // плюс тонкие вытянутые струйки — дым не «вата», а живые завитки
  for (let i = 0; i < 38; i++) {
    const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 1.3) * S * 0.32;
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d * 0.7;
    const r = S * (0.04 + rnd() * 0.11);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const col = warm ? '236,214,186' : '206,198,192';
    gr.addColorStop(0, `rgba(${col},${0.06 + rnd() * 0.06})`);
    gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr;
    g.save(); g.translate(x, y); g.rotate(rnd() * Math.PI); g.scale(1 + rnd() * 1.6, 0.5 + rnd() * 0.5);
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.restore(); g.fill();
  }
  // мягкий край: всё, что ближе к границе, гаснет
  g.globalCompositeOperation = 'destination-in';
  const m = g.createRadialGradient(S / 2, S / 2, S * 0.12, S / 2, S / 2, S / 2);
  m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = m; g.fillRect(0, 0, S, S);
  return c;
}

export class Smoke {
  private g: CanvasRenderingContext2D;
  private puffs: Puff[] = [];
  private tex: HTMLCanvasElement[] = [];
  private raf = 0;
  private last = 0;
  private w = 0;
  private h = 0;
  private on = false;
  private t = 0;

  constructor(private canvas: HTMLCanvasElement, private density = 1) {
    this.g = canvas.getContext('2d')!;
    for (let i = 0; i < 6; i++) this.tex.push(puffTexture(i + 1, i % 2 === 0));
    this.resize();
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stop(); else if (this.on) this.loop(); });
    // сразу заполняем экран, чтобы дым не «начинал с нуля»
    for (let i = 0; i < this.count(); i++) { const p = this.spawn(); p.age = Math.random() * p.life; this.puffs.push(p); }
  }

  private count() { return Math.round((this.w * this.h) / 24000 * this.density) + 8; }

  private resize() {
    const k = 0.5; // половинное разрешение
    this.w = Math.max(1, Math.round(this.canvas.clientWidth * k));
    this.h = Math.max(1, Math.round(this.canvas.clientHeight * k));
    this.canvas.width = this.w; this.canvas.height = this.h;
  }

  private spawn(): Puff {
    const W = this.w, H = this.h;
    const big = Math.max(W, H);
    return {
      // рождаются внизу и по краям, медленно ползут вверх
      x: Math.random() * W, y: H * (0.55 + Math.random() * 0.6),
      vx: (Math.random() - 0.5) * 0.012 * big, vy: -(0.006 + Math.random() * 0.014) * big,
      r: big * (0.06 + Math.random() * 0.09), gr: big * (0.012 + Math.random() * 0.02),
      a: 0.35 + Math.random() * 0.45, life: 16 + Math.random() * 18, age: 0,
      rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.12,
      seed: Math.random() * 100, tex: Math.floor(Math.random() * this.tex.length),
    };
  }

  start() { if (this.on) return; this.on = true; this.last = performance.now(); this.loop(); }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }
  pause() { this.on = false; this.stop(); }

  private loop = () => {
    this.raf = requestAnimationFrame(now => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.step(dt);
      if (this.on) this.loop();
    });
  };

  private step(dt: number) {
    this.t += dt;
    const g = this.g, W = this.w, H = this.h;
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'screen';
    for (let i = 0; i < this.puffs.length; i++) {
      let p = this.puffs[i];
      p.age += dt;
      if (p.age > p.life || p.y + p.r < -H * 0.2) { p = this.puffs[i] = this.spawn(); }
      // завихрение: плавное «плавание» в стороны, как от сквозняка
      const curl = Math.sin(this.t * 0.25 + p.seed) * 0.6 + Math.sin(this.t * 0.11 + p.seed * 3) * 0.4;
      p.x += (p.vx + curl * W * 0.006) * dt;
      p.y += p.vy * dt;
      p.vy *= 1 - dt * 0.02;       // поднимается и замедляется
      p.r += p.gr * dt;            // расползается
      p.rot += p.vr * dt;
      const k = p.age / p.life;
      const alpha = p.a * Math.sin(Math.PI * Math.min(1, k)) * 0.56;
      if (alpha < 0.005) continue;
      g.globalAlpha = alpha;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.scale(1.5, 0.75);
      const s = p.r * 2;
      g.drawImage(this.tex[p.tex], -s / 2, -s / 2, s, s);
      g.restore();
    }
    g.globalAlpha = 1;
  }
}
