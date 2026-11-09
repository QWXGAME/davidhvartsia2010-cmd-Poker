// Мир игры: собирает сцену и превращает изменения состояния стола в анимации.
// Каждый новый TableView сравнивается с предыдущим — раздача, ставки, улицы, вскрытие, выплата.

import * as THREE from 'three';
import { DayCycle } from './daycycle';
import type { TableView, SeatView } from '../../shared/Table';
import { Stage } from './Stage';
import { Room } from './Room';
import { Props } from './Props';
import { Figures } from './Figures';
import { Chips } from './Chips';
import { Hands, GESTURE_DUR } from './Hands';
import { TableButtons } from './Buttons';
import { ITEM_MODELS } from './items';
import { ITEM } from '../../shared/Catalog';
import { Card3D, Cards3D } from './Cards3D';
import { MAX_SEATS } from '../../shared/Table';
import { POT, SEATS, boardSlot, BOARD_SCALE } from './layout';

export interface WorldFx {
  deal(): void;
  chips(n: number): void;
  check(): void;
  fold(): void;
  flip(): void;
  win(mine: boolean): void;
  collect(): void;
  paper(): void;
  heartbeat(): void;
  chipTick(): void;
  /** олл-ин: приглушить музыку, низкий удар, затемнение по краям */
  allin?(): void;
  /** риффл колоды перед раздачей */
  shuffle?(): void;
}

const potKey = 'pot';
const stackKey = (v: number) => `stack${v}`;
const betKey = (v: number) => `bet${v}`;

export class World {
  readonly day: DayCycle;
  readonly stage: Stage;
  readonly room: Room;
  readonly props: Props;
  readonly figures: Figures;
  readonly chips: Chips;
  readonly cards: Cards3D;
  readonly hands: Hands;
  readonly buttons: TableButtons;
  /** нажатие на табличку в борту: 0 — фолд, 1 — чек/колл, 2 — рейз */
  onPlate?: (i: number) => void;

  private prev: TableView | null = null;
  private mySeat = -1;
  private hole = new Map<number, Card3D[]>(); // по серверному месту
  private board: Card3D[] = [];
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private seq = 0;
  private dealing = false;
  /** предметы бутика на местах игроков: визуальное место → [ключ, группа] */
  private seatItems = new Map<number, { key: string; group: THREE.Group; items: string[] }>();

  // сквиз моих карт
  private peek = 0;          // текущее открытие 0..1
  private peekTarget = 0;
  private dragging: { y0: number; p0: number; moved: boolean } | null = null;
  squeezeMode = false;       // true — карты закрыты, пока не сквизнешь
  onSqueeze?: (active: boolean) => void;
  onPropTap?: (which: 'glass' | 'ashtray') => void;

  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();

  constructor(container: HTMLElement, private fx: WorldFx, opts: { felt: string; ring: string }) {
    this.stage = new Stage(container);
    const q = this.stage.quality;
    this.room = new Room(q, opts.felt);
    this.day = new DayCycle(this.stage, q);
    this.room.group.add(this.day.group);
    this.props = new Props(q);
    this.figures = new Figures();
    this.chips = new Chips(this.stage.tweens);
    this.cards = new Cards3D(this.stage.tweens);
    this.hands = new Hands('models/', this.stage.quality > 1);
    this.hands.onReady = () => this.stage.requestShadow(4);
    this.buttons = new TableButtons(this.stage.tweens);
    this.hands.setRing(opts.ring);
    this.stage.scene.add(this.room.group, this.props.group, this.figures.group, this.chips.mesh, this.cards.group, this.hands.group, this.buttons.group);

    this.stage.onFrame(({ t, dt }) => {
      this.room.update(t, dt);
      this.day.update(t, dt);
      this.props.update(t, dt);
      this.figures.update(t, dt);
      this.chips.update();
      this.updatePeek(dt);
      this.hands.update(dt, this.myCards().length && !this.dealing ? this.peek : 0);
      this.buttons.update(t, dt);
      this.idleHabits(dt);
      // тени пересчитываются только пока что-то движется — в покое кадр почти бесплатный
      if (this.stage.tweens.busy || this.hands.busy || this.dragging || Math.abs(this.peekTarget - this.peek) > 0.002) this.stage.requestShadow(2);
    });
    this.stage.onResized(() => {
      const h = this.stage.viewportHeightPx;
      this.props.smokeParticles.setScale(h, this.stage.camera.fov);
      this.room.dust.setScale(h, this.stage.camera.fov);
      this.room.setLampY(this.stage.lampY);
      this.stage.requestShadow(2);
      // поворот экрана — вещи у рук переезжают в слоты под новую ориентацию
      for (const [vi, e] of [...(this.seatItems ?? [])]) this.syncItems(vi, e.items);
      // угол сквиза — лицом к камере
      const lift = this.openLift();
      for (const c of this.myCards()) c.liftMax = lift;
    });
    this.stage.onLowPower(low => {
      this.room.dust.points.visible = !low;
    });
    // кто отбрасывает тени от лампы
    const cast = (o: THREE.Object3D) => o.traverse(m => { if ((m as THREE.Mesh).isMesh) m.castShadow = true; });
    [this.props.glass, this.hands.group, this.cards.group, this.figures.group].forEach(cast);
    this.chips.mesh.castShadow = true;
    // фишки для тасовки — те же, что на столе
    this.hands.attachChips(this.chips.mesh.geometry, this.chips.mesh.material as THREE.Material,
      ['#121214', '#7a1428', '#121214', '#0e7a35'].map(c => new THREE.Color(c)));
    this.hands.onTick = () => this.fx.chipTick();
    this.stage.requestShadow(3);
    this.stage.isIdle = () => !this.stage.tweens.busy && !this.hands.busy && !this.dragging;
    this.bindPointer();
  }

