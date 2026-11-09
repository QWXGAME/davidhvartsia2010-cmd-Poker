// Лёгкий твин-движок с отменой по ключу.

export type Ease = (t: number) => number;
export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuint: (t: number) => 1 - Math.pow(1 - t, 5),
  outBack: (t: number) => { const c1 = 1.2, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};

interface Tw {
  key?: object;
  start: number;
  dur: number;
  ease: Ease;
  step: (k: number) => void;
  done?: () => void;
  dead?: boolean;
}

export class Tweens {
  private list: Tw[] = [];
  now = 0;

  get busy() { return this.list.length > 0; }

  add(dur: number, step: (k: number) => void, opts: { delay?: number; ease?: Ease; key?: object; done?: () => void } = {}) {
    if (opts.key) this.cancel(opts.key);
    this.list.push({ key: opts.key, start: this.now + (opts.delay || 0), dur: Math.max(1, dur), ease: opts.ease || ease.outCubic, step, done: opts.done });
  }

  /** Пауза в «времени анимаций» (останавливается вместе со вкладкой). */
  waitFor(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise(res => this.add(ms, () => {}, { done: res }));
  }

  cancel(key: object) {
    for (const t of this.list) if (t.key === key) t.dead = true;
  }

  update(nowMs: number) {
    this.now = nowMs;
    if (!this.list.length) return;
    const snapshot = this.list;
    this.list = [];
    for (const t of snapshot) {
      if (t.dead) continue;
      if (nowMs < t.start) { this.list.push(t); continue; }
      const k = Math.min(1, (nowMs - t.start) / t.dur);
      t.step(t.ease(k));
      if (k < 1) this.list.push(t);
      else t.done?.();
    }
    if (this.list.some(t => t.dead)) this.list = this.list.filter(t => !t.dead);
  }
}
