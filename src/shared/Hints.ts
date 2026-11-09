// Подсказки для новичков: какие карты «совпали» (их подсвечиваем на столе) и что разумно сделать.
// Простые правила, без расчётов вероятностей — понятный язык, а не советы профи.

import { CardCode, evaluateHand, HandCategory, rankOf, suitOf } from './Cards';

export interface Hint {
  /** название комбинации */
  name: string;
  /** карты, из которых она сложилась (мои + общие) — подсвечиваются */
  made: CardCode[];
  /** короткий совет */
  tip: string;
  /** сила: 0 — слабо, 1 — средне, 2 — сильно (цвет подсказки) */
  level: 0 | 1 | 2;
}

const RANK_NAME: Record<number, string> = { 14: 'тузов', 13: 'королей', 12: 'дам', 11: 'валетов', 10: 'десяток', 9: 'девяток', 8: 'восьмёрок', 7: 'семёрок', 6: 'шестёрок', 5: 'пятёрок', 4: 'четвёрок', 3: 'троек', 2: 'двоек' };

export function makeHint(hole: CardCode[], board: CardCode[], toCall: number): Hint | null {
  if (hole.length < 2 || hole.some(c => !c)) return null;
  const all = [...hole, ...board];
  const call = toCall > 0;
  // префлоп: только две свои карты
  if (board.length === 0) {
    const [a, b] = hole.map(rankOf);
    if (a === b) return { name: `Пара ${RANK_NAME[a]}`, made: hole, level: a >= 9 ? 2 : 1, tip: a >= 9 ? 'Отличный старт — смело Рейз' : 'Карманная пара — можно Колл и посмотреть флоп' };
    const suited = suitOf(hole[0]) === suitOf(hole[1]);
    const hi = Math.max(a, b), lo = Math.min(a, b);
    if (hi >= 13 && lo >= 10) return { name: 'Две старшие карты', made: hole, level: 2, tip: 'Сильные карты — Рейз или Колл' };
    if (hi >= 11 && (lo >= 9 || suited)) return { name: suited ? 'Старшие одной масти' : 'Старшие карты', made: hole, level: 1, tip: call ? 'Неплохо — можно Колл' : 'Неплохо — можно Чек или небольшая ставка' };
    if (suited && hi - lo <= 2) return { name: 'Одномастные соседи', made: hole, level: 1, tip: 'Могут собрать стрит или флеш — дёшево можно Колл' };
    return { name: 'Слабые карты', made: [], level: 0, tip: call ? 'Без совпадений — лучше Фолд' : 'Без совпадений — Чек, ставить не стоит' };
  }
  const v = evaluateHand(all);
  // какие карты образуют комбинацию
  let made: CardCode[] = [];
  const counts = new Map<number, number>();
  for (const c of all) counts.set(rankOf(c), (counts.get(rankOf(c)) || 0) + 1);
  if (v.category === HandCategory.STRAIGHT || v.category === HandCategory.FLUSH || v.category === HandCategory.STRAIGHT_FLUSH) made = v.best;
  else if (v.category !== HandCategory.HIGH_CARD) made = (v.best || []).filter(c => (counts.get(rankOf(c)) || 0) >= 2);
  const usesMine = made.some(c => hole.includes(c));
  // дро: 4 карты одной масти
  const suits = new Map<string, number>();
  for (const c of all) suits.set(suitOf(c), (suits.get(suitOf(c)) || 0) + 1);
  const flushDraw = board.length < 5 && [...suits.entries()].some(([s, n]) => n === 4 && hole.some(c => suitOf(c) === s));

  if (v.category >= HandCategory.TWO_PAIR) {
    return { name: v.name, made, level: 2, tip: usesMine ? 'Сильная рука — ставьте, Рейз' : 'Комбинация лежит на столе у всех — осторожно' };
  }
  if (v.category === HandCategory.PAIR) {
    const pr = rankOf(made[0] || hole[0]);
    const name = `Пара ${RANK_NAME[pr] || ''}`.trim();
    if (!usesMine) return { name, made, level: 0, tip: 'Пара на столе общая — у вас ничего нового. Чек' + (call ? ' или Фолд' : '') };
    return pr >= 10
      ? { name, made, level: 2, tip: 'Хорошая пара — Колл или Рейз' }
      : { name, made, level: 1, tip: call ? 'Средняя пара — Колл, без больших ставок' : 'Средняя пара — Чек или небольшая ставка' };
  }
  if (flushDraw) return { name: 'Почти флеш', made: all.filter(c => (suits.get(suitOf(c)) || 0) === 4), level: 1, tip: 'Не хватает одной карты до флеша — дёшево можно Колл' };
  return { name: 'Без совпадений', made: [], level: 0, tip: call ? 'Ничего не собралось — лучше Фолд' : 'Ничего не собралось — Чек' };
}