  /** серверное место → визуальное (0 — ближний торец) */
  vis(seat: number) {
    return this.mySeat >= 0 ? (seat - this.mySeat + MAX_SEATS) % MAX_SEATS : seat;
  }

  private myCards(): Card3D[] { return this.mySeat >= 0 ? this.hole.get(this.mySeat) || [] : []; }

  // ───────────────────────── вход состояния ─────────────────────────

  apply(view: TableView) {
    const prev = this.prev;
    this.prev = view;
    const seatChanged = view.mySeat !== this.mySeat;
    this.pending++;
    const id = ++this.seq;
    this.queue = this.queue.then(async () => {
      try {
        // если очередь копится — догоняем без анимаций
        const behind = this.seq - id;
        if (!prev || seatChanged || behind > 2) await this.snap(view, seatChanged || !prev);
        else await this.diff(prev, view);
      } catch (e) {
        console.error(e);
        await this.snap(view, true);
      } finally {
        this.pending--;
      }
    });
  }

  get busy() { return this.pending > 0; }

  // ───────────────────────── мгновенная сборка ─────────────────────────

  private async snap(v: TableView, full: boolean) {
    if (full) this.mySeat = v.mySeat;
    for (const c of this.cards.pool) this.cards.release(c);
    this.hole.clear();
    this.board = [];
    for (const k of this.chips.keys()) this.chips.clear(k);

    this.syncSeats(v);
    for (const s of v.seats) {
      if (!s) continue;
      const vi = this.vis(s.seat);
      this.chips.set(stackKey(vi), s.stack, SEATS[vi].stack, vi === 0 ? 30 : 24);
      if (s.bet > 0) this.chips.set(betKey(vi), s.bet, SEATS[vi].bet, 14);
      if (s.hasCards && v.stage !== 'WAITING') {
        const pair = [0, 1].map(i => {
          const c = this.cards.take();
          const { pos, rot } = this.holePose(vi, i);
          c.root.position.copy(pos); c.root.rotation.set(0, rot, 0);
          c.setCode(s.cards[i] ?? null);
          c.setFaceUp(vi !== 0 && !!s.cards[i]);
          return c;
        });
        this.hole.set(s.seat, pair);
      }
    }
    if (v.potCollected > 0) this.chips.set(potKey, v.potCollected, POT, 40);
    v.board.forEach((code, i) => {
      const c = this.cards.take();
      c.setCode(code); c.setFaceUp(true);
      c.root.position.copy(boardSlot(i)); c.root.rotation.set(0, this.boardRot(i), 0);
      c.root.scale.setScalar(BOARD_SCALE); c.baseGlow = 0.12; c.setHighlight(0);
      this.board.push(c);
    });
    if (this.mySeat >= 0 && this.hole.has(this.mySeat)) {
      // быстрая синхронизация не прерывает взгляд на карты: состояние подъёма сохраняется
      for (const c of this.myCards()) c.liftMax = this.openLift();
    }
    if (v.stage === 'HAND_OVER') this.highlightWinners(v);
  }

