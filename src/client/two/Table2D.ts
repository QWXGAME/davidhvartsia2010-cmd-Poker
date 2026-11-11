// 2D-стол QWX: тот же клуб, только плоский и лёгкий. Без WebGL и three.js — обычные элементы страницы,
// все движения через transform/opacity (их считает видеокарта), поэтому на телефоне идёт ровно 60–120 кадров.
// Реализует тот же интерфейс, что и 3D-мир (scene/host.ts) — интерфейс игры не знает, какой стол на экране.

import './table2d.css';
import type { TableView, SeatView } from '../../shared/Table';
import { MAX_SEATS } from '../../shared/Table';
import type { TableHost, TableFx, ScreenPos } from '../scene/host';
import { CARD_BACKS, currentBack, saveBack } from '../looks';

type Pt = { x: number; y: number };
const SUIT: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const lerp = (a: Pt, b: Pt, k: number): Pt => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';

// места вокруг стола в процентах от коробки стола: 0 — я (внизу), дальше по часовой
const SEATS_WIDE: Pt[] = [{ x: 50, y: 104 }, { x: 6, y: 78 }, { x: 8, y: 18 }, { x: 50, y: -1 }, { x: 92, y: 18 }, { x: 94, y: 78 }];
const SEATS_TALL: Pt[] = [{ x: 50, y: 103 }, { x: 8, y: 70 }, { x: 8, y: 28 }, { x: 50, y: 1 }, { x: 92, y: 28 }, { x: 92, y: 70 }];
const CENTER: Pt = { x: 50, y: 50 };

const CHIP_COLORS: [number, string][] = [[5000, 'gold'], [1000, 'violet'], [500, 'blue'], [100, 'black'], [25, 'green'], [5, 'red'], [1, 'white']];

/** разложить сумму на фишки (до max штук), крупные — снизу */
function breakdown(amount: number, max = 9): string[] {
  const out: string[] = [];
  let left = Math.max(0, Math.round(amount));
  for (const [v, c] of CHIP_COLORS) {
    while (left >= v && out.length < max) { out.push(c); left -= v; }
  }
  if (!out.length && amount > 0) out.push('white');
  return out;
}

function cardFace(code: string) {
  const r = code[0] === 'T' ? '10' : code[0];
  const s = SUIT[code[1]];
  const red = code[1] === 'h' || code[1] === 'd';
  const court = 'JQK'.includes(code[0]);
  return `<div class="f${red ? ' red' : ''}${court ? ' court' : ''}">
    <span class="ix tl"><b>${r}</b><i>${s}</i></span>
    <span class="pip">${court ? `<em>${r}</em>` : ''}${s}</span>
    <span class="ix br"><b>${r}</b><i>${s}</i></span></div>`;
}

interface Card2 { el: HTMLElement; code: string | null; up: boolean }

export class Table2D implements TableHost {
  readonly kind = '2d' as const;
  squeezeMode = false;
  onPlate?: (i: number) => void;

  private root = document.createElement('div');
  private table = document.createElement('div');
  private layer = document.createElement('div');     // карты и фишки
  private seatsEl: HTMLElement[] = [];
  private dealerBtn = document.createElement('div');
  private potEl = document.createElement('div');
  private betEls: HTMLElement[] = [];
  private hole = new Map<number, Card2[]>();        // по номеру места (серверному)
  private board: Card2[] = [];
  private prev: TableView | null = null;
  private pending: TableView | null = null;
  private running = false;
  private mySeat = -1;
  private rect = { x: 0, y: 0, w: 1, h: 1 };
  private tall = false;
  private frameCbs: (() => void)[] = [];
  private highlighted = new Set<string>();
  private paidHand = -1;
  private glowHand = -1;

  readonly plates = {
    visible: false,
    set: () => { /* в 2D кнопки действий — обычные кнопки интерфейса */ },
    setLive: () => { /* */ },
    press: () => { /* */ },
    topY: () => null as number | null,
  };

