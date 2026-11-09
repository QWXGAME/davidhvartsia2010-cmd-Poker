// ИИ соперников: 4 психотипа + тильт после крупных проигрышей.
// Сила руки — быстрая Монте-Карло оценка эквити против живых соперников.

import { CardCode, SUITS, RANKS, makeCard, fastScore } from './Cards';
import type { ActionType, Personality, Table } from './Table';

export const BOT_ROSTER: { name: string; personality: Personality }[] = [
  { name: 'Сальваторе', personality: 'SHARK' },
  { name: 'Дон Витторио', personality: 'ROCK' },
  { name: 'Лаки Лучано', personality: 'BLUFFER' },
  { name: 'Мистер Блэк', personality: 'SHARK' },
  { name: 'Турист Фрэнк', personality: 'TOURIST' },
];

const tilt = new Map<string, number>(); // id → раздач тильта осталось

export function triggerTilt(id: string) { tilt.set(id, 3); }
export function decayTilt(id: string) {
  const t = tilt.get(id) || 0;
  if (t > 0) tilt.set(id, t - 1);
}
export const isTilted = (id: string) => (tilt.get(id) || 0) > 0;

export function thinkDelay(p: Personality, hard: boolean): number {
  const base = hard ? 1500 : 650;
  const r = Math.random();
  switch (p) {
    case 'ROCK': return base + 500 + r * 1300;
    case 'SHARK': return base + r * 1400;
    case 'BLUFFER': return 450 + r * 800;
    default: return 700 + r * 1000;
  }
}

/** Monte-Carlo: доля выигрыша против N случайных рук (используется ботами и подсказкой игроку). */
export function equity(hole: CardCode[], board: CardCode[], opponents: number, iters = 220): number {
  const used = new Set([...hole, ...board]);
  const rest: CardCode[] = [];
  for (const s of SUITS) for (const r of RANKS) { const c = makeCard(r, s); if (!used.has(c)) rest.push(c); }
  let score = 0;
  const need = 5 - board.length;
  for (let it = 0; it < iters; it++) {
    // частичная перетасовка: берём ровно столько карт, сколько нужно
    const take = need + opponents * 2;
    for (let i = 0; i < take; i++) {
      const j = i + Math.floor(Math.random() * (rest.length - i));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    const fullBoard = board.concat(rest.slice(0, need));
    const mine = fastScore(hole.concat(fullBoard));
    let best = true, ties = 0;
    for (let o = 0; o < opponents; o++) {
      const k = need + o * 2;
      const v = fastScore([rest[k], rest[k + 1], ...fullBoard]);
      if (v > mine) { best = false; break; }
      if (v === mine) ties++;
    }
    if (best) score += ties ? 1 / (ties + 1) : 1;
  }
  return score / iters;
}

export function decide(table: Table, seat: number): { type: ActionType; amount?: number } {
  const p = table.seats[seat]!;
  const legal = table.legal(seat);
  if (!legal) return { type: 'FOLD' };
  const persona = p.personality || 'TOURIST';
  const opponents = table.players().filter(o => o !== p && o.inHand && !o.folded).length;
  const pot = table.potCollected + table.players().reduce((s, o) => s + o.bet, 0);
  const e = equity(p.cards, table.board, Math.max(1, opponents));
  const tilted = isTilted(p.id);
  const fair = 1 / (opponents + 1); // «средняя» доля банка
  const strength = e / fair;        // >1 — лучше среднего
  const potOdds = legal.toCall / (pot + legal.toCall || 1);
  const rnd = Math.random();

  const raiseTo = (fracOfPot: number) => {
    const size = Math.max(table.bb, Math.round((pot + legal.toCall) * fracOfPot / table.bb) * table.bb);
    return Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, table.currentBet + size));
  };
  const raise = (frac: number) => legal.canRaise ? { type: 'RAISE' as const, amount: raiseTo(frac) } : null;
  const passive = () => (legal.canCheck ? { type: 'CHECK' as const } : { type: 'CALL' as const });

  let aggr = { ROCK: 0.8, SHARK: 1.0, BLUFFER: 1.3, TOURIST: 0.5 }[persona];
  let loose = { ROCK: -0.08, SHARK: 0, BLUFFER: 0.06, TOURIST: 0.12 }[persona];
  if (tilted) { aggr *= persona === 'ROCK' ? 1.4 : 1.8; loose += 0.1; }

  // сильная рука — вэлью
  if (strength > 1.9 - aggr * 0.25 && rnd < 0.55 + aggr * 0.2) {
    return raise(strength > 2.6 ? 0.9 : 0.6) || passive();
  }
  // блеф / полублеф
  const bluffChance = { ROCK: 0.03, SHARK: 0.12, BLUFFER: 0.28, TOURIST: 0.02 }[persona] * (tilted ? 2 : 1);
  if (legal.toCall <= pot * 0.5 && rnd < bluffChance) {
    return raise(0.65) || passive();
  }
  if (legal.canCheck) return { type: 'CHECK' };
  // колл по шансам банка
  if (e + loose > potOdds + 0.03) return { type: 'CALL' };
  // туристы любят «посмотреть»
  if (persona === 'TOURIST' && legal.toCall <= table.bb * 2 && rnd < 0.5) return { type: 'CALL' };
  return { type: 'FOLD' };
}