  // ───────────────────────── анимированные переходы ─────────────────────────

  private async diff(p: TableView, v: TableView) {
    const tw = this.stage.tweens;
    this.syncSeats(v);

    if (v.handId !== p.handId) {
      await this.newHand(p, v);
      return;
    }

    // 1) ставки и действия
    let chipsMoved = 0;
    for (const s of v.seats) {
      if (!s) continue;
      const vi = this.vis(s.seat);
      const old = p.seats[s.seat];
      const oldBet = old?.bet ?? 0;
      if (s.bet > oldBet) {
        chipsMoved++;
        if (s.seat === this.mySeat && !this.dealing) {
          // моя ставка: рука берёт фишки со стопки и кладёт их — фишки летят «в руке»
          this.hands.play('bet');
          const at = GESTURE_DUR.bet * 1000;
          setTimeout(() => this.chips.set(stackKey(vi), s.stack, SEATS[vi].stack, 30), at * 0.4);
          this.chips.fly(SEATS[vi].stack, betKey(vi), SEATS[vi].bet, s.bet, s.bet - oldBet, { limit: 8, delay: at * 0.42, dur: at * 0.42, low: true });
          setTimeout(() => this.fx.chips(1), at * 0.4);
        } else {
          this.chips.set(stackKey(vi), s.stack, SEATS[vi].stack, vi === 0 ? 30 : 24);
          this.chips.fly(SEATS[vi].stack, betKey(vi), SEATS[vi].bet, s.bet, s.bet - oldBet, { limit: 8 });
        }
      } else if (old && old.stack !== s.stack && v.stage !== 'HAND_OVER') {
        this.chips.set(stackKey(vi), s.stack, SEATS[vi].stack, vi === 0 ? 30 : 24);
      }
      const act = s.lastAction?.type;
      if (act && JSON.stringify(s.lastAction) !== JSON.stringify(old?.lastAction)) {
        if (act === 'CHECK') this.fx.check();
        if (act === 'FOLD') this.fx.fold();
        if (act === 'ALLIN') this.allInMoment(vi);
        if (s.seat === this.mySeat) {
          if (act === 'CHECK') this.hands.play('knock');
          else if (act === 'FOLD') this.hands.play('flick');
        }
      }
      if (s.folded && old && !old.folded) {
        const pair = this.hole.get(s.seat);
        if (pair) { pair.forEach((c, i) => this.cards.muck(c, i * 60)); this.hole.delete(s.seat); }
        if (s.seat === this.mySeat) this.peekTarget = 0;
      }
      // открытые карты (шоудаун / show)
      const pair = this.hole.get(s.seat);
      if (pair) s.cards.forEach((code, i) => {
        if (code && old?.cards[i] !== code) {
          pair[i].setCode(code);
          if (vi !== 0) this.cards.flipTo(pair[i], true, i * 120);
        }
      });
    }
    if (chipsMoved) this.fx.chips(chipsMoved);

    // 2) новая улица: собрать ставки → выложить карты
    const streetEnded = v.board.length > p.board.length || (v.stage === 'HAND_OVER' && p.stage !== 'HAND_OVER');
    if (streetEnded) {
      await tw.waitFor(chipsMoved ? 420 : 0);
      await this.collectBets(p, v);
    }
    // олл-ин и докрутка: замедленный ривер — наезд камеры, сердцебиение, карта открывается медленно
    const live = v.seats.filter(s => s && s.inHand && !s.folded);
    const runout = v.activeSeat < 0 && live.length >= 2 && live.filter(s => !s!.allIn).length <= 1 && v.stage !== 'HAND_OVER';
    if (runout && v.board.length === 5 && p.board.length === 4) {
      await this.dramaticRiver(v);
      return;
    }
    if (runout && v.board.length > p.board.length && !this.heartTimer) this.startHeart();
    if (v.board.length > p.board.length) {
      for (let i = p.board.length; i < v.board.length; i++) {
        const c = this.cards.take();
        c.setCode(v.board[i]);
        c.root.scale.setScalar(BOARD_SCALE);
        c.baseGlow = 0.12; c.setHighlight(0);   // общие карты чуть светлее — читаются в полумраке
        this.board[i] = c;
        const first = i === p.board.length;
        const delay = (i - p.board.length) * 140;
        this.cards.deal(c, boardSlot(i), this.boardRot(i), {
          delay, dur: 360, onStart: () => this.fx.deal(),
          onLand: () => { this.cards.flipTo(c, true, (v.board.length - i) * 0 + (first ? 60 : 0)); this.fx.flip(); },
        });
      }
      await tw.waitFor((v.board.length - p.board.length) * 140 + 760);
    }

    // 3) конец раздачи: подсветка и выплата
    if (v.stage === 'HAND_OVER' && p.stage !== 'HAND_OVER') {
      this.stopHeart();
      if (this.dollied) { this.dollied = false; setTimeout(() => this.stage.dolly(false, 1600), 2600); }
      await tw.waitFor(v.showdown ? 650 : 150);
      this.highlightWinners(v);
      await this.payWinners(v);
    }
  }

