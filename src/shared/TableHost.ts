// Хост стола: таймеры, ходы ботов, автодействия по таймауту, паузы под анимации.
// Работает одинаково на сервере (мультиплеер) и в браузере (офлайн-игра с ботами).

import { CardCode, IntRng } from './Cards';
import { BOT_ROSTER, decayTilt, decide, thinkDelay, triggerTilt } from './Bots';
import { ActionType, MAX_SEATS, Table, TableView, SeatStats } from './Table';

export interface HandResult {
  handId: number;
  /** id → чистый результат раздачи (выигрыш минус вложенное) */
  deltas: Map<string, number>;
  humans: string[];
  potTotal: number;
}

export interface HostOptions {
  id: string;
  sb: number;
  bb: number;
  rng: IntRng;
  owner?: string;            // создатель стола — он зовёт друзей, сажает ботов и даёт старт
  isPrivate?: boolean;
  invite?: string;
  turnMs?: number;
  fair?: (deck: CardCode[]) => { hash: string; seed: string };
  onHandEnd?: (r: HandResult) => void;
  onCashout?: (id: string, amount: number) => void;
  /** турнир: боты не докупаются, фишки не возвращаются на баланс, выбывшие встают из-за стола */
  tourney?: boolean;
  /** перед каждой раздачей (турнир: блайнды, пересадка) */
  beforeHand?: () => void;
  /** данные турнира для экрана игрока */
  tourneyInfo?: () => TableView['tourney'];
}

interface Raw { hands: number; vpip: number; pfr: number; aggr: number; calls: number; won: number; lastHand: number; vp: boolean; pr: boolean }

type Listener = (v: TableView) => void;

export class TableHost {
  readonly table: Table;
  private listeners = new Map<string, Set<Listener>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private handledHand = -1;
  private turnMs: number;
  /** игра идёт только после старта хозяином стола */
  started = false;
  owner: string;
  /** статистика игроков за этим столом (сбрасывается, когда стол закрывается) */
  private stats = new Map<string, Raw>();

  constructor(private o: HostOptions) {
    this.table = new Table(o.id, o.sb, o.bb, o.rng);
    this.turnMs = o.turnMs ?? 25000;
    this.owner = o.owner || '';
  }

  /** Посадить бота на свободное место (по желанию хозяина). */
  addBot(): boolean {
    const used = new Set(this.table.players().map(p => p.id));
    const i = BOT_ROSTER.findIndex((_, k) => !used.has(`bot-${k}`));
    const seat = this.table.freeSeat();
    if (i < 0 || seat < 0) return false;
    const b = BOT_ROSTER[i];
    this.table.sit({
      id: `bot-${i}`, name: b.name, seat, stack: this.table.bb * 100,
      isBot: true, personality: b.personality, ring: i === 0 ? 'RING_ONYX' : i === 1 ? 'RING_RUBY' : 'RING_GOLD',
    });
    this.kick();
    return true;
  }

  removeBot(): boolean {
    const bots = this.table.players().filter(p => p.isBot);
    const bot = bots.find(p => !p.inHand || this.table.stage === 'HAND_OVER' || this.table.stage === 'WAITING') || bots[bots.length - 1];
    if (!bot) return false;
    this.table.leave(bot.id);
    this.kick();
    return true;
  }

  start(): boolean {
    if (this.table.players().length < 2) return false;
    this.started = true;
    this.kick();
    return true;
  }

  lobby() {
    return {
      id: this.table.id, owner: this.owner, started: this.started, isPrivate: !!this.o.isPrivate, invite: this.o.invite,
      players: this.table.players().map(p => ({ id: p.id, name: p.name, isBot: p.isBot, seat: p.seat })),
    };
  }

  get humans(): number { return this.table.players().filter(p => !p.isBot).length; }

  subscribe(viewerId: string, cb: Listener): () => void {
    if (!this.listeners.has(viewerId)) this.listeners.set(viewerId, new Set());
    this.listeners.get(viewerId)!.add(cb);
    cb(this.viewFor(viewerId));
    return () => this.listeners.get(viewerId)?.delete(cb);
  }

  private viewFor(id: string): TableView {
    const v = this.table.view(id);
    v.lobby = this.lobby();
    for (const s of v.seats) if (s) s.stats = this.statsOf(s.id);
    if (this.o.tourneyInfo) v.tourney = this.o.tourneyInfo();
    return v;
  }

