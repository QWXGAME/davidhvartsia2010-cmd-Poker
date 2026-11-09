// Логика стола 6-Max Texas Hold'em: блайнды, торговля, сайд-поты, вскрытие, show/muck.
// Чистая логика без таймеров — ими управляет TableHost.

import { CardCode, IntRng, evaluateHand, shuffledDeck } from './Cards';

export type Stage = 'WAITING' | 'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'HAND_OVER';
export type ActionType = 'FOLD' | 'CHECK' | 'CALL' | 'RAISE' | 'ALLIN';
export type Personality = 'ROCK' | 'SHARK' | 'BLUFFER' | 'TOURIST';

export const MAX_SEATS = 6;

export interface Player {
  id: string;
  name: string;
  seat: number;
  stack: number;
  bet: number;        // поставлено на текущей улице
  committed: number;  // всего в этой раздаче
  cards: CardCode[];
  folded: boolean;
  allIn: boolean;
  acted: boolean;
  inHand: boolean;
  revealed: [boolean, boolean];
  lastAction: { type: ActionType | 'SB' | 'BB'; amount: number } | null;
  isBot: boolean;
  personality?: Personality;
  ring?: string;
  /** купленные предметы, которые лежат на столе у игрока — видны всем */
  items?: string[];
  leaving?: boolean;
}

export interface Winner {
  seat: number;
  amount: number;
  handName?: string;
  best?: CardCode[];
}

export interface PotView { amount: number; seats: number[] }

export interface SeatView {
  seat: number;
  id: string;
  name: string;
  stack: number;
  bet: number;
  folded: boolean;
  allIn: boolean;
  inHand: boolean;
  hasCards: boolean;
  cards: (CardCode | null)[]; // null = рубашка
  lastAction: Player['lastAction'];
  isBot: boolean;
  ring?: string;
  items?: string[];
}

export interface LobbyInfo {
  id: string;
  owner: string;
  started: boolean;
  isPrivate: boolean;
  invite?: string;   // ссылка-приглашение (t.me/... или адрес игры)
  players: { id: string; name: string; isBot: boolean; seat: number }[];
}

export interface TableView {
  lobby?: LobbyInfo;
  tableId: string;
  handId: number;
  stage: Stage;
  sb: number;
  bb: number;
  button: number;
  board: CardCode[];
  pot: number;         // всё, что уже собрано с прошлых улиц + текущие ставки
  potCollected: number;// собрано в центр (без ставок текущей улицы)
  seats: (SeatView | null)[];
  activeSeat: number;
  deadline: number;    // ms epoch, 0 — нет
  mySeat: number;
  toCall: number;
  minRaiseTo: number;
  maxRaiseTo: number;
  canCheck: boolean;
  winners: Winner[];
  showdown: boolean;
  canReveal: boolean;  // я выиграл без вскрытия и могу показать карты
  deckHash?: string;
  /** Provably fair: после раздачи раскрываются сид и порядок колоды — sha256(seed:order) === deckHash */
  fair?: { seed: string; order: string };
  handName?: string;   // моя текущая комбинация
}

export class Table {
  readonly id: string;
  sb: number;
  bb: number;
  seats: (Player | null)[] = Array(MAX_SEATS).fill(null);
  stage: Stage = 'WAITING';
  handId = 0;
  button = -1;
  board: CardCode[] = [];
  deck: CardCode[] = [];
  deckHash?: string;
  private fairSeed?: string;
  private fairOrder?: string;
  currentBet = 0;
  minRaise = 0;
  activeSeat = -1;
  /** Улица закрыта, ждём advance() от хоста (пауза для анимации). */
  pendingAdvance = false;
  potCollected = 0;
  winners: Winner[] = [];
  showdown = false;
  uncontestedSeat = -1;
  deadline = 0;

  constructor(id: string, sb: number, bb: number, private rng: IntRng) {
    this.id = id;
    this.sb = sb;
    this.bb = bb;
  }

  // ───────────── места ─────────────

  players(): Player[] {
    return this.seats.filter((p): p is Player => !!p);
  }

  byId(id: string): Player | undefined {
    return this.players().find(p => p.id === id);
  }

  freeSeat(prefer?: number): number {
    if (prefer !== undefined && prefer >= 0 && prefer < MAX_SEATS && !this.seats[prefer]) return prefer;
    return this.seats.findIndex(s => !s);
  }

  sit(p: Omit<Player, 'bet' | 'committed' | 'cards' | 'folded' | 'allIn' | 'acted' | 'inHand' | 'revealed' | 'lastAction' | 'leaving'>): Player {
    if (this.seats[p.seat]) throw new Error('Место занято');
    const player: Player = {
      ...p, bet: 0, committed: 0, cards: [], folded: false, allIn: false, acted: false,
      inHand: false, revealed: [false, false], lastAction: null,
    };
    this.seats[p.seat] = player;
    return player;
  }