  private idleTimer = 6;
  private frameNo = 0;

  /** Пока не мой ход — руки сами тасуют фишки; соперники думают — их тени обновляются. */
  private idleHabits(dt: number) {
    this.frameNo++;
    const v = this.prev;
    if (!v || v.mySeat < 0 || !v.lobby?.started) return;
    if (v.activeSeat >= 0 && v.activeSeat !== v.mySeat && this.frameNo % 6 === 0) this.stage.requestShadow(1);
    const me = v.seats[v.mySeat];
    const myTurn = v.activeSeat === v.mySeat;
    if (myTurn || this.dealing || this.hands.busy || !me || me.stack <= 0) return;
    this.idleTimer -= dt;
    if (this.idleTimer <= 0) {
      this.idleTimer = 9 + Math.random() * 7;
      this.hands.play('riffle');
    }
  }

  private heartTimer: ReturnType<typeof setInterval> | null = null;
  private dollied = false;

  private startHeart() {
    this.stopHeart();
    this.fx.heartbeat();
    this.heartTimer = setInterval(() => this.fx.heartbeat(), 950);
  }
  private stopHeart() {
    if (this.heartTimer) clearInterval(this.heartTimer);
    this.heartTimer = null;
  }

  private async dramaticRiver(v: TableView) {
    const tw = this.stage.tweens;
    if (!this.heartTimer) this.startHeart();
    this.dollied = true;
    this.stage.dolly(true, 1500, boardSlot(2));
    await tw.waitFor(900);
    const c = this.cards.take();
    c.setCode(v.board[4]);
    c.root.scale.setScalar(BOARD_SCALE);
    c.baseGlow = 0.12; c.setHighlight(0);
    this.board[4] = c;
    this.cards.deal(c, boardSlot(4), this.boardRot(4), { dur: 900, onStart: () => this.fx.deal() });
    await tw.waitFor(1300);
    // медленный переворот: карта поднимается, зависает и ложится лицом вверх
    this.cards.flipTo(c, true, 0, 1700);
    setTimeout(() => this.fx.flip(), 1100);
    await tw.waitFor(1900);
    this.stopHeart();
  }

  private lastAllIn = 0;
  /** Олл-ин: замедленная съёмка, камера подъезжает к столу, звук приглушается. */
  private allInMoment(vi: number) {
    const now = performance.now();
    if (now - this.lastAllIn < 2500) return;   // второй олл-ин подряд — без повторного эффекта
    this.lastAllIn = now;
    this.stage.slowMo(0.32, 1500);
    this.fx.allin?.();
    if (!this.dollied) {
      const target = SEATS[vi].bet.clone().lerp(boardSlot(2), 0.45);
      this.stage.dolly(true, 900, target);
      setTimeout(() => { if (!this.dollied) this.stage.dolly(false, 1500); }, 2300);
    }
  }

