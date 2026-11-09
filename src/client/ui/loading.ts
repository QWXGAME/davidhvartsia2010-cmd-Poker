// Экран загрузки: реальный прогресс по этапам (шрифты → сукно и дерево → руки → шейдеры).
// Полоса движется плавно (догоняет цель), подпись показывает, что именно грузится сейчас.

type Step = { label: string; weight: number; p: number };

const steps: Record<string, Step> = {
  fonts: { label: 'Шрифты клуба', weight: 1, p: 0 },
  code: { label: 'Раскладываем стол', weight: 1, p: 0 },
  textures: { label: 'Сукно, лак и паркет', weight: 3, p: 0 },
  hands: { label: 'Руки игроков', weight: 3, p: 0 },
  shaders: { label: 'Свет лампы и тени', weight: 2, p: 0 },
};
const order = Object.keys(steps);

let shown = 0;
let raf = 0;
const bar = () => document.getElementById('load-bar');
const pct = () => document.getElementById('load-pct');
const lab = () => document.getElementById('load-label');

function target() {
  let w = 0, sum = 0;
  for (const k of order) { w += steps[k].weight; sum += steps[k].weight * steps[k].p; }
  return sum / w;
}

function current(): string {
  for (const k of order) if (steps[k].p < 1) return steps[k].label;
  return 'Добро пожаловать';
}

let last = 0;
function tick(now: number) {
  const dt = last ? Math.min(0.25, (now - last) / 1000) : 0.016;
  last = now;
  const t = target();
  // по времени, а не по кадрам: на медленном устройстве полоса не «отстаёт» от реальной загрузки
  shown += (t - shown) * (1 - Math.exp(-dt * 7)) + (t > shown ? dt * 0.05 : 0);
  if (shown > t) shown = t;
  const b = bar(), p = pct(), l = lab();
  if (b) b.style.transform = `scaleX(${shown.toFixed(4)})`;
  if (p) p.textContent = `${Math.round(shown * 100)}%`;
  if (l && l.textContent !== current()) {
    l.classList.remove('in'); void l.offsetWidth;
    l.textContent = current();
    l.classList.add('in');
  }
  raf = shown < 0.999 ? requestAnimationFrame(tick) : 0;
}

export const Loading = {
  set(step: keyof typeof steps | string, p: number) {
    const s = steps[step];
    if (!s) return;
    s.p = Math.max(s.p, Math.min(1, p));
    if (!raf) raf = requestAnimationFrame(tick);
  },
  done(step: string) { this.set(step, 1); },
};
