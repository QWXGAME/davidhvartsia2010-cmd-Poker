// Звук: процедурный синтез (Web Audio). Фишки, карты, стук по столу, лёд, затвор,
// и музыка из своего плейлиста со звучанием виниловой пластинки.

type Ctx = AudioContext;

const MUSIC_VOL = 0.42;
/** за столом музыка тише, чем в лобби — не мешает игре */
const TABLE_VOL = 0.3;
const XFADE = 4;

export class Audio {
  private ctx: Ctx | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private reverb!: ConvolverNode;
  private noiseBuf!: AudioBuffer;
  private musicOn = true;
  private sfxOn = true;
  private musicStarted = false;
  private playlist: Promise<void>;

  constructor() {
    try {
      this.musicOn = localStorage.getItem('pn.music2') !== '0';
      this.sfxOn = localStorage.getItem('pn.sfx') !== '0';
    } catch { /* приватный режим */ }
    // плейлист грузим сразу: музыка стартует с самого входа (если браузер разрешает автозапуск),
    // иначе — с первого касания. Громкость нарастает плавно, треки сменяются мягким затуханием.
    this.playlist = fetch('audio/playlist.json', { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : { tracks: [] }))
      .then(j => { this.lobbyTrack = j.lobby || ''; this.tracks = (j.table || j.tracks || []) as string[]; })
      .catch(() => { /* без плейлиста — тишина */ });
    this.playlist.then(() => { this.init(); this.startMusic(); this.ctx?.resume().catch(() => {}); });
    const unlock = () => {
      this.init();
      if (this.ctx?.state === 'suspended') this.ctx.resume();
      this.startMusic();
      if (this.musicOn) this.resumeDecks();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchend', unlock, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) { this.ctx.suspend(); this.decks.forEach(d => d.el.pause()); }
      else { this.ctx.resume(); if (this.musicOn) this.resumeDecks(); }
    });
  }

  get musicEnabled() { return this.musicOn; }
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
    this.music = ctx.createGain();
    this.music.gain.value = 0;   // стартуем с тишины — дальше плавное нарастание
    this.music.connect(this.master);

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

  toggleMusic(): boolean {
    this.musicOn = !this.musicOn;
    try { localStorage.setItem('pn.music2', this.musicOn ? '1' : '0'); } catch { /* */ }
    this.init();
    if (this.ctx && this.musicStarted) this.music.gain.setTargetAtTime(this.musicOn ? 1 : 0, this.ctx.currentTime, 0.3);
    if (this.musicOn) this.resumeDecks(); else this.decks.forEach(d => d.el.pause());
    if (this.musicOn) this.startMusic();
    return this.musicOn;
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
    if (this.musicStarted && this.musicOn) {
      const g = this.music.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0.22, t + 0.25);
      g.setValueAtTime(0.22, t + 2.2);
      g.linearRampToValueAtTime(1, t + 3.6);
    }
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

  // ───────────────────────── музыка: свой плейлист «с пластинки» ─────────────────────────
  // Треки лежат в public/audio, список — public/audio/playlist.json.
  // Цепочка: тёплый тон (срез верхов и низов, лёгкая сатурация) → «плавание» скорости пластинки →
  // объём: исходное стерео + пространственная копия с отражениями зала. Поверх — шипение и щелчки винила.

  // Две «деки»: пока одна доигрывает, вторая плавно входит — настоящий кроссфейд без пауз.
  // Лобби: свой трек по кругу. За столом: плейлист строго по порядку, после последнего — сначала.
  private trackIdx = 0;
  private tracks: string[] = [];
  private lobbyTrack = '';
  private scene: 'lobby' | 'table' = 'lobby';
  private decks: { el: HTMLAudioElement; g: GainNode; kind: 'lobby' | 'table' | '' }[] = [];
  private cur = 0;
  private chainIn!: GainNode;

  /** где игрок: в лобби или за столом — музыка плавно меняется */
  setScene(s: 'lobby' | 'table') {
    if (this.scene === s) return;
    this.scene = s;
    if (this.decks.length) this.playScene(XFADE);
  }

  private async startMusic() {
    if (!this.musicOn || this.musicStarted || !this.ctx) return;
    this.musicStarted = true;
    if (!this.tracks.length && !this.lobbyTrack) await this.playlist;
    if (!this.tracks.length && !this.lobbyTrack) return;
    this.buildVinylChain();
    for (let i = 0; i < 2; i++) this.decks.push(this.makeDeck());
    // общий плавный вход в игру
    const t = this.ctx.currentTime;
    this.music.gain.cancelScheduledValues(t);
    this.music.gain.setValueAtTime(0.0001, t);
    this.music.gain.linearRampToValueAtTime(1, t + 6);
    this.playScene(1.5, true);
  }

  private makeDeck() {
    const c = this.ctx!;
    const el = new window.Audio();
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    const g = c.createGain();
    g.gain.value = 0;
    c.createMediaElementSource(el).connect(g).connect(this.chainIn);
    const deck = { el, g, kind: '' as 'lobby' | 'table' | '' };
    const next = (fade: number) => { this.trackIdx = (this.trackIdx + 1) % this.tracks.length; this.playScene(fade, true); };
    // трек стола подходит к концу — следующий входит поверх затухающего
    el.ontimeupdate = () => {
      if (deck !== this.decks[this.cur] || deck.kind !== 'table') return;
      if (el.duration && el.duration - el.currentTime < XFADE + 0.3) next(XFADE);
    };
    el.onended = () => { if (deck === this.decks[this.cur] && deck.kind === 'table') next(1); };
    return deck;
  }

  /** запустить музыку текущей сцены на свободной деке, текущую — плавно увести */
  private playScene(fade: number, force = false) {
    if (!this.ctx || !this.decks.length) return;
    const want: 'lobby' | 'table' = this.scene === 'table' && this.tracks.length ? 'table' : this.lobbyTrack ? 'lobby' : 'table';
    if (want === 'table' && !this.tracks.length) return;
    const now = this.decks[this.cur];
    if (!force && now.kind === want) return;
    const t = this.ctx.currentTime;
    // текущая дека затихает и останавливается
    now.kind = '';
    now.g.gain.cancelScheduledValues(t);
    now.g.gain.setValueAtTime(now.g.gain.value, t);
    now.g.gain.linearRampToValueAtTime(0, t + fade);
    setTimeout(() => { if (!now.kind) now.el.pause(); }, fade * 1000 + 150);
    // вторая дека входит
    this.cur = 1 - this.cur;
    const d = this.decks[this.cur];
    d.kind = want;
    d.el.loop = want === 'lobby';
    d.el.src = 'audio/' + (want === 'lobby' ? this.lobbyTrack : this.tracks[this.trackIdx]);
    d.g.gain.cancelScheduledValues(t);
    d.g.gain.setValueAtTime(0.0001, t);
    d.g.gain.linearRampToValueAtTime(want === 'lobby' ? MUSIC_VOL : TABLE_VOL, t + fade);
    if (this.musicOn) d.el.play().catch(() => {});
  }

  private resumeDecks() {
    if (!this.musicStarted) { this.startMusic(); return; }
    const d = this.decks[this.cur];
    if (d && d.kind && d.el.paused && d.el.src) d.el.play().catch(() => {});
  }

  private buildVinylChain() {
    const c = this.ctx!;
    this.chainIn = c.createGain();
    const src = this.chainIn;

    // тон пластинки
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 42;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 10500; lp.Q.value = 0.4;
    const warm = c.createBiquadFilter(); warm.type = 'peaking'; warm.frequency.value = 190; warm.gain.value = 2.2; warm.Q.value = 0.8;
    const air = c.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 6500; air.gain.value = -3;
    const sat = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 1.35) / Math.tanh(1.35); }
    sat.curve = curve; sat.oversample = '2x';

    // «плавание» скорости: медленный wow + быстрый flutter
    const wobble = c.createDelay(0.05);
    wobble.delayTime.value = 0.012;
    const wow = c.createOscillator(); wow.frequency.value = 0.55;
    const wowG = c.createGain(); wowG.gain.value = 0.0009;
    const flut = c.createOscillator(); flut.frequency.value = 6.3;
    const flutG = c.createGain(); flutG.gain.value = 0.00012;
    wow.connect(wowG).connect(wobble.delayTime);
    flut.connect(flutG).connect(wobble.delayTime);
    wow.start(); flut.start();

    src.connect(hp).connect(warm).connect(air).connect(lp).connect(sat).connect(wobble);

    // объём: сухое стерео + пространственная копия в зале (проигрыватель в углу слева сзади)
    const dry = c.createGain(); dry.gain.value = 0.78;
    const panner = c.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1.5;
    panner.positionX.value = -1.6; panner.positionY.value = 0.4; panner.positionZ.value = -2.2;
    const spatial = c.createGain(); spatial.gain.value = 0.45;
    const roomSend = c.createGain(); roomSend.gain.value = 0.35;
    wobble.connect(dry).connect(this.music);
    wobble.connect(panner).connect(spatial).connect(this.music);
    spatial.connect(roomSend).connect(this.reverb);
    // медленно «гуляющий» источник — звук живёт в пространстве
    const drift = () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      panner.positionX.setTargetAtTime(-1.6 + Math.sin(t * 0.05) * 0.6, t, 2);
      setTimeout(drift, 1000);
    };
    drift();
  }


  /** шипение и редкие щелчки иглы */
  /** шипение иглы (сейчас выключено) */
  crackle() {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.35;
    const g = c.createGain(); g.gain.value = 0.016;
    src.connect(bp).connect(g).connect(this.music);
    src.start();
    const pop = () => {
      if (this.musicOn && this.ctx?.state === 'running') {
        const t = this.ctx.currentTime;
        const n = Math.random() < 0.25 ? 2 : 1;
        for (let i = 0; i < n; i++) this.noise(t + i * 0.02, 0.006 + Math.random() * 0.01, 'highpass', 1800, 1400, 0.05 + Math.random() * 0.12, 1, this.music);
      }
      setTimeout(pop, 90 + Math.random() * 700);
    };
    pop();
  }

  stop() { this.decks.forEach(d => d.el.pause()); }
}