  private async newHand(p: TableView, v: TableView) {
    const tw = this.stage.tweens;
    this.stopHeart();
    if (this.dollied) { this.dollied = false; this.stage.dolly(false, 900); }
    this.dealing = true;
    // уборка прошлой раздачи
    this.peekTarget = 0;
    await this.cards.sweep();
    for (const c of this.board) this.cards.release(c);
    this.board = [];
    this.hole.clear();
    // колода коротко тасуется перед раздачей
    if (this.chips.amount(potKey)) this.chips.clear(potKey);
    for (let i = 0; i < MAX_SEATS; i++) this.chips.clear(betKey(i));
    await this.cards.shuffle(() => this.fx.shuffle?.());

    // блайнды
    for (const s of v.seats) {
      if (!s) continue;
      const vi = this.vis(s.seat);
      this.chips.set(stackKey(vi), s.stack + s.bet, SEATS[vi].stack, vi === 0 ? 30 : 24);
    }
    let blinds = 0;
    for (const s of v.seats) {
      if (!s || s.bet <= 0) continue;
      const vi = this.vis(s.seat);
      this.chips.set(stackKey(vi), s.stack, SEATS[vi].stack, vi === 0 ? 30 : 24);
      this.chips.fly(SEATS[vi].stack, betKey(vi), SEATS[vi].bet, s.bet, s.bet, { limit: 5, delay: blinds++ * 120 });
    }
    if (blinds) this.fx.chips(2);
    void p;

    // раздача по кругу слева от баттона, по одной карте
    const order: SeatView[] = [];
    for (let k = 1; k <= MAX_SEATS; k++) {
      const s = v.seats[(v.button + k) % MAX_SEATS];
      if (s?.hasCards) order.push(s);
    }
    let d = 300;
    for (let round = 0; round < 2; round++) {
      for (const s of order) {
        const vi = this.vis(s.seat);
        const c = this.cards.take();
        c.setCode(s.cards[round] ?? null);
        if (!this.hole.has(s.seat)) this.hole.set(s.seat, []);
        this.hole.get(s.seat)![round] = c;
        const { pos, rot } = this.holePose(vi, round);
        if (vi === 0) c.liftMax = this.openLift();
        this.cards.deal(c, pos, rot, { delay: d, dur: 520 + (vi === 0 ? 120 : 0), onStart: () => this.fx.deal() });
        d += 140;
      }
    }
    await tw.waitFor(d + 380);
    this.dealing = false;
    // пауза — и рука поднимает уголки, чтобы подсмотреть
    await tw.waitFor(350);
    if (this.hole.has(this.mySeat) && !this.squeezeMode) this.lookAtCards();
  }

  private async collectBets(p: TableView, v: TableView) {
    let any = false;
    for (let vi = 0; vi < MAX_SEATS; vi++) {
      if (this.chips.amount(betKey(vi)) > 0) {
        any = true;
        this.chips.pour(betKey(vi), potKey, POT, v.potCollected, { dur: 480, delay: vi * 40 });
      }
    }
    void p;
    if (any) { this.fx.collect(); await this.stage.tweens.waitFor(560 + 6 * 40); }
    this.chips.set(potKey, v.potCollected, POT, 40);
  }

  private async payWinners(v: TableView) {
    const total = v.winners.reduce((s, w) => s + w.amount, 0);
    if (!total) return;
    const mine = v.winners.some(w => w.seat === this.mySeat);
    this.fx.win(mine);
    let left = total;
    v.winners.forEach((w, i) => {
      const vi = this.vis(w.seat);
      const s = v.seats[w.seat];
      left -= w.amount;
      const src = this.chips.anchor(potKey) || POT;
      const finalStack = s?.stack ?? 0;
      if (i === v.winners.length - 1) {
        this.chips.pour(potKey, stackKey(vi), SEATS[vi].stack, finalStack, { dur: 950, delay: 160, limit: 24, high: true });
      } else {
        this.chips.set(potKey, left, POT, 40);
        this.chips.fly(src, stackKey(vi), SEATS[vi].stack, finalStack, w.amount, { dur: 950, limit: 24, high: true });
      }
      this.figures.list[vi]?.setLean(0.6);
      setTimeout(() => this.figures.list[vi]?.setLean(0), 1600);
    });
    await this.stage.tweens.waitFor(1400);
  }

  private hintKey = '';
  /** Подсказка новичку: карты, из которых сложилась комбинация, мягко светятся (на столе и в руке). */
  highlightCodes(codes: string[]) {
    const key = codes.join(',');
    if (key === this.hintKey) return;
    this.hintKey = key;
    const set = new Set(codes);
    for (const c of [...this.board.filter(Boolean), ...this.myCards()]) {
      if (!c?.inUse || !c.code) continue;
      c.setHighlight(set.has(c.code) ? 0.55 : 0);
    }
  }