  constructor(host: HTMLElement, private fx: TableFx, opts: { felt: string }) {
    this.root.className = 't2d';
    this.table.className = 't2d-table';
    this.table.innerHTML = `
      <div class="t2-rail"><i class="lac"></i></div>
      <div class="t2-felt"><i class="weave"></i><i class="glow"></i><i class="line"></i><div class="crest"><span>♠</span><b>QWX</b><em>· CLUB ·</em></div></div>`;
    this.layer.className = 't2d-layer';
    this.dealerBtn.className = 't2d-dealer hidden';
    this.dealerBtn.textContent = 'D';
    this.potEl.className = 't2d-pot';
    this.table.append(this.layer);
    this.layer.append(this.potEl, this.dealerBtn);
    for (let i = 0; i < MAX_SEATS; i++) {
      const s = document.createElement('div');
      s.className = 't2d-seat empty';
      s.innerHTML = '<div class="ava"><span></span></div><div class="nm"><b></b><i></i></div>';
      this.seatsEl.push(s);
      const b = document.createElement('div');
      b.className = 't2d-bet';
      this.betEls.push(b);
      this.layer.append(b);
    }
    this.table.append(...this.seatsEl);
    this.root.append(this.table);
    host.replaceWith(this.root);
    this.setFelt(opts.felt);
    this.setBack(currentBack());
    addEventListener('resize', () => this.relayout());
    this.relayout();
    const loop = () => { for (const f of this.frameCbs) f(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // ───────────────────────── геометрия ─────────────────────────

  private relayout() {
    const W = innerWidth, H = innerHeight;
    this.tall = W / H < 1.05;
    this.root.classList.toggle('tall', this.tall);
    const r = this.table.getBoundingClientRect();
    this.rect = { x: r.left, y: r.top, w: r.width, h: r.height };
    const seats = this.tall ? SEATS_TALL : SEATS_WIDE;
    for (let v = 0; v < MAX_SEATS; v++) {
      const el = this.seatsEl[this.seatOf(v)];
      el.style.left = seats[v].x + '%';
      el.style.top = seats[v].y + '%';
    }
    // карты и фишки — без анимации на новые места
    for (const [seat, cs] of this.hole) cs.forEach((c, i) => this.place(c.el, this.holeAt(seat, i), false));
    this.board.forEach((c, i) => this.place(c.el, this.boardAt(i), false));
    for (let s = 0; s < MAX_SEATS; s++) this.placeBet(s);
    const pot = this.pct(this.potAt());
    this.potEl.style.transform = `translate(${pot.x}px, ${pot.y}px)`;
    if (this.prev) this.placeDealer(this.prev.button, false);
  }

  /** визуальная позиция (0 — низ) → номер места на сервере и обратно */
  private vis(seat: number) { return this.mySeat >= 0 ? (seat - this.mySeat + MAX_SEATS) % MAX_SEATS : seat; }
  private seatOf(v: number) { return this.mySeat >= 0 ? (v + this.mySeat) % MAX_SEATS : v; }
  private seatPt(seat: number): Pt { return (this.tall ? SEATS_TALL : SEATS_WIDE)[this.vis(seat)]; }
  private pct(p: Pt): Pt { return { x: (p.x / 100) * this.rect.w, y: (p.y / 100) * this.rect.h }; }
  private cw() { return this.tall ? Math.min(64, this.rect.w * 0.15) : Math.min(86, Math.max(48, this.rect.w * 0.085)); }

  private boardAt(i: number) {
    const cw = this.cw();
    const c = this.pct({ x: 50, y: this.tall ? 47 : 50 });
    return { x: c.x + (i - 2) * cw * 1.1, y: c.y, rot: 0, s: 1 };
  }
  private potAt(): Pt { return { x: 50, y: this.tall ? 32 : 26 }; }
  private holeAt(seat: number, i: number) {
    const cw = this.cw();
    if (seat === this.mySeat) {
      const p = this.pct({ x: 50, y: this.tall ? 82 : 84 });
      return { x: p.x + (i ? 0.36 : -0.36) * cw * 1.3, y: p.y, rot: i ? 7 : -7, s: 1.3 };
    }
    const sp = this.seatPt(seat);
    const v = this.vis(seat);
    // боковые места — карты рядом с печаткой, ближе к центру и чуть выше, чтобы не закрывать имя
    const k = this.tall ? 0.3 : 0.24;
    const p = this.pct(v === 3 ? lerp(sp, CENTER, k) : { x: sp.x + (CENTER.x - sp.x) * (this.tall ? 0.42 : 0.2), y: sp.y - (this.tall ? 6 : 4) });
    return { x: p.x + (i ? 0.22 : -0.22) * cw * 0.62, y: p.y, rot: i ? 9 : -6, s: 0.62 };
  }
  private betAt(seat: number): Pt {
    if (seat === this.mySeat) return { x: 50, y: this.tall ? 67 : 70 };
    return lerp(this.seatPt(seat), CENTER, this.tall ? 0.44 : 0.4);
  }
  private deckAt() { return { ...this.pct({ x: 50, y: this.tall ? 47 : 50 }), rot: 0, s: 1 }; }

  private place(el: HTMLElement, p: { x: number; y: number; rot: number; s: number }, animate = true, dur = 420, delay = 0) {
    const to = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) rotate(${p.rot}deg) scale(${p.s})`;
    if (animate) {
      const from = el.style.transform || to;
      el.animate([{ transform: from }, { transform: to }], { duration: dur, delay, easing: EASE_OUT, fill: 'backwards' });
    }
    el.style.transform = to;
  }

  // ───────────────────────── карты ─────────────────────────

  private makeCard(code: string | null, up = false): Card2 {
    const el = document.createElement('div');
    el.className = 't2card' + (up ? ' up' : '');
    el.style.setProperty('--cw', this.cw() + 'px');
    el.innerHTML = `<div class="t2ci"><div class="face">${code ? cardFace(code) : ''}</div><div class="back"></div></div>`;
    this.layer.append(el);
    return { el, code, up };
  }

  private flip(c: Card2, code: string | null, up: boolean, delay = 0) {
    if (code && c.code !== code) {
      c.code = code;
      (c.el.querySelector('.face') as HTMLElement).innerHTML = cardFace(code);
    }
    if (c.up === up) return;
    c.up = up;
    setTimeout(() => { c.el.classList.toggle('up', up); if (up) this.fx.flip(); }, delay);
  }

  /** карта летит из колоды на место и (если видна) переворачивается */
  private dealTo(c: Card2, to: { x: number; y: number; rot: number; s: number }, delay: number, faceUp: boolean) {
    const d = this.deckAt();
    c.el.style.opacity = '0';
    c.el.style.transform = `translate(${d.x}px, ${d.y}px) translate(-50%, -50%) rotate(${(Math.random() - 0.5) * 30}deg) scale(.7)`;
    setTimeout(() => {
      c.el.style.opacity = '1';
      this.place(c.el, to, true, 480);
      this.fx.deal();
      if (faceUp) setTimeout(() => this.flip(c, c.code, true), 380);
    }, delay);
  }

  /** сброс: карта рубашкой вверх отлетает в центр и тает */
  private muck(c: Card2, delay = 0) {
    setTimeout(() => {
      c.el.classList.remove('up', 'hl', 'win');
      const d = this.deckAt();
      const spin = (Math.random() - 0.5) * 220;
      c.el.animate([
        { transform: c.el.style.transform, opacity: 1 },
        { transform: `translate(${d.x}px, ${d.y - 30}px) translate(-50%, -50%) rotate(${spin}deg) scale(.55)`, opacity: 0 },
      ], { duration: 520, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' }).onfinish = () => c.el.remove();
    }, delay);
  }

  private clearCards(fast = false) {
    for (const cs of this.hole.values()) for (const c of cs) fast ? c.el.remove() : this.muck(c);
    for (const c of this.board) fast ? c.el.remove() : this.muck(c);
    this.hole.clear();
    this.board = [];
    this.highlighted.clear();
  }

  /** короткая тасовка колоды в центре стола */
  private async shuffle() {
    const d = this.deckAt();
    const pile: HTMLElement[] = [];
    for (let i = 0; i < 8; i++) {
      const c = this.makeCard(null);
      c.el.classList.add('deck');
      c.el.style.transform = `translate(${d.x}px, ${d.y - i * 0.6}px) translate(-50%, -50%)`;
      pile.push(c.el);
    }
    this.fx.shuffle?.();
    const cw = this.cw();
    pile.forEach((el, i) => {
      const side = i % 2 ? 1 : -1;
      el.animate([
        { transform: `translate(${d.x}px, ${d.y - i * 0.6}px) translate(-50%, -50%)` },
        { transform: `translate(${d.x + side * cw * 0.55}px, ${d.y - 6}px) translate(-50%, -50%) rotate(${side * 8}deg)`, offset: 0.4 },
        { transform: `translate(${d.x}px, ${d.y - i * 0.6}px) translate(-50%, -50%)` },
      ], { duration: 620, delay: i * 18, easing: EASE });
    });
    await wait(720);
    pile.forEach(el => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).onfinish = () => el.remove());
  }

  // ───────────────────────── фишки ─────────────────────────

  private chipStack(amount: number, max = 9) {
    const cols = breakdown(amount, max);
    // до трёх столбиков по цвету — как у живых игроков
    const groups: string[][] = [];
    for (const c of cols) { const g = groups.find(x => x[0] === c && x.length < 5); if (g) g.push(c); else if (groups.length < 3) groups.push([c]); else groups[groups.length - 1].push(c); }
    return `<div class="chips">${groups.map(g => `<div class="col">${g.map((c, i) => `<i class="ch ${c}" style="--i:${i}"></i>`).join('')}</div>`).join('')}</div>`;
  }

  private placeBet(seat: number) {
    const el = this.betEls[seat];
    const p = this.pct(this.betAt(seat));
    el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
  }

  private setBet(seat: number, amount: number, animateFrom?: Pt) {
    const el = this.betEls[seat];
    if (amount <= 0) { el.classList.remove('on'); return; }
    el.innerHTML = `${this.chipStack(amount, 7)}<b>${amount.toLocaleString('ru-RU')}</b>`;
    el.classList.add('on');
    if (animateFrom) this.flyChips(this.pct(animateFrom), this.pct(this.betAt(seat)), amount, 3, 0, false);
  }

  /** фишки летят дугой из точки в точку (ставка, сбор в банк, выигрыш) */
  private flyChips(a: Pt, b: Pt, amount: number, n: number, delay = 0, high = true) {
    const cols = breakdown(amount, n);
    cols.forEach((c, i) => {
      const el = document.createElement('i');
      el.className = `ch fly ${c}`;
      this.layer.append(el);
      const lift = high ? 60 + Math.hypot(b.x - a.x, b.y - a.y) * 0.25 : 18;
      const mid = { x: (a.x + b.x) / 2 + (Math.random() - 0.5) * 20, y: Math.min(a.y, b.y) - lift };
      const jx = (Math.random() - 0.5) * 10, jy = (Math.random() - 0.5) * 6;
      el.animate([
        { transform: `translate(${a.x}px, ${a.y}px) translate(-50%, -50%) scale(.9)`, opacity: 0 },
        { transform: `translate(${mid.x}px, ${mid.y}px) translate(-50%, -50%) scale(1.15) rotate(180deg)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${b.x + jx}px, ${b.y + jy}px) translate(-50%, -50%) scale(1) rotate(360deg)`, opacity: 1 },
      ], { duration: high ? 820 : 380, delay: delay + i * (high ? 55 : 30), easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' })
        .onfinish = () => { el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).onfinish = () => el.remove(); };
    });
  }

  private setPot(amount: number) {
    this.potEl.innerHTML = amount > 0 ? this.chipStack(amount, 12) : '';
    this.potEl.classList.toggle('on', amount > 0);
  }

  private placeDealer(button: number, animate = true) {
    if (button < 0 || !this.prev?.seats[button]) { this.dealerBtn.classList.add('hidden'); return; }
    this.dealerBtn.classList.remove('hidden');
    const sp = this.seatPt(button);
    const p = this.pct(button === this.mySeat ? { x: 64, y: this.tall ? 86 : 88 } : lerp(sp, CENTER, this.tall ? 0.16 : 0.13));
    const to = `translate(${p.x + 26}px, ${p.y}px) translate(-50%, -50%)`;
    if (animate && this.dealerBtn.style.transform && this.dealerBtn.style.transform !== to) {
      this.dealerBtn.animate([{ transform: this.dealerBtn.style.transform }, { transform: to }], { duration: 700, easing: EASE_OUT });
    }
    this.dealerBtn.style.transform = to;
  }

  // ───────────────────────── места ─────────────────────────

  private renderSeats(v: TableView) {
    for (let s = 0; s < MAX_SEATS; s++) {
      const seat = v.seats[s];
      const el = this.seatsEl[s];
      const show = !!seat && s !== v.mySeat;
      el.classList.toggle('empty', !show);
      if (!seat || !show) continue;
      const span = el.querySelector('.ava span') as HTMLElement;
      const nm = el.querySelector('.nm b') as HTMLElement, st = el.querySelector('.nm i') as HTMLElement;
      if (nm.textContent !== seat.name) nm.textContent = seat.name;
      const stack = seat.allIn ? 'олл-ин' : seat.stack.toLocaleString('ru-RU');
      if (st.textContent !== stack) st.textContent = stack;
      const ini = (seat.name || '?').trim()[0]?.toUpperCase() || '?';
      if (span.textContent !== ini) span.textContent = ini;
      el.classList.toggle('bot', seat.isBot);
      el.classList.toggle('folded', seat.folded || !seat.inHand);
      el.classList.toggle('active', v.activeSeat === s && v.stage !== 'HAND_OVER');
      el.classList.toggle('allin', seat.allIn);
    }
  }

  // ───────────────────────── применение снимка стола ─────────────────────────

  apply(v: TableView) {
    this.pending = v;
    if (!this.running) this.run();
  }

  private async run() {
    this.running = true;
    while (this.pending) {
      const v = this.pending;
      this.pending = null;
      try { await this.step(v); } catch (e) { console.error(e); }
    }
    this.running = false;
  }

  private async step(v: TableView) {
    const p = this.prev;
    if (this.mySeat !== v.mySeat) { this.mySeat = v.mySeat; this.prev = v; this.relayout(); }
    this.renderSeats(v);

    // новая раздача: убрать старое, перетасовать и раздать
    const newHand = !p || p.handId !== v.handId;
    if (newHand) {
      this.clearCards(!p);
      for (let s = 0; s < MAX_SEATS; s++) this.setBet(s, 0);
      this.setPot(0);
      this.prev = v;
      this.placeDealer(v.button);
      const dealt = v.seats.filter((s): s is SeatView => !!s && s.hasCards);
      if (v.stage !== 'WAITING' && dealt.length) {
        if (p) { await wait(260); await this.shuffle(); }
        // раздача по кругу от дилера, по одной карте
        const order: SeatView[] = [];
        for (let k = 1; k <= MAX_SEATS; k++) { const s = v.seats[(v.button + k) % MAX_SEATS]; if (s?.hasCards) order.push(s); }
        let d = 0;
        for (let round = 0; round < 2; round++) {
          for (const s of order) {
            const code = s.cards[round] ?? null;
            const c = this.makeCard(code);
            const arr = this.hole.get(s.seat) || [];
            arr[round] = c;
            this.hole.set(s.seat, arr);
            const mine = s.seat === v.mySeat;
            this.dealTo(c, this.holeAt(s.seat, round), d, mine && !!code);
            d += p ? 110 : 0;
          }
        }
        if (p) await wait(d + 420);
      }
    }
    const prev = newHand ? null : p;

    // ставки
    for (let s = 0; s < MAX_SEATS; s++) {
      const seat = v.seats[s];
      const bet = seat?.bet ?? 0;
      const before = prev?.seats[s]?.bet ?? 0;
      if (bet !== before || newHand) {
        if (bet > before && prev) {
          this.setBet(s, bet, s === v.mySeat ? { x: 50, y: 92 } : this.seatPt(s));
          this.fx.chips(Math.min(6, breakdown(bet - before, 6).length));
        } else this.setBet(s, bet);
      }
      // действие без фишек: чек и фолд
      const la = seat?.lastAction, pla = prev?.seats[s]?.lastAction;
      if (prev && la && (!pla || la.type !== pla.type || la.amount !== pla.amount)) {
        if (la.type === 'CHECK') this.fx.check();
        if (la.type === 'FOLD') this.fx.fold();
        if (la.type === 'ALLIN') this.allIn(s);
      }
    }

    // ставки улицы ушли в банк
    if (prev && v.potCollected > prev.potCollected) {
      for (let s = 0; s < MAX_SEATS; s++) {
        const was = prev.seats[s]?.bet ?? 0;
        if (was > 0 && (v.seats[s]?.bet ?? 0) === 0) this.flyChips(this.pct(this.betAt(s)), this.pct(this.potAt()), was, 3, s * 30, false);
      }
      this.fx.collect();
      await wait(320);
    }
    this.setPot(v.stage === 'HAND_OVER' && this.paidHand === v.handId ? 0 : v.potCollected);

    // фолды: карты сбрасываются
    for (const [seat, cs] of this.hole) {
      const s = v.seats[seat];
      if (!s || s.folded || !s.hasCards) {
        if (cs.length) { cs.forEach((c, i) => this.muck(c, i * 60)); this.hole.set(seat, []); }
      }
    }

    // мои карты и вскрытие соперников
    for (let s = 0; s < MAX_SEATS; s++) {
      const seat = v.seats[s];
      const cs = this.hole.get(s);
      if (!seat || !cs?.length) continue;
      seat.cards.forEach((code, i) => {
        const c = cs[i];
        if (c && code) this.flip(c, code, true, s === v.mySeat ? 0 : 150 + i * 120);
      });
      // на шоудауне карты соперников чуть приподнимаются к центру
      if (s !== v.mySeat && seat.cards.some(Boolean)) cs.forEach((c, i) => {
        if (!c.el.classList.contains('shown')) { c.el.classList.add('shown'); const at = this.holeAt(s, i); this.place(c.el, { ...at, s: 0.78, rot: i ? 4 : -4 }, true, 500, 150 + i * 120); }
      });
    }
    // мой ход — карты чуть приподняты
    const mine = this.hole.get(v.mySeat);
    mine?.forEach(c => c.el.classList.toggle('turn', v.activeSeat === v.mySeat && v.stage !== 'HAND_OVER'));

    // общие карты
    if (v.board.length > this.board.length) {
      const from = this.board.length;
      for (let i = from; i < v.board.length; i++) {
        const c = this.makeCard(v.board[i]);
        this.board.push(c);
        this.dealTo(c, this.boardAt(i), (i - from) * 140, true);
      }
      await wait((v.board.length - from) * 140 + 640);
    }

    // итог раздачи: банк едет к победителю, сильные комбинации светятся
    if (v.stage === 'HAND_OVER' && v.winners.length && this.paidHand !== v.handId) {
      this.paidHand = v.handId;
      await wait(v.showdown ? 700 : 200);
      const potPt = this.pct(this.potAt());
      for (const w of v.winners) {
        const to = w.seat === v.mySeat ? this.pct({ x: 50, y: 100 }) : this.pct(this.seatPt(w.seat));
        this.flyChips(potPt, to, w.amount, 10, 0, true);
      }
      for (let s = 0; s < MAX_SEATS; s++) this.setBet(s, 0);
      this.setPot(0);
      const mineWon = v.winners.some(w => w.seat === v.mySeat);
      setTimeout(() => this.fx.win(mineWon), 600);
      for (const w of v.winners) { const el = this.seatsEl[w.seat]; el.classList.add('won'); setTimeout(() => el.classList.remove('won'), 2600); }
      this.markWinners(v);
    }
    if (v.stage !== 'HAND_OVER') this.markWinners(null);

    this.placeDealer(v.button);
    this.prev = v;
  }

  private allIn(seat: number) {
    this.fx.allin?.();
    this.root.classList.remove('allin');
    void this.root.offsetWidth;
    this.root.classList.add('allin');
    const el = this.seatsEl[seat];
    el.classList.add('allin-pop');
    setTimeout(() => { this.root.classList.remove('allin'); el.classList.remove('allin-pop'); }, 2000);
  }

  private markWinners(v: TableView | null) {
    const best = new Set(v ? v.winners.flatMap(w => w.best || []) : []);
    const STRONG = ['Стрит', 'Флеш', 'Фулл-хаус', 'Каре', 'Роял'];
    const strong = !!v && v.winners.some(w => STRONG.some(n => (w.handName || '').startsWith(n)));
    const all = [...this.board, ...[...this.hole.values()].flat()];
    for (const c of all) {
      const on = !!c.code && best.has(c.code);
      c.el.classList.toggle('win', on);
      c.el.classList.toggle('strong', on && strong);
      c.el.classList.toggle('dim', !!v && best.size > 0 && !on && c.up);
    }
    if (v && strong && this.glowHand !== v.handId) this.glowHand = v.handId;
  }

  // ───────────────────────── интерфейс стола ─────────────────────────

  clear() {
    this.pending = null;
    this.clearCards(true);
    for (let s = 0; s < MAX_SEATS; s++) { this.setBet(s, 0); this.seatsEl[s].classList.add('empty'); }
    this.setPot(0);
    this.dealerBtn.classList.add('hidden');
    this.prev = null;
    this.mySeat = -1;
    this.relayout();
  }

  highlightCodes(codes: string[]) {
    const set = new Set(codes);
    for (const c of [...this.board, ...(this.hole.get(this.mySeat) || [])]) c.el.classList.toggle('hl', !!c.code && set.has(c.code) && c.up);
  }

  setFelt(color: string) { this.root.style.setProperty('--felt', color); }

  setBack(style: string) {
    const b = CARD_BACKS[style] || CARD_BACKS.navy;
    saveBack(style);
    this.root.style.setProperty('--back', b.bg);
    this.root.style.setProperty('--back-line', b.line);
    this.root.style.setProperty('--back-frame', b.frame);
  }

  itemThumb() { return ''; }

  seatScreen(seat: number, out: ScreenPos) {
    const el = this.seatsEl[seat];
    const p = this.pct(this.seatPt(seat));
    // над аватаром
    out.x = this.rect.x + p.x;
    out.y = this.rect.y + p.y - (el.offsetHeight || 52) / 2 - 2;
    out.visible = true;
  }

  boardScreen(out: ScreenPos) {
    const p = this.pct(this.potAt());
    out.x = this.rect.x + p.x;
    out.y = this.rect.y + p.y - 6;
    out.visible = true;
  }

  onFrame(cb: () => void) { this.frameCbs.push(cb); }
  onLowPower() { /* 2D всегда лёгкий */ }
  setOrbit(v: boolean) { this.root.classList.toggle('lobby', v); }
  intro() {
    this.root.classList.remove('intro');
    void this.root.offsetWidth;
    this.root.classList.add('intro');
  }
  glanceOnTurn() {
    const mine = this.hole.get(this.mySeat);
    mine?.forEach((c, i) => c.el.animate([{ translate: '0 0' }, { translate: '0 -10px' }, { translate: '0 0' }], { duration: 520, delay: i * 70, easing: EASE }));
  }
}