  statsOf(id: string): SeatStats {
    const r = this.stats.get(id);
    if (!r || !r.hands) return { hands: 0, vpip: 0, pfr: 0, af: 0, won: 0 };
    return { hands: r.hands, vpip: Math.round((r.vpip / r.hands) * 100), pfr: Math.round((r.pfr / r.hands) * 100), af: r.calls ? Math.round((r.aggr / r.calls) * 10) / 10 : r.aggr, won: r.won };
  }

  /** учёт действия для статистики: VPIP — добровольно вложил префлоп, PFR — рейз префлоп, AF — (ставки+рейзы)/коллы */
  private track(seat: number, type: ActionType) {
    const t = this.table;
    const p = t.seats[seat];
    if (!p) return;
    const r = this.stats.get(p.id);
    if (!r || r.lastHand !== t.handId) return;
    const pre = t.stage === 'PREFLOP';
    if (type === 'CALL' || type === 'RAISE' || type === 'ALLIN') { if (pre && !r.vp) { r.vp = true; r.vpip++; } }
    if ((type === 'RAISE' || type === 'ALLIN') && pre && !r.pr) { r.pr = true; r.pfr++; }
    if (!pre) { if (type === 'RAISE' || type === 'ALLIN') r.aggr++; else if (type === 'CALL') r.calls++; }
  }

  private emit() {
    for (const [id, set] of this.listeners) {
      const v = this.viewFor(id);
      for (const cb of set) cb(v);
    }
  }

  /** Посадить игрока. Предпочтительно место 0 — «ближнее» к камере у каждого своё, клиент поворачивает стол. */
  join(id: string, name: string, stack: number, ring?: string, items?: string[]): number {
    const existing = this.table.byId(id);
    if (existing) { existing.leaving = false; this.kick(); return existing.seat; }
    let seat = this.table.freeSeat(0);
    if (seat === -1) {
      // друг важнее бота: освобождаем место
      const bot = this.table.players().find(p => p.isBot && !p.inHand) || this.table.players().find(p => p.isBot);
      if (!bot) return -1;
      this.table.leave(bot.id);
      if (this.table.byId(bot.id)) return -1;
      seat = bot.seat;
    }
    if (!this.owner) this.owner = id;
    this.table.sit({ id, name, seat, stack, isBot: false, ring, items });
    this.kick();
    return seat;
  }

  leave(id: string): void {
    const res = this.table.leave(id);
    if (res !== null) this.o.onCashout?.(id, res);
    this.listeners.delete(id);
    if (this.owner === id) this.owner = this.table.players().find(p => !p.isBot && p.id !== id)?.id || '';
    this.kick();
  }

  rebuy(id: string, amount: number): boolean {
    const p = this.table.byId(id);
    if (!p || p.stack > 0 || p.inHand && this.table.isBetting()) return false;
    p.stack = amount;
    this.kick();
    return true;
  }

  action(id: string, type: ActionType, amount = 0): boolean {
    const p = this.table.byId(id);
    if (!p || p.seat !== this.table.activeSeat) return false;
    const stage = this.table.stage;
    const ok = this.table.act(p.seat, type, amount);
    if (ok) { this.trackAfter(p.seat, type, stage); this.kick(); }
    return ok;
  }

  reveal(id: string, which: 'NONE' | 'ONE' | 'BOTH'): void {
    const p = this.table.byId(id);
    if (p && this.table.reveal(p.seat, which)) this.kick(1800);
  }

  /** обновить предметы игрока на столе — все за столом увидят сразу */
  setItems(id: string, items: string[]) {
    const p = this.table.byId(id);
    if (p) { p.items = [...items]; this.emit(); }
  }

  /** статистика считается по улице, на которой было действие (после хода улица могла смениться) */
  private trackAfter(seat: number, type: ActionType, stage: string) {
    const t = this.table;
    const cur = t.stage;
    (t as unknown as { stage: string }).stage = stage;
    this.track(seat, type);
    (t as unknown as { stage: string }).stage = cur;
  }

  /** Сообщить подписчикам и запланировать следующий шаг. */
  kick(handOverDelay?: number) {
    this.emit();
    this.schedule(handOverDelay);
  }