  private glowHand = -1;
  private highlightWinners(v: TableView) {
    const best = new Set(v.winners.flatMap(w => w.best || []));
    if (!best.size) return;
    const all = [...this.board, ...[...this.hole.values()].flat()];
    // сильная комбинация (стрит и выше) — карты «дышат» золотом
    const STRONG = ['Стрит', 'Флеш', 'Фулл-хаус', 'Каре', 'Роял'];
    const strong = v.winners.some(w => STRONG.some(n => (w.handName || '').startsWith(n)));
    if (strong && this.glowHand !== v.handId) {
      this.glowHand = v.handId;
      const top = v.winners.some(w => /Каре|Стрит-флеш|Роял/.test(w.handName || '')) ? 1.6 : 1;
      this.cards.glow(all.filter(c => c.code && best.has(c.code)), top);
    }
    for (const c of all) {
      if (c.code && best.has(c.code)) {
        if (!strong) c.setHighlight(1);
        const y0 = c.root.position.y;
        this.stage.tweens.add(300, k => { c.root.position.y = y0 + k * 0.012; }, { key: c.root });
      } else if (this.board.includes(c)) {
        c.setHighlight(0);
      }
    }
  }

  // ───────────────────────── места, фигуры, таблички ─────────────────────────

  private syncSeats(v: TableView) {
    for (let vi = 0; vi < MAX_SEATS; vi++) {
      const seat = this.mySeat >= 0 ? (vi + this.mySeat) % MAX_SEATS : vi;
      const s = v.seats[seat];
      const fig = this.figures.list[vi];
      if (fig) {
        fig.present = !!s;
        fig.setLean(s && v.activeSeat === seat ? 0.35 : s?.folded ? -0.4 : 0);
        fig.setThinking(!!s && v.activeSeat === seat);
        if (s?.ring) fig.ringMat.color.set(s.ring === 'RING_ONYX' ? '#d9dde3' : s.ring === 'RING_RUBY' ? '#c21c3a' : '#d4af37');
      }
      this.room.setPlate(vi, s ? s.name : '', !!s && v.activeSeat === seat);
      this.syncItems(vi, s?.items || []);
      if (!s) { this.chips.clear(stackKey(vi)); this.chips.clear(betKey(vi)); }
    }
  }

