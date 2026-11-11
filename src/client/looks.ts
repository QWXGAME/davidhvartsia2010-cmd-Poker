// Оформление стола без зависимостей от 3D: сукно и рубашки карт, выбор хранится в браузере.

/** Рубашки карт: фон, узор, рамка. */
export const CARD_BACKS: Record<string, { name: string; bg: string; line: string; frame: string; swatch: string; unlock?: boolean; hint?: string }> = {
  navy: { name: 'Полночь', bg: '#141a28', line: 'rgba(190,198,214,0.42)', frame: '#d6dce8', swatch: '#1d2638' },
  bordeaux: { name: 'Бордо', bg: '#4a0f1d', line: 'rgba(226,190,120,0.40)', frame: '#d9b56a', swatch: '#5e1426' },
  emerald: { name: 'Изумруд', bg: '#0d3326', line: 'rgba(214,196,140,0.38)', frame: '#cdb978', swatch: '#11452f' },
  onyx: { name: 'Оникс', bg: '#0c0b0d', line: 'rgba(212,175,55,0.40)', frame: '#d4af37', swatch: '#1a171b' },
  // открываются сезонным пропуском
  crimson: { name: 'Кармин', bg: '#6e0f18', line: 'rgba(255,214,170,0.42)', frame: '#f0c987', swatch: '#8a1420', unlock: true, hint: 'сезон · ур. 2' },
  jade: { name: 'Нефрит', bg: '#0e3f3a', line: 'rgba(190,240,220,0.40)', frame: '#9fd8c0', swatch: '#125049', unlock: true, hint: 'сезон · ур. 8' },
  ivory: { name: 'Слоновая кость', bg: '#e9e1cf', line: 'rgba(120,90,40,0.38)', frame: '#8a6a2a', swatch: '#efe8d8', unlock: true, hint: 'сезон · ур. 14' },
  royal: { name: 'Королевская', bg: '#1b1a4a', line: 'rgba(232,211,162,0.55)', frame: '#e8d3a2', swatch: '#25236a', unlock: true, hint: 'сезон · ур. 20' },
  // призы турнира «Ночь пятницы»
  friday_gold: { name: 'Пятница · Золото', bg: '#2a1d06', line: 'rgba(255,220,120,0.65)', frame: '#ffd66e', swatch: '#c99a2e', unlock: true, hint: '1 место турнира' },
  friday_silver: { name: 'Пятница · Серебро', bg: '#1c1f24', line: 'rgba(230,236,245,0.60)', frame: '#e6ecf5', swatch: '#a9b2bf', unlock: true, hint: '2 место турнира' },
  friday_bronze: { name: 'Пятница · Бронза', bg: '#2a160c', line: 'rgba(230,160,110,0.60)', frame: '#d99060', swatch: '#a8643a', unlock: true, hint: '3 место турнира' },
};

/** Сукно и темы стола. theme — полная тема 2D-стола (борт, свет); в 3D меняется цвет сукна. */
export interface Felt { id: string; name: string; color: string; theme?: string; unlock?: boolean; hint?: string }
export const FELTS: Felt[] = [
  { id: 'bordeaux', name: 'Бордо', color: '#56172a' },
  { id: 'emerald', name: 'Изумруд', color: '#0f4a34' },
  { id: 'midnight', name: 'Полночь', color: '#14213d' },
  { id: 'monaco', name: 'Монако', color: '#d8d2c2', theme: 'monaco' },
  { id: 'vegas', name: 'Вегас', color: '#2b0d44', theme: 'vegas' },
  { id: 'london', name: 'Лондон', color: '#17452c', theme: 'london' },
  { id: 'graphite', name: 'Графит', color: '#26282c', unlock: true, hint: 'сезон · ур. 4' },
  { id: 'tobacco', name: 'Табак', color: '#4a2e18', unlock: true, hint: 'сезон · ур. 10' },
  { id: 'royalblue', name: 'Королевский синий', color: '#14307a', unlock: true, hint: 'сезон · ур. 16' },
];
export function savedFeltId(): string {
  try { const v = localStorage.getItem('pn.feltId'); if (v && FELTS.some(f => f.id === v)) return v; const c = localStorage.getItem('pn.felt'); return FELTS.find(f => f.color === c)?.id || 'bordeaux'; } catch { return 'bordeaux'; }
}
export function savedFelt(def: string) {
  try { if (!localStorage.getItem('pn.feltId') && !localStorage.getItem('pn.felt')) return def; } catch { return def; }
  return FELTS.find(f => f.id === savedFeltId())?.color || def;
}
export function saveFelt(id: string) {
  const f = FELTS.find(x => x.id === id);
  if (!f) return;
  try { localStorage.setItem('pn.feltId', id); localStorage.setItem('pn.felt', f.color); } catch { /* */ }
  applyTheme();
}
/** тема 2D-стола — класс на body */
export function applyTheme() {
  const f = FELTS.find(x => x.id === savedFeltId());
  for (const c of [...document.body.classList]) if (c.startsWith('theme-')) document.body.classList.remove(c);
  if (f?.theme) document.body.classList.add('theme-' + f.theme);
}
/** открыт ли предмет (рубашка/сукно) у игрока */
export function isOpen(id: string, unlocks: string[] | undefined, needs?: boolean) { return !needs || !!unlocks?.includes(id); }
export function currentBack(): string {
  try { const v = localStorage.getItem('pn.back'); return v && CARD_BACKS[v] ? v : 'navy'; } catch { return 'navy'; }
}
export function saveBack(style: string) {
  try { localStorage.setItem('pn.back', style); } catch { /* приватный режим */ }
}

/** Вид стола: 3D (кино) или 2D (лёгкий, для телефонов). */
export type ViewMode = '3d' | '2d';
export function viewMode(): ViewMode {
  try { const v = localStorage.getItem('pn.view'); if (v === '2d' || v === '3d') return v; } catch { /* */ }
  return '3d';
}
export function saveViewMode(m: ViewMode) {
  try { localStorage.setItem('pn.view', m); } catch { /* */ }
}
