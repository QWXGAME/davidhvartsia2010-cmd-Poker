// «Бегущие» цифры, как на табло: число плавно докручивается до нового значения,
// при росте — короткая золотая вспышка, при падении — тусклый отблеск.

const fmtDef = (n: number) => Math.round(n).toLocaleString('ru-RU');
const state = new WeakMap<HTMLElement, { v: number; raf: number }>();

export function rollTo(el: HTMLElement, to: number, fmt: (n: number) => string = fmtDef, dur = 750) {
  const st = state.get(el);
  if (!st) { state.set(el, { v: to, raf: 0 }); el.textContent = fmt(to); return; }
  if (st.v === to) return;
  cancelAnimationFrame(st.raf);
  const from = st.v;
  st.v = to;
  el.classList.remove('roll-up', 'roll-down');
  void el.offsetWidth;
  el.classList.add(to > from ? 'roll-up' : 'roll-down');
  const t0 = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 4);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) st.raf = requestAnimationFrame(step);
  };
  st.raf = requestAnimationFrame(step);
}