  /**
   * Встать из-за стола. Если игрок в раздаче — фолд, а место освобождается после раздачи
   * (его фишки уже в банке). Возвращает стек к выплате или null, если выход отложен.
   */
  leave(id: string): number | null {
    const p = this.byId(id);
    if (!p) return 0;
    if (p.inHand && this.isBetting()) {
      if (!p.folded) {
        if (this.activeSeat === p.seat) this.act(p.seat, 'FOLD');
        else { p.folded = true; p.lastAction = { type: 'FOLD', amount: p.bet }; this.checkUncontested(); }
      }
      if (this.isBetting()) { p.leaving = true; return null; }
    }
    const stack = p.stack;
    this.seats[p.seat] = null;
    return stack;
  }

  /** Убрать отложенно ушедших. Возвращает [id, стек] к выплате. */
  removeLeavers(): [string, number][] {
    const out: [string, number][] = [];
    for (const p of this.players()) if (p.leaving) { out.push([p.id, p.stack]); this.seats[p.seat] = null; }
    return out;
  }

  isBetting(): boolean {
    return this.stage === 'PREFLOP' || this.stage === 'FLOP' || this.stage === 'TURN' || this.stage === 'RIVER';
  }

  private nextSeat(from: number, pred: (p: Player) => boolean): number {
    for (let i = 1; i <= MAX_SEATS; i++) {
      const s = (from + i) % MAX_SEATS;
      const p = this.seats[s];
      if (p && pred(p)) return s;
    }
    return -1;
  }

  canStart(): boolean {
    return this.players().filter(p => p.stack > 0 && !p.leaving).length >= 2;
  }

  // ───────────── раздача ─────────────

  startHand(fair?: (deck: CardCode[]) => { hash: string; seed: string }): boolean {
    if (!this.canStart()) { this.stage = 'WAITING'; return false; }
    this.handId++;
    this.board = [];
    this.winners = [];
    this.showdown = false;
    this.uncontestedSeat = -1;
    this.potCollected = 0;
    this.pendingAdvance = false;
    this.deck = shuffledDeck(this.rng);
    const f = fair?.(this.deck);
    this.deckHash = f?.hash;
    this.fairSeed = f?.seed;
    this.fairOrder = f ? this.deck.join(',') : undefined;

    for (const p of this.players()) {
      p.bet = 0; p.committed = 0; p.cards = []; p.folded = false; p.allIn = false;
      p.acted = false; p.revealed = [false, false]; p.lastAction = null;
      p.inHand = p.stack > 0 && !p.leaving;
    }
    const inHand = (p: Player) => p.inHand;
    this.button = this.nextSeat(this.button < 0 ? MAX_SEATS - 1 : this.button, inHand);
    const headsUp = this.players().filter(inHand).length === 2;
    const sbSeat = headsUp ? this.button : this.nextSeat(this.button, inHand);
    const bbSeat = this.nextSeat(sbSeat, inHand);

    this.post(sbSeat, this.sb, 'SB');
    this.post(bbSeat, this.bb, 'BB');
    this.currentBet = this.bb;
    this.minRaise = this.bb;

    // по одной карте по кругу, начиная слева от баттона
    for (let round = 0; round < 2; round++) {
      let s = this.button;
      for (let k = 0; k < MAX_SEATS; k++) {
        s = this.nextSeat(s, inHand);
        this.seats[s]!.cards.push(this.deck.pop()!);
        if (s === this.button) break;
      }
    }

    this.stage = 'PREFLOP';
    this.activeSeat = this.nextSeat(bbSeat, p => p.inHand && !p.allIn);
    if (this.countCanAct() === 0 || (this.countCanAct() === 1 && this.seats[this.activeSeat]!.bet >= this.currentBet)) {
      this.activeSeat = -1;
      this.pendingAdvance = true;
    }
    return true;
  }

  private post(seat: number, amount: number, label: 'SB' | 'BB') {
    const p = this.seats[seat]!;
    const a = Math.min(amount, p.stack);
    p.stack -= a; p.bet += a; p.committed += a;
    if (p.stack === 0) p.allIn = true;
    p.lastAction = { type: label, amount: a };
  }

  /** все, кроме максимум одного, в олл-ине — карты докручиваются без торговли */
  get runout(): boolean { const l = this.live(); return l.length >= 2 && l.filter(p => !p.allIn).length <= 1; }

  private live(): Player[] { return this.players().filter(p => p.inHand && !p.folded); }
  private countCanAct(): number { return this.live().filter(p => !p.allIn).length; }

  // ───────────── действия ─────────────