  private later(ms: number, fn: () => void) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; fn(); }, ms);
  }

  private schedule(handOverDelay?: number) {
    const t = this.table;

    if (t.stage === 'WAITING') {
      if (this.started && (this.humans > 0 || this.o.tourney) && t.canStart()) this.later(1200, () => this.startHand());
      else if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      return;
    }

    if (t.stage === 'HAND_OVER') {
      this.finishHand();
      const humanCanReveal = t.uncontestedSeat >= 0 && !t.seats[t.uncontestedSeat]?.isBot;
      const delay = handOverDelay ?? (t.showdown ? 6000 : humanCanReveal ? 6500 : 3800);
      this.later(delay, () => this.startHand());
      return;
    }

    if (t.pendingAdvance) {
      // олл-ин: даём время на драму — медленный ривер, наезд камеры, сердцебиение
      const ms = t.runout
        ? (t.stage === 'PREFLOP' ? 1600 : t.stage === 'FLOP' ? 2200 : t.stage === 'TURN' ? 4200 : 2600)
        : (t.stage === 'PREFLOP' ? 1000 : t.stage === 'RIVER' ? 1200 : 1300);
      this.later(ms, () => { t.advance(); this.kick(); });
      return;
    }

    const seat = t.activeSeat;
    if (seat < 0) return;
    const p = t.seats[seat]!;
    if (p.isBot) {
      t.deadline = 0;
      const hard = (t.legal(seat)?.toCall ?? 0) > t.bb * 3;
      this.later(thinkDelay(p.personality || 'TOURIST', hard), () => {
        if (t.activeSeat !== seat || t.seats[seat] !== p) return;
        const d = decide(t, seat);
        const stage = t.stage;
        if (t.act(seat, d.type, d.amount)) this.trackAfter(seat, d.type, stage);
        this.kick();
      });
    } else {
      t.deadline = Date.now() + this.turnMs;
      this.emit();
      this.later(this.turnMs, () => {
        if (t.activeSeat !== seat) return;
        t.act(seat, 'FOLD'); // фолд превращается в чек, если ставки нет
        this.kick();
      });
    }
  }

  private startHand() {
    const t = this.table;
    this.o.beforeHand?.();
    // боты, проигравшие стек, «докупаются» — стол не пустеет (в турнире — нет)
    if (!this.o.tourney) for (const p of t.players()) if (p.isBot && p.stack < t.bb * 10) p.stack = t.bb * 100;
    if (this.humans === 0 && !this.o.tourney) { t.stage = 'WAITING'; this.emit(); return; }
    if (!t.canStart()) { t.stage = 'WAITING'; this.emit(); return; }
    t.startHand(this.o.fair);
    // статистика: новая рука у всех, кому раздали карты
    for (const p of t.players()) {
      if (!p.inHand) continue;
      const r = this.stats.get(p.id) || { hands: 0, vpip: 0, pfr: 0, aggr: 0, calls: 0, won: 0, lastHand: -1, vp: false, pr: false };
      r.hands++; r.lastHand = t.handId; r.vp = false; r.pr = false;
      this.stats.set(p.id, r);
    }
    this.kick();
  }

  private finishHand() {
    const t = this.table;
    if (this.handledHand === t.handId) return;
    this.handledHand = t.handId;

    const deltas = new Map<string, number>();
    const humans: string[] = [];
    let potTotal = 0;
    for (const p of t.players()) {
      if (!p.inHand && p.committed === 0) continue;
      const won = t.winners.filter(w => w.seat === p.seat).reduce((s, w) => s + w.amount, 0);
      deltas.set(p.id, won - p.committed);
      if (won > p.committed) { const r = this.stats.get(p.id); if (r) r.won++; }
      potTotal += p.committed;
      if (!p.isBot) humans.push(p.id);
    }
    // тильт: бот проиграл банк ≥ 40 BB
    for (const p of t.players()) {
      if (!p.isBot) continue;
      decayTilt(p.id);
      if ((deltas.get(p.id) ?? 0) <= -t.bb * 40) triggerTilt(p.id);
    }
    for (const [id, amount] of t.removeLeavers()) this.o.onCashout?.(id, amount);
    this.o.onHandEnd?.({ handId: t.handId, deltas, humans, potTotal });
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.listeners.clear();
  }

  static readonly MAX_SEATS = MAX_SEATS;
}
