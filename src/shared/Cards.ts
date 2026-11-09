// Карты, колода и оценка комбинаций. Общий код для сервера и браузера.

export type Suit = 's' | 'h' | 'd' | 'c';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export type CardCode = string; // 'As', 'Td', '7h'

export const SUITS: Suit[] = ['s', 'h', 'd', 'c'];
export const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const RANK_CHAR: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};
const CHAR_RANK: Record<string, Rank> = Object.fromEntries(
  Object.entries(RANK_CHAR).map(([r, c]) => [c, Number(r) as Rank]),
) as Record<string, Rank>;

export const rankOf = (c: CardCode): Rank => CHAR_RANK[c[0]];
export const suitOf = (c: CardCode): Suit => c[1] as Suit;
export const makeCard = (r: Rank, s: Suit): CardCode => `${RANK_CHAR[r]}${s}`;
export const rankLabel = (r: Rank): string => (r === 10 ? '10' : RANK_CHAR[r]);

/** rng(n) → равномерное целое в [0, n). Сервер: crypto.randomInt, браузер: crypto.getRandomValues. */
export type IntRng = (n: number) => number;

export function shuffledDeck(rng: IntRng): CardCode[] {
  const cards: CardCode[] = [];
  for (const s of SUITS) for (const r of RANKS) cards.push(makeCard(r, s));
  for (let i = cards.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function browserRng(): IntRng {
  const buf = new Uint32Array(1);
  return (n: number) => {
    // отбрасывание для честной равномерности
    const limit = Math.floor(0x100000000 / n) * n;
    let x: number;
    do {
      globalThis.crypto.getRandomValues(buf);
      x = buf[0];
    } while (x >= limit);
    return x % n;
  };
}

// ───────────────────────── Оценка рук ─────────────────────────

export enum HandCategory {
  HIGH_CARD = 1, PAIR, TWO_PAIR, THREE_OF_A_KIND, STRAIGHT, FLUSH, FULL_HOUSE, FOUR_OF_A_KIND, STRAIGHT_FLUSH,
}

export const CATEGORY_NAME: Record<HandCategory, string> = {
  [HandCategory.HIGH_CARD]: 'Старшая карта',
  [HandCategory.PAIR]: 'Пара',
  [HandCategory.TWO_PAIR]: 'Две пары',
  [HandCategory.THREE_OF_A_KIND]: 'Сет',
  [HandCategory.STRAIGHT]: 'Стрит',
  [HandCategory.FLUSH]: 'Флеш',
  [HandCategory.FULL_HOUSE]: 'Фулл-хаус',
  [HandCategory.FOUR_OF_A_KIND]: 'Каре',
  [HandCategory.STRAIGHT_FLUSH]: 'Стрит-флеш',
};

export interface HandValue {
  category: HandCategory;
  name: string;
  /** Чем больше — тем сильнее. Сравнимо между любыми руками. */
  score: number;
  best: CardCode[];
}

function score5(cards: CardCode[]): { category: HandCategory; score: number } {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every(c => suitOf(c) === suitOf(cards[0]));

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  // группы: сначала по количеству, потом по рангу — это и есть порядок кикеров
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const order = groups.map(g => g[0]);
  const shape = groups.map(g => g[1]).join('');

  let straightHigh = 0;
  if (counts.size === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks[0] === 14 && ranks[1] === 5) straightHigh = 5; // колесо A-2-3-4-5
  }

  let category: HandCategory;
  let tiebreak: number[];
  if (straightHigh && flush) { category = HandCategory.STRAIGHT_FLUSH; tiebreak = [straightHigh]; }
  else if (shape === '41') { category = HandCategory.FOUR_OF_A_KIND; tiebreak = order; }
  else if (shape === '32') { category = HandCategory.FULL_HOUSE; tiebreak = order; }
  else if (flush) { category = HandCategory.FLUSH; tiebreak = ranks; }
  else if (straightHigh) { category = HandCategory.STRAIGHT; tiebreak = [straightHigh]; }
  else if (shape === '311') { category = HandCategory.THREE_OF_A_KIND; tiebreak = order; }
  else if (shape === '221') { category = HandCategory.TWO_PAIR; tiebreak = order; }
  else if (shape === '2111') { category = HandCategory.PAIR; tiebreak = order; }
  else { category = HandCategory.HIGH_CARD; tiebreak = ranks; }

  let score = category;
  for (let i = 0; i < 5; i++) score = score * 15 + (tiebreak[i] || 0);
  return { category, score };
}

export function evaluateHand(cards: CardCode[]): HandValue {
  if (cards.length < 5) {
    const top = Math.max(...cards.map(rankOf));
    return { category: HandCategory.HIGH_CARD, name: CATEGORY_NAME[1], score: top, best: cards };
  }
  let best = { category: HandCategory.HIGH_CARD, score: -1 };
  let bestCards: CardCode[] = [];
  const n = cards.length;
  const pick = [0, 0, 0, 0, 0];
  for (pick[0] = 0; pick[0] < n - 4; pick[0]++)
    for (pick[1] = pick[0] + 1; pick[1] < n - 3; pick[1]++)
      for (pick[2] = pick[1] + 1; pick[2] < n - 2; pick[2]++)
        for (pick[3] = pick[2] + 1; pick[3] < n - 1; pick[3]++)
          for (pick[4] = pick[3] + 1; pick[4] < n; pick[4]++) {
            const combo = pick.map(i => cards[i]);
            const r = score5(combo);
            if (r.score > best.score) { best = r; bestCards = combo; }
          }
  let name = CATEGORY_NAME[best.category];
  if (best.category === HandCategory.STRAIGHT_FLUSH && bestCards.map(rankOf).includes(14) && bestCards.map(rankOf).includes(13)) {
    name = 'Роял-флеш';
  }
  return { category: best.category, name, score: best.score, best: bestCards };
}

// ───────────── Быстрая оценка (для ИИ: тысячи вызовов без аллокаций) ─────────────
// Тот же масштаб score, что и у evaluateHand → результаты сравнимы.

const SUIT_IDX: Record<string, number> = { s: 0, h: 1, d: 2, c: 3 };
const rc = new Int8Array(15);
const sc = new Int8Array(4);
const sm = new Int16Array(4);

function straightTop(mask: number): number {
  for (let hi = 14; hi >= 5; hi--) {
    const m = 0b11111 << (hi - 4);
    if ((mask & m) === m) return hi;
  }
  // колесо: A-2-3-4-5 (туз как 1)
  if ((mask & 0b100000000111100) === 0b100000000111100) return 5;
  return 0;
}

function pack(cat: number, t: number[]): number {
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 15 + (t[i] || 0);
  return s;
}

export function fastScore(cards: CardCode[]): number {
  rc.fill(0); sc.fill(0); sm.fill(0);
  let mask = 0;
  for (const c of cards) {
    const r = CHAR_RANK[c[0]], s = SUIT_IDX[c[1]];
    rc[r]++; sc[s]++; sm[s] |= 1 << r; mask |= 1 << r;
  }
  for (let s = 0; s < 4; s++) {
    if (sc[s] >= 5) {
      const sf = straightTop(sm[s]);
      if (sf) return pack(9, [sf]);
      // флеш возможен только один, но сначала проверим каре/фулл
      let quads = 0, trips = 0, pair = 0;
      for (let r = 14; r >= 2; r--) {
        if (rc[r] === 4) quads = r;
        else if (rc[r] === 3) { if (!trips) trips = r; else if (!pair) pair = r; }
        else if (rc[r] === 2 && !pair) pair = r;
      }
      if (quads) { let k = 0; for (let r = 14; r >= 2; r--) if (r !== quads && rc[r]) { k = r; break; } return pack(8, [quads, k]); }
      if (trips && pair) return pack(7, [trips, pair]);
      const t: number[] = [];
      for (let r = 14; r >= 2 && t.length < 5; r--) if (sm[s] & (1 << r)) t.push(r);
      return pack(6, t);
    }
  }
  let quads = 0, trip1 = 0, trip2 = 0, p1 = 0, p2 = 0, p3 = 0;
  const singles: number[] = [];
  for (let r = 14; r >= 2; r--) {
    const n = rc[r];
    if (n === 4) quads = r;
    else if (n === 3) { if (!trip1) trip1 = r; else trip2 = r; }
    else if (n === 2) { if (!p1) p1 = r; else if (!p2) p2 = r; else p3 = r; }
    else if (n === 1) singles.push(r);
  }
  if (quads) {
    let k = 0; for (let r = 14; r >= 2; r--) if (r !== quads && rc[r]) { k = r; break; }
    return pack(8, [quads, k]);
  }
  if (trip1 && (trip2 || p1)) return pack(7, [trip1, Math.max(trip2, p1)]);
  const st = straightTop(mask);
  if (st) return pack(5, [st]);
  if (trip1) return pack(4, [trip1, ...singles.slice(0, 2)]);
  if (p1 && p2) {
    const kick = Math.max(p3, singles[0] || 0);
    return pack(3, [p1, p2, kick]);
  }
  if (p1) return pack(2, [p1, ...singles.slice(0, 3)]);
  return pack(1, singles.slice(0, 5));
}