  legal(seat: number) {
    const p = this.seats[seat];
    if (!p || seat !== this.activeSeat) return null;
    const toCall = Math.min(this.currentBet - p.bet, p.stack);
    const maxTo = p.bet + p.stack;
    const othersCanAct = this.live().some(o => o !== p && !o.allIn);
    const minTo = Math.min(this.currentBet + this.minRaise, maxTo);
    return {
      toCall,
      canCheck: toCall === 0,
      canRaise: othersCanAct && maxTo > this.currentBet,
      minRaiseTo: minTo,
      maxRaiseTo: maxTo,
    };
  }

  act(seat: number, type: ActionType, amount = 0): boolean {
    const p = this.seats[seat];
    const legal = this.legal(seat);
    if (!p || !legal || this.pendingAdvance) return false;

    if (type === 'CHECK' && !legal.canCheck) type = 'CALL';
    if (type === 'RAISE' && !legal.canRaise) type = legal.canCheck ? 'CHECK' : 'CALL';

    switch (type) {
      case 'FOLD':
        if (legal.canCheck) { type = 'CHECK'; break; } // фолд без ставки = чек
        p.folded = true;
        break;
      case 'CHECK':
        break;
      case 'CALL':
        this.putIn(p, legal.toCall);
        break;
      case 'ALLIN':
      case 'RAISE': {
        let to = type === 'ALLIN' ? legal.maxRaiseTo : Math.floor(amount);
        to = Math.max(legal.minRaiseTo, Math.min(to, legal.maxRaiseTo));
        if (to <= this.currentBet) { this.putIn(p, legal.toCall); type = 'CALL'; break; }
        const raiseSize = to - this.currentBet;
        this.putIn(p, to - p.bet);
        if (raiseSize >= this.minRaise) {
          this.minRaise = raiseSize;
          for (const o of this.live()) if (o !== p) o.acted = false; // полный рейз заново открывает торговлю
        }
        this.currentBet = to;
        type = p.allIn ? 'ALLIN' : 'RAISE';
        break;
      }
    }
    if (type === 'CALL' && p.allIn) type = 'ALLIN';
    p.acted = true;
    p.lastAction = { type, amount: p.bet };

    if (this.checkUncontested()) return true;

    const next = this.nextSeat(seat, o => o.inHand && !o.folded && !o.allIn && (!o.acted || o.bet < this.currentBet));
    if (next === -1) {
      this.activeSeat = -1;
      this.pendingAdvance = true;
    } else {
      this.activeSeat = next;
    }
    return true;
  }

  private putIn(p: Player, amount: number) {
    const a = Math.min(amount, p.stack);
    p.stack -= a; p.bet += a; p.committed += a;
    if (p.stack === 0) p.allIn = true;
  }

  private checkUncontested(): boolean {
    const live = this.live();
    if (live.length !== 1 || !this.isBetting()) return false;
    const w = live[0];
    const total = this.players().reduce((s, p) => s + p.committed, 0);
    w.stack += total;
    this.winners = [{ seat: w.seat, amount: total }];
    this.uncontestedSeat = w.seat;
    this.potCollected = total;
    for (const p of this.players()) p.bet = 0;
    this.endHand();
    return true;
  }

  /** Следующая улица (или вскрытие). Вызывается хостом после паузы на анимацию. */
  advance(): void {
    if (!this.pendingAdvance || !this.isBetting()) return;
    this.pendingAdvance = false;

    for (const p of this.players()) { this.potCollected += p.bet; p.bet = 0; p.acted = false; }
    this.currentBet = 0;
    this.minRaise = this.bb;

    if (this.stage === 'RIVER') { this.doShowdown(); return; }

    this.deck.pop(); // бёрн
    if (this.stage === 'PREFLOP') { this.board.push(this.deck.pop()!, this.deck.pop()!, this.deck.pop()!); this.stage = 'FLOP'; }
    else if (this.stage === 'FLOP') { this.board.push(this.deck.pop()!); this.stage = 'TURN'; }
    else if (this.stage === 'TURN') { this.board.push(this.deck.pop()!); this.stage = 'RIVER'; }

    for (const p of this.players()) if (p.lastAction && p.lastAction.type !== 'ALLIN') p.lastAction = null;

    if (this.countCanAct() <= 1) {
      // все в олл-ине — докручиваем доску без торговли
      this.activeSeat = -1;
      this.pendingAdvance = true;
      return;
    }
    this.activeSeat = this.nextSeat(this.button, p => p.inHand && !p.folded && !p.allIn);
  }

