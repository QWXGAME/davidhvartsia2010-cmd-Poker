// Звук: процедурный синтез (Web Audio). Фишки, карты, стук по столу, лёд, затвор,
// Музыки в игре нет — только звуки стола.

type Ctx = AudioContext;


export class Audio {
  private ctx: Ctx | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private reverb!: ConvolverNode;
  private noiseBuf!: AudioBuffer;
  private sfxOn = true;

  constructor() {
    try {
      this.sfxOn = localStorage.getItem('pn.sfx') !== '0';
    } catch { /* приватный режим */ }
    const unlock = () => {
      this.init();
      if (this.ctx?.state === 'suspended') this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchend', unlock, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend(); else this.ctx.resume();
    });
  }

  get sfxEnabled() { return this.sfxOn; }

  private init() {
    if (this.ctx) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxOn ? 0.85 : 0;
    this.sfx.connect(this.master);

    // белый шум
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // реверб тёмного зала
    this.reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.4;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const x = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    this.reverb.connect(wet).connect(this.master);
  }


  toggleSfx(): boolean {
    this.sfxOn = !this.sfxOn;
    try { localStorage.setItem('pn.sfx', this.sfxOn ? '1' : '0'); } catch { /* */ }
    if (this.ctx) this.sfx.gain.value = this.sfxOn ? 0.85 : 0;
    return this.sfxOn;
  }

  // ───────────────────────── кирпичики ─────────────────────────

  private noise(at: number, dur: number, type: BiquadFilterType, f0: number, f1: number, gain: number, q = 1, dest?: AudioNode) {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const flt = c.createBiquadFilter();
    flt.type = type; flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, at);
    flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.01, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(flt).connect(g).connect(dest || this.sfx);
    src.start(at, Math.random() * 1.5, dur + 0.05);
  }

  private tone(at: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine', dest?: AudioNode, freqEnd?: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, at + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(dest || this.sfx);
    o.start(at); o.stop(at + dur + 0.02);
  }

  private ok() {
    this.init();
    return !!this.ctx && this.ctx.state === 'running';
  }

  // ───────────────────────── эффекты ─────────────────────────

  /** глухой керамический щелчок фишек */
  chips(count = 1) {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    const n = Math.min(9, 2 + count * 2);
    for (let i = 0; i < n; i++) {
      const at = t + i * (0.028 + Math.random() * 0.03);
      const f = 2300 + Math.random() * 1800;
      this.noise(at, 0.035, 'bandpass', f, f * 0.8, 0.5, 2.5);
      this.tone(at, f * 1.4, 0.05, 0.05, 'triangle');
      this.tone(at, 620 + Math.random() * 120, 0.04, 0.08, 'sine');
    }
  }

  /** риффл колоды: быстрая дробь карт, затем мягкий «шлепок» выравнивания */
  shuffle() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 16; i++) {
      const at = t + i * 0.017 + Math.random() * 0.004;
      this.noise(at, 0.022, 'bandpass', 2400 + Math.random() * 1400, 1800, 0.07 + Math.random() * 0.05, 2.2);
    }
    this.noise(t + 0.32, 0.06, 'lowpass', 1400, 500, 0.22, 0.8);
  }

  /** олл-ин: музыка уходит на задний план, глубокий удар и тихий звон */
  allIn() {
    if (!this.ok()) return;
    const c = this.ctx!, t = c.currentTime;
    this.tone(t, 70, 1.1, 0.5, 'sine', undefined, 38);
    this.noise(t, 0.5, 'lowpass', 600, 120, 0.25, 0.7, this.reverb);
    this.tone(t + 0.05, 1320, 1.4, 0.03, 'sine', this.reverb);
    this.tone(t + 0.08, 1980, 1.2, 0.018, 'sine', this.reverb);
  }

  deal() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    this.noise(t, 0.11, 'bandpass', 900, 3200, 0.32, 1.2);
    this.noise(t + 0.09, 0.03, 'highpass', 3000, 2500, 0.14);
  }

  flip() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    this.noise(t, 0.05, 'bandpass', 2600, 1800, 0.28, 1.5);
    this.tone(t, 180, 0.04, 0.08, 'sine', undefined, 90);
  }

  /** два удара костяшками по сукну */
  check() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    for (const dt of [0, 0.13]) {
      this.tone(t + dt, 130, 0.12, 0.55, 'sine', undefined, 55);
      this.noise(t + dt, 0.06, 'lowpass', 900, 300, 0.4);
    }
  }

  /** шелест картона: уголок карты гнётся под пальцем */
  paper() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    this.noise(t, 0.45, 'bandpass', 1600, 3400, 0.09, 0.9);
    for (let i = 0; i < 4; i++) this.noise(t + 0.08 + i * 0.07 + Math.random() * 0.04, 0.012, 'highpass', 4200, 3600, 0.05);
  }

  /** латунная клавиша в борту стола: мягкий щелчок механизма и короткий звон металла */
  press() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    this.tone(t, 160, 0.09, 0.32, 'sine', undefined, 70);
    this.noise(t, 0.03, 'bandpass', 2600, 1900, 0.3, 3);
    this.tone(t + 0.005, 2950, 0.32, 0.025, 'sine');
    this.tone(t + 0.005, 4420, 0.22, 0.015, 'sine');
  }

  /** глухое сердцебиение — пара ударов «тук-тук» */
  heartbeat() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    for (const [dt, g] of [[0, 0.5], [0.24, 0.32]] as const) {
      this.tone(t + dt, 62, 0.22, g, 'sine', undefined, 38);
      this.noise(t + dt, 0.08, 'lowpass', 180, 60, g * 0.5);
    }
  }

  /** одна фишка мягко ложится на другую — тихий ASMR */
  chipTick(gain = 1) {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    const f = 2600 + Math.random() * 1400;
    this.noise(t, 0.025, 'bandpass', f, f * 0.85, 0.16 * gain, 3);
    this.tone(t, 900 + Math.random() * 200, 0.03, 0.03 * gain, 'sine');
  }

  fold() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    this.noise(t, 0.2, 'bandpass', 1400, 500, 0.22, 0.8);
  }

  collect() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    this.noise(t, 0.35, 'bandpass', 1800, 900, 0.12, 0.7);
    this.chips(3);
  }

  win(mine: boolean) {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 14; i++) {
      const at = t + 0.05 + i * 0.045 + Math.random() * 0.02;
      const f = 2000 + Math.random() * 2200;
      this.noise(at, 0.04, 'bandpass', f, f * 0.8, 0.35, 2.5);
      this.tone(at, 640 + Math.random() * 160, 0.05, 0.06);
    }
    if (mine) {
      // тёплый мажорный септаккорд на электропиано
      [261.6, 329.6, 392, 493.9].forEach((f, i) => this.epiano(t + 0.1 + i * 0.05, f, 1.8, 0.07, this.sfx));
    }
  }

  myTurn() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    this.epiano(t, 659.3, 0.9, 0.06, this.sfx);
    this.epiano(t + 0.12, 987.8, 1.1, 0.05, this.sfx);
  }

  ice() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.07 + Math.random() * 0.03;
      this.tone(at, 2600 + Math.random() * 500, 0.35, 0.06);
      this.tone(at, 3900 + Math.random() * 700, 0.25, 0.04);
      this.tone(at, 5400, 0.12, 0.02);
    }
  }

  gun() {
    if (!this.ok()) return;
    const t = this.ctx!.currentTime;
    // тяжёлый металлический ход затвора и щелчок
    this.noise(t, 0.09, 'bandpass', 1200, 2600, 0.5, 3);
    this.tone(t, 1850, 0.12, 0.08, 'square');
    this.noise(t + 0.16, 0.05, 'highpass', 4000, 3000, 0.5);
    this.tone(t + 0.16, 2400, 0.08, 0.1, 'square');
    this.tone(t + 0.16, 140, 0.1, 0.25, 'sine', undefined, 70);
  }

  pour() {
    if (!this.ok()) return;
    const c = this.ctx!;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 6; f.frequency.value = 700;
    const lfo = c.createOscillator();
    lfo.frequency.value = 11;
    const lg = c.createGain(); lg.gain.value = 260;
    lfo.connect(lg).connect(f.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t); src.stop(t + 1.2); lfo.start(t); lfo.stop(t + 1.2);
    this.ice();
  }

  // ───────────────────────── музыка ─────────────────────────

  private epiano(at: number, f: number, dur: number, gain: number, dest: AudioNode) {
    const c = this.ctx!;
    const car = c.createOscillator();
    const mod = c.createOscillator();
    const mg = c.createGain();
    car.frequency.value = f;
    mod.frequency.value = f * 1.0;
    mg.gain.setValueAtTime(f * 1.6, at);
    mg.gain.exponentialRampToValueAtTime(f * 0.08, at + 0.6);
    mod.connect(mg).connect(car.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.006);
    g.gain.exponentialRampToValueAtTime(gain * 0.35, at + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2400;
    car.connect(g).connect(lp);
    lp.connect(dest);
    lp.connect(this.reverb);
    car.start(at); mod.start(at);
    car.stop(at + dur + 0.05); mod.stop(at + dur + 0.05);
  }

  stop() { this.ctx?.suspend(); }
}