  private thumbs = new Map<string, string>();
  /** Витрина бутика: 3D-превью предмета (рендер один раз, кэш) — PNG data URL. */
  itemThumb(model: string): string {
    const hit = this.thumbs.get(model);
    if (hit !== undefined) return hit;
    const make = ITEM_MODELS[model];
    if (!make) { this.thumbs.set(model, ''); return ''; }
    const N = 192;
    const r = this.stage.renderer;
    const scene = new THREE.Scene();
    scene.environment = this.stage.scene.environment;
    scene.add(new THREE.HemisphereLight(0xffe8d0, 0x200810, 1.2));
    const key = new THREE.DirectionalLight(0xfff0dd, 2.6);
    key.position.set(-0.4, 1, 0.6);
    scene.add(key);
    const obj = make();
    scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
    cam.position.set(c.x + size * 0.5, c.y + size * 1.55, c.z + size * 1.15);
    cam.lookAt(c);
    const rt = new THREE.WebGLRenderTarget(N, N, { samples: 4 });
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, cam);
    const px = new Uint8Array(N * N * 4);
    r.readRenderTargetPixels(rt, 0, 0, N, N, px);
    r.setRenderTarget(null);
    rt.dispose();
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(N, N);
    // линейный цвет → sRGB, строки снизу вверх
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const si = ((N - 1 - y) * N + x) * 4, di = (y * N + x) * 4;
      for (let k = 0; k < 3; k++) img.data[di + k] = Math.round(255 * Math.pow(Math.min(1, px[si + k] / 255 * 1.15), 1 / 2.2));
      img.data[di + 3] = px[si + 3];
    }
    g.putImageData(img, 0, 0);
    const url = cv.toDataURL('image/png');
    this.thumbs.set(model, url);
    return url;
  }

  /** Купленные предметы игрока лежат у его места — их видят все за столом. */
  private syncItems(vi: number, items: string[]) {
    const portrait = innerWidth < innerHeight;
    const key = items.join(',') + (portrait ? '|p' : '|l');
    const cur = this.seatItems.get(vi);
    if (cur?.key === key) return;
    if (cur) { this.stage.scene.remove(cur.group); this.seatItems.delete(vi); }
    if (!items.length) return;
    const g = new THREE.Group();
    const s = SEATS[vi];
    const faceRot = Math.atan2(s.out.x, s.out.z);
    // у меня: слева от левой руки и справа у стакана; у соперников — по бокам от их рук
    // в портрете кадр уже — вещи ближе к центру, чтобы не уходили за край экрана
    const MY_SLOTS = portrait
      ? [{ pos: new THREE.Vector3(-0.5, 0, 1.24), rot: 0.5 }, { pos: new THREE.Vector3(0.62, 0, 1.1), rot: -1.1 }]
      : [{ pos: new THREE.Vector3(-0.66, 0, 1.5), rot: 0.5 }, { pos: new THREE.Vector3(0.84, 0, 1.1), rot: -1.1 }];
    items.slice(0, 2).forEach((id, i) => {
      const make = ITEM_MODELS[ITEM[id]?.model || ''];
      if (!make) return;
      const obj = make();
      obj.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      if (vi === 0) {
        obj.position.copy(MY_SLOTS[i].pos);
        obj.rotation.y = MY_SLOTS[i].rot;
      } else {
        obj.position.copy(s.edge).addScaledVector(s.out, -0.24).addScaledVector(s.side, i === 0 ? -0.3 : 0.3);
        obj.rotation.y = faceRot + (i === 0 ? 0.4 : -0.4);
      }
      g.add(obj);
    });
    this.stage.scene.add(g);
    this.seatItems.set(vi, { key, group: g, items: [...items] });
    this.stage.requestShadow(2);
  }

  private holePose(vi: number, i: number) {
    const g = SEATS[vi];
    if (vi === 0) {
      return {
        // аккуратная стопка: вторая карта сдвинута вбок и лежит строго поверх первой —
        // одинаковый поворот и шарнир, поэтому при подъёме карты никогда не входят друг в друга
        pos: g.cards.clone().add(new THREE.Vector3(i === 0 ? -0.034 : 0.034, 0.0006 + i * 0.0022, 0)),
        rot: 0.05,
      };
    }
    const base = Math.atan2(g.out.x, g.out.z);
    return {
      pos: g.cards.clone().addScaledVector(g.side, i === 0 ? -0.035 : 0.035).setY(i * 0.0015),
      rot: base + (i === 0 ? 0.14 : -0.1),
    };
  }

  private boardRot(i: number) { return Math.sin(i * 91.7 + (this.prev?.handId || 0)) * 0.03; }

  // ───────────────────────── сквиз и тапы ─────────────────────────

  /** Угол открытия карты: лицо смотрит на камеру под углом, как при подсматривании уголка. */
  private openLift() { return 0.78 + this.stage.camPitch * 0.3; }

  private lookUntil = 0;
  private fanned = false;
  private lastLook = 0;

  /**
   * Сценарий «подсмотреть»: рука берёт карты за ближний край, медленно поднимает и сгибает уголок
   * (видно масть и ранг), держит ~1.6 с и аккуратно кладёт обратно на сукно.
   */
  lookAtCards(hold = 1600) {
    if (!this.myCards().some(c => c.inUse) || this.dealing) return;
    if (this.peekTarget < 0.5) this.fx.paper();
    this.peekTarget = 1;
    this.lastLook = performance.now();
    this.lookUntil = 1.0 + hold / 1000;   // секунды игрового времени: подъём ~1 с + удержание
  }

  /** на своём ходу — короткий взгляд, если давно не смотрел */
  glanceOnTurn() {
    if (performance.now() - this.lastLook > 6000) this.lookAtCards(1100);
  }

  private updatePeek(dt: number) {
    const mine = this.myCards();
    if (!mine.length) { this.peek = 0; this.lookUntil = 0; return; }
    if (!this.dragging && this.lookUntil > 0) {
      this.lookUntil -= dt;
      if (this.lookUntil <= 0) { this.lookUntil = 0; this.peekTarget = 0; }
    }
    // медленно: сначала ладонь ложится на карты, потом поднимает уголки
    if (!this.dragging) this.peek += (this.peekTarget - this.peek) * Math.min(1, dt * 1.7);
    if (this.dealing) return;
    const p = Math.min(1, Math.max(0, (this.peek - 0.22) / 0.78));   // первые ~20% — только рука
    const k = p * p * (3 - 2 * p);
    for (let i = 0; i < mine.length; i++) {
      const c = mine[i];
      if (!c.inUse) continue;
      // карты остаются стопкой со сдвигом, как в руке: верхняя приподнимается чуть сильнее,
      // поэтому загнутый уголок нижней никогда не входит в неё; видны обе карты
      if (k > 0.0005 || this.fanned) {
        const home = this.holePose(0, i);
        c.root.position.x = home.pos.x + (i === 0 ? -0.012 : 0.012) * k;
        c.root.position.z = home.pos.z;
        c.root.rotation.y = home.rot;
      }
      if (i === mine.length - 1) this.fanned = k > 0.0005;
      if (c.root.userData.noShadow !== true) {
        c.root.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = false; });
        c.root.userData.noShadow = true;
      }
      const glow = 0.06 + 0.45 * k;
      if (Math.abs(c.baseGlow - glow) > 0.004) { c.baseGlow = glow; c.setHighlight(0); }
      c.lift = k * (i === 0 ? 0.86 : 1);
      c.bend = k * 0.55;   // мягкий изгиб уголка — без «заворачивания»
      c.applyLift();
    }
  }

  private bindPointer() {
    const el = this.stage.renderer.domElement;
    const hit = (e: PointerEvent) => {
      this.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      this.ray.setFromCamera(this.ndc, this.stage.camera);
      // таблички в борту
      for (let i = 0; i < this.buttons.plates.length; i++) {
        const p = this.buttons.plates[i];
        if (p.enabled && this.ray.intersectObject(p.root, true).length) return ('plate' + i) as 'plate0';
      }
      const mine = this.myCards().filter(c => c.inUse);
      if (mine.length && this.ray.intersectObjects(mine.map(c => c.root), true).length) return 'cards';
      for (const [name, obj] of [['glass', this.props.glass]] as const) {
        if (this.ray.intersectObject(obj, true).length) return name;
      }
      return null;
    };
    el.addEventListener('pointerdown', (e) => {
      const h = hit(e);
      if (h && h.startsWith('plate')) {
        const i = Number(h.slice(5));
        this.buttons.press(i);
        this.stage.requestShadow(40);
        this.onPlate?.(i);
        return;
      }
      if (h === 'cards') {
        this.dragging = { y0: e.clientY, p0: this.peek, moved: false };
        el.setPointerCapture(e.pointerId);
        this.onSqueeze?.(true);
      } else if (h === 'glass') {
        this.props.poke(h);
        this.onPropTap?.(h);
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dy = (this.dragging.y0 - e.clientY) / (innerHeight * 0.22);
      if (Math.abs(dy) > 0.04) this.dragging.moved = true;
      this.peek = THREE.MathUtils.clamp(this.dragging.p0 + dy, 0, 1);
    });
    const end = () => {
      if (!this.dragging) return;
      const d = this.dragging;
      this.dragging = null;
      this.onSqueeze?.(false);
      // тап — посмотреть ещё раз; сквиз пальцем — отпустил, и рука кладёт карты обратно
      if (!d.moved) this.lookAtCards();
      else { this.peekTarget = 0; this.lookUntil = 0; }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /** Вне стола: пустая комната, тишина. */
  clear() {
    this.prev = null;
    this.mySeat = -1;
    this.queue = this.queue.then(() => {
      for (const c of this.cards.pool) this.cards.release(c);
      this.hole.clear();
      this.board = [];
      for (const k of this.chips.keys()) this.chips.clear(k);
      for (const f of this.figures.list) if (f) f.present = false;
      for (let i = 0; i < 6; i++) { this.room.setPlate(i, '', false); this.syncItems(i, []); }
      this.peek = this.peekTarget = 0;
      this.stage.requestShadow(2);
    });
  }

  // ───────────────────────── кастомизация ─────────────────────────

  setFelt(c: string) { this.room.setFelt(c); }
  setRing(id: string) { this.hands.setRing(id); }

  /** якоря для HTML-плашек */
  seatAnchor(seat: number) { return SEATS[this.vis(seat)].label; }
  visualOf(seat: number) { return this.vis(seat); }
  potAnchor() { return POT; }
  boardAnchor() { return boardSlot(2); }
}
