// Итоги посиделки за столом: считаем на клиенте по снимкам стола, показываем при выходе в лобби.

import type { TableView } from '../shared/Table';

const RANK = ['Старшая карта', 'Пара', 'Карманная пара', 'Две пары', 'Сет', 'Стрит', 'Флеш', 'Фулл-хаус', 'Каре', 'Стрит-флеш', 'Роял-флеш'];
const rankOf = (n?: string) => (n ? RANK.findIndex(r => n.startsWith(r)) : -1);

export interface SessionSummary {
  hands: number;
  won: number;
  net: number;
  bestHand: string;
  biggestPot: number;
  minutes: number;
}

export class SessionTracker {
  private active = false;
  private hands = new Set<number>();
  private wonHands = new Set<number>();
  private invested = 0;
  private stack = 0;
  private best = '';
  private biggest = 0;
  private started = 0;
  private rebuyPending = false;
  private lastHandName = '';
  private lastHand = -1;

  /** игрок нажал «докупить» — следующий рост стека с нуля считаем вложением, а не выигрышем */
  rebuy() { this.rebuyPending = true; }

  onState(v: TableView) {
    const me = v.mySeat >= 0 ? v.seats[v.mySeat] : null;
    if (!me) return;
    if (!this.active) {
      this.active = true;
      this.hands.clear(); this.wonHands.clear();
      this.invested = me.stack + me.bet;
      this.stack = me.stack;
      this.best = ''; this.biggest = 0;
      this.started = Date.now();
    }
    if (this.rebuyPending && this.stack === 0 && me.stack > 0) { this.invested += me.stack; this.rebuyPending = false; }
    if (me.hasCards && v.lobby?.started) this.hands.add(v.handId);
    if (v.handId !== this.lastHand) { this.lastHand = v.handId; this.lastHandName = ''; }
    if (v.handName) this.lastHandName = v.handName;
    if (v.stage === 'HAND_OVER') {
      const w = v.winners.filter(x => x.seat === v.mySeat);
      if (w.length && !this.wonHands.has(v.handId)) {
        this.wonHands.add(v.handId);
        const amount = w.reduce((s, x) => s + x.amount, 0);
        this.biggest = Math.max(this.biggest, amount);
      }
      // лучшая собранная рука — по шоудауну или по моей комбинации к концу раздачи
      const name = w.find(x => x.handName)?.handName || (v.showdown && !me.folded ? this.lastHandName : '');
      if (name && rankOf(name) > rankOf(this.best)) this.best = name;
    }
    this.stack = me.stack;
  }

  /** выход из-за стола: вернуть итоги (или null, если толком не играли) и обнулиться */
  finish(): SessionSummary | null {
    if (!this.active) return null;
    this.active = false;
    const res = {
      hands: this.hands.size,
      won: this.wonHands.size,
      net: this.stack - this.invested,
      bestHand: this.best,
      biggestPot: this.biggest,
      minutes: Math.max(1, Math.round((Date.now() - this.started) / 60000)),
    };
    return res.hands > 0 ? res : null;
  }
}