  private doShowdown() {
    const all = this.players().filter(p => p.committed > 0 || p.inHand);
    const live = this.live();
    const values = new Map(live.map(p => [p.seat, evaluateHand([...p.cards, ...this.board])]));
    this.showdown = true;

    const levels = [...new Set(live.map(p => p.committed))].sort((a, b) => a - b);
    let prev = 0;
    const payouts = new Map<number, number>();
    const pots: PotView[] = [];
    levels.forEach((lvl, i) => {
      let amount = 0;
      for (const p of all) amount += Math.min(p.committed, lvl) - Math.min(p.committed, prev);
      if (i === levels.length - 1) {
        // фишки сфолдивших сверх максимального уровня
        for (const p of all) amount += Math.max(0, p.committed - lvl);
      }
      prev = lvl;
      const eligible = live.filter(p => p.committed >= lvl);
      if (amount > 0) pots.push({ amount, seats: eligible.map(p => p.seat) });
    });

    for (const pot of pots) {
      const best = Math.max(...pot.seats.map(s => values.get(s)!.score));
      // победители по порядку от баттона (для нечётной фишки)
      const winners: number[] = [];
      for (let i = 1; i <= MAX_SEATS; i++) {
        const s = (this.button + i) % MAX_SEATS;
        if (pot.seats.includes(s) && values.get(s)!.score === best) winners.push(s);
      }
      const share = Math.floor(pot.amount / winners.length);
      let odd = pot.amount - share * winners.length;
      for (const s of winners) {
        const add = share + (odd > 0 ? 1 : 0);
        if (odd > 0) odd--;
        payouts.set(s, (payouts.get(s) || 0) + add);
      }
    }

    this.winners = [...payouts.entries()].map(([seat, amount]) => {
      this.seats[seat]!.stack += amount;
      const v = values.get(seat)!;
      return { seat, amount, handName: v.name, best: v.best };
    });
    for (const p of live) p.revealed = [true, true];
    this.endHand();
  }

  private endHand() {
    this.stage = 'HAND_OVER';
    this.activeSeat = -1;
    this.pendingAdvance = false;
    this.deadline = 0;
  }

  /** Show/Muck: победитель без вскрытия решает, что показать. */
  reveal(seat: number, which: 'NONE' | 'ONE' | 'BOTH'): boolean {
    if (this.stage !== 'HAND_OVER' || seat !== this.uncontestedSeat) return false;
    const p = this.seats[seat];
    if (!p) return false;
    if (which === 'ONE') p.revealed = [true, p.revealed[1]];
    if (which === 'BOTH') p.revealed = [true, true];
    this.uncontestedSeat = -2; // решение принято
    return true;
  }

  // ───────────── представление для клиента ─────────────

  view(viewerId: string | null): TableView {
    const me = viewerId ? this.byId(viewerId) : undefined;
    const legal = me ? this.legal(me.seat) : null;
    const seats = this.seats.map((p): SeatView | null => {
      if (!p) return null;
      const own = p === me;
      const hasCards = p.cards.length === 2 && p.inHand && !(p.folded && !own);
      return {
        seat: p.seat, id: p.id, name: p.name, stack: p.stack, bet: p.bet,
        folded: p.folded, allIn: p.allIn, inHand: p.inHand, hasCards,
        cards: p.cards.length === 2
          ? p.cards.map((c, i) => (own || p.revealed[i] ? c : null))
          : [],
        lastAction: p.lastAction, isBot: p.isBot, ring: p.ring, items: p.items,
      };
    });
    const live = this.players().reduce((s, p) => s + p.bet, 0);
    let handName: string | undefined;
    if (me && me.cards.length === 2 && me.inHand && !me.folded) {
      handName = evaluateHand([...me.cards, ...this.board]).name;
      if (this.board.length === 0) handName = me.cards[0][0] === me.cards[1][0] ? 'Карманная пара' : undefined;
    }
    return {
      tableId: this.id,
      handId: this.handId,
      stage: this.stage,
      sb: this.sb, bb: this.bb,
      button: this.button,
      board: [...this.board],
      pot: this.potCollected + (this.stage === 'HAND_OVER' ? 0 : live),
      potCollected: this.potCollected,
      seats,
      activeSeat: this.activeSeat,
      deadline: this.deadline,
      mySeat: me ? me.seat : -1,
      toCall: legal?.toCall ?? 0,
      minRaiseTo: legal?.minRaiseTo ?? 0,
      maxRaiseTo: legal?.canRaise ? legal.maxRaiseTo : 0,
      canCheck: legal?.canCheck ?? false,
      winners: this.winners,
      showdown: this.showdown,
      canReveal: !!me && this.stage === 'HAND_OVER' && this.uncontestedSeat === me.seat && !me.isBot,
      deckHash: this.deckHash,
      fair: this.stage === 'HAND_OVER' && this.fairSeed ? { seed: this.fairSeed, order: this.fairOrder! } : undefined,
      handName,
    };
  }
}
