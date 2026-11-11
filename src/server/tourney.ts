// Турнир «Ночь пятницы»: 18 мест, старт по пятницам в 21:00 по Москве (или сразу, как наберётся 18).
// Свободные места занимают боты клуба. Три стола по шесть, блайнды растут каждые 5 минут,
// выбывшие встают из-за стола, столы объединяются до финального. Призы — уникальные рубашки и фишки.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TableHost } from '../shared/TableHost';
import { BOT_ROSTER } from '../shared/Bots';
import { TOURNEY, SEASON, UNLOCKS, nextFriday } from '../shared/Catalog';
import type { TourneyInfo } from '../shared/Catalog';
import type { Personality } from '../shared/Table';

export interface TourneyCtx {
  rooms: Map<string, TableHost>;
  /** посадить онлайн-игрока за стол (подписка на состояние); оффлайн — посадится при входе */
  seat(userId: string, host: TableHost): void;
  /** выбыл: на главный экран с сообщением */
  out(userId: string, text: string): void;
  toast(userId: string, text: string, ok?: boolean): void;
  /** всем онлайн — новое состояние турнира */
  broadcast(): void;
  announce(text: string): void;
  user(id: string): { id: string; name: string; balance: number } | undefined;
  reward(id: string, chips: number, unlock: string, xp: number): void;
  fair: (deck: string[]) => { hash: string; seed: string };
  /** раздача сыграна: опыт сезона и статистика (баланс не трогаем) */
  hand(humans: string[], deltas: Map<string, number>, pot: number): void;
}

interface Entrant { id: string; name: string; bot: boolean; personality?: Personality }

const EXTRA_BOTS = ['Красотка Лу', 'Док Холлидей', 'Синьор Риччи', 'Мадам Роза', 'Граф Орлов', 'Джонни Вегас', 'Леди Ди', 'Профессор', 'Барон Штольц',
  'Фрэнки Две Руки', 'Мисс Скарлет', 'Старик Мозес', 'Кид Бостон', 'Майор Грей', 'Нико Бруно', 'Белла Нуар', 'Капитан Флинт', 'Тони Сопрано'];
const PERS: Personality[] = ['SHARK', 'ROCK', 'BLUFFER', 'TOURIST'];

const DATA = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const FILE = path.join(DATA, 'tourney.json');

export class Tourney {
  state: 'REG' | 'RUNNING' | 'DONE' = 'REG';
  startsAt = nextFriday();
  private registered = new Map<string, string>();     // id → имя
  private tables: TableHost[] = [];
  private alive = new Map<string, Entrant>();
  private places: { place: number; name: string; id: string; bot: boolean }[] = [];
  private startedAt = 0;
  private results: { place: number; name: string; bot?: boolean }[] = [];

  constructor(private ctx: TourneyCtx) {
    try {
      const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (j.startsAt > Date.now()) { this.startsAt = j.startsAt; for (const [id, n] of j.registered || []) this.registered.set(id, n); }
      this.results = j.results || [];
    } catch { /* первый запуск */ }
    // для проверки: TOURNEY_TEST_MIN=2 — турнир через 2 минуты после запуска сервера
    const test = Number(process.env.TOURNEY_TEST_MIN || 0);
    if (test > 0) this.startsAt = Date.now() + test * 60_000;
    setInterval(() => this.tick(), 2000);
  }

  private save() {
    try { fs.writeFileSync(FILE, JSON.stringify({ startsAt: this.startsAt, registered: [...this.registered], results: this.results })); } catch { /* */ }
  }

  owns(h: TableHost) { return this.tables.includes(h); }

  info(userId: string): TourneyInfo {
    const lvl = this.level();
    return {
      state: this.state, startsAt: this.startsAt, registered: this.registered.size, me: this.registered.has(userId),
      playing: this.state === 'RUNNING' && this.alive.has(userId),
      left: this.state === 'RUNNING' ? this.alive.size : undefined,
      level: this.state === 'RUNNING' ? lvl + 1 : undefined,
      blinds: this.state === 'RUNNING' ? TOURNEY.BLINDS[lvl] : undefined,
      results: this.results.slice(0, 5),
    };
  }

  register(userId: string, on: boolean): string {
    if (this.state === 'RUNNING') return 'Турнир уже идёт — записаться можно на следующую пятницу';
    if (on) {
      if (this.registered.size >= TOURNEY.MAX && !this.registered.has(userId)) return 'Все 18 мест заняты';
      const u = this.ctx.user(userId);
      this.registered.set(userId, u?.name || 'Игрок');
    } else this.registered.delete(userId);
    this.save();
    this.ctx.broadcast();
    // собрались все 18 — начинаем сразу
    if (this.registered.size >= TOURNEY.MAX) setTimeout(() => this.start(), 3000);
    return on ? 'Вы в списке «Ночи пятницы». Начало — в пятницу в 21:00 по Москве' : 'Вы вышли из списка турнира';
  }

  /** сколько ещё ждать до старта */
  private tick() {
    if (this.state !== 'RUNNING' && Date.now() >= this.startsAt) {
      if (this.registered.size > 0) this.start();
      else { this.startsAt = nextFriday(Date.now() + 60_000); this.state = 'REG'; this.save(); }
      return;
    }
    if (this.state === 'RUNNING') {
      for (const h of [...this.tables]) if (h.table.stage === 'WAITING' || h.table.stage === 'HAND_OVER') {
        if (h.table.players().some(p => p.stack <= 0)) this.sweep(h);
      }
      this.rebalance();
    }
  }

  private level() { return this.startedAt ? Math.min(TOURNEY.BLINDS.length - 1, Math.floor((Date.now() - this.startedAt) / TOURNEY.LEVEL_MS)) : 0; }

  /** старт: люди + боты до 18, рассадка по трём столам */
  start() {
    if (this.state === 'RUNNING') return;
    const people: Entrant[] = [...this.registered].map(([id, name]) => ({ id, name, bot: false }));
    if (!people.length) return;
    this.state = 'RUNNING';
    this.startedAt = Date.now();
    this.places = [];
    this.alive.clear();
    const names = [...BOT_ROSTER.map(b => b.name), ...EXTRA_BOTS];
    const all: Entrant[] = [...people];
    for (let k = 0; all.length < TOURNEY.MAX; k++) {
      all.push({ id: `tb-${k}`, name: names[k % names.length], bot: true, personality: BOT_ROSTER[k]?.personality || PERS[k % PERS.length] });
    }
    // случайная рассадка
    for (let i = all.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [all[i], all[j]] = [all[j], all[i]]; }
    for (const e of all) this.alive.set(e.id, e);
    const n = Math.ceil(all.length / 6);
    this.tables = [];
    for (let k = 0; k < n; k++) this.tables.push(this.makeTable(k + 1));
    all.forEach((e, i) => this.sitAt(this.tables[i % n], e, TOURNEY.STACK));
    for (const t of this.tables) { t.started = true; t.kick(); }
    for (const e of people) this.ctx.toast(e.id, `«${TOURNEY.NAME}» начинается! Стол ${this.tableNo(this.hostOf(e.id)!)}, удачи`, true);
    this.ctx.announce(`Турнир «${TOURNEY.NAME}» начался: ${people.length} игроков клуба и ${all.length - people.length} гостей`);
    this.registered.clear();
    this.save();
    this.ctx.broadcast();
  }

  private makeTable(no: number): TableHost {
    let id: string;
    do id = 'FN' + crypto.randomBytes(2).toString('hex').toUpperCase(); while (this.ctx.rooms.has(id));
    const [sb, bb] = TOURNEY.BLINDS[0];
    const host: TableHost = new TableHost({
      id, sb, bb, turnMs: TOURNEY.TURN_MS, isPrivate: true, tourney: true,
      rng: n => crypto.randomInt(0, n), fair: this.ctx.fair,
      beforeHand: () => {
        this.sweep(host);
        const [s, b] = TOURNEY.BLINDS[this.level()]; host.table.sb = s; host.table.bb = b;
      },
      onHandEnd: r => this.ctx.hand(r.humans, r.deltas, r.potTotal),
      onCashout: (pid) => this.forfeit(pid),
      tourneyInfo: () => ({ name: `${TOURNEY.NAME} · стол ${no}`, level: this.level() + 1, left: this.alive.size, nextAt: this.startedAt + (this.level() + 1) * TOURNEY.LEVEL_MS }),
    });
    (host as unknown as { tourneyNo: number }).tourneyNo = no;
    this.ctx.rooms.set(id, host);
    return host;
  }

  private tableNo(h: TableHost) { return (h as unknown as { tourneyNo: number }).tourneyNo; }
  private hostOf(id: string) { return this.tables.find(t => t.table.byId(id)); }

  private sitAt(host: TableHost, e: Entrant, stack: number) {
    const seat = host.table.freeSeat();
    if (seat < 0) return false;
    host.table.sit({ id: e.id, name: e.name, seat, stack, isBot: e.bot, personality: e.personality, ring: 'RING_GOLD' });
    if (!e.bot) this.ctx.seat(e.id, host);
    return true;
  }

  /** перед раздачей (и раз в 2 с на простаивающих столах): выбывшие встают, столы выравниваются */
  private sweep(host: TableHost) {
    if (this.state !== 'RUNNING') return;
    const busted = host.table.players().filter(p => p.stack <= 0);
    for (const p of busted) this.bust(p.id, host);
    this.rebalance();
    this.checkEnd();
  }

  private bust(id: string, host: TableHost | undefined) {
    const e = this.alive.get(id);
    if (!e) return;
    const place = this.alive.size;
    this.alive.delete(id);
    this.places.push({ place, name: e.name, id, bot: e.bot });
    if (host?.table.byId(id)) host.table.leave(id);
    if (!e.bot) {
      this.ctx.reward(id, 0, '', SEASON.XP_TOURNEY);
      this.ctx.out(id, `«${TOURNEY.NAME}»: вы заняли ${place}-е место из ${TOURNEY.MAX}`);
    }
    // люди кончились — дальше боты доигрывают мгновенно
    if (![...this.alive.values()].some(x => !x.bot)) this.finishBots();
  }

  /** игрок сам встал из-за турнирного стола — это выход из турнира */
  forfeit(id: string) { if (this.alive.has(id)) this.bust(id, this.hostOf(id)); this.checkEnd(); }

  /** объединить столы, когда игроков меньше: ломаем стол, который сейчас между раздачами */
  private rebalance() {
    if (this.state !== 'RUNNING') return;
    const idle = (h: TableHost) => h.table.stage === 'WAITING' || h.table.stage === 'HAND_OVER';
    for (const h of this.tables) if (h.table.players().length === 0) this.closeTable(h);
    const need = Math.ceil(this.alive.size / 6);
    if (this.tables.length > need) {
      const breakable = this.tables.filter(idle).sort((a, b) => a.table.players().length - b.table.players().length)[0];
      if (breakable) {
        const others = this.tables.filter(t => t !== breakable);
        for (const p of [...breakable.table.players()]) {
          const target = others.sort((a, b) => a.table.players().length - b.table.players().length)[0];
          if (!target || target.table.freeSeat() < 0) break;
          const e = this.alive.get(p.id);
          if (!e) continue;
          const stack = p.stack;
          breakable.table.leave(p.id);
          this.sitAt(target, e, stack);
          if (!e.bot) this.ctx.toast(e.id, target === others[0] && this.tables.length - 1 === 1 ? 'Финальный стол! Вас пересадили' : `Столы объединяются — вы за столом ${this.tableNo(target)}`, true);
          target.kick();
        }
        if (breakable.table.players().length === 0) this.closeTable(breakable);
      }
    }
    // перекос: у одного стола на 3+ игрока больше — пересаживаем одного
    if (this.tables.length > 1) {
      const sorted = [...this.tables].sort((a, b) => b.table.players().length - a.table.players().length);
      const big = sorted[0], small = sorted[sorted.length - 1];
      if (big.table.players().length - small.table.players().length >= 3 && idle(big)) {
        const p = big.table.players().find(x => x.stack > 0);
        const e = p && this.alive.get(p.id);
        if (p && e) { const st = p.stack; big.table.leave(p.id); this.sitAt(small, e, st); if (!e.bot) this.ctx.toast(e.id, `Вас пересадили за стол ${this.tableNo(small)}`, true); small.kick(); big.kick(); }
      }
    }
    for (const t of this.tables) if (t.table.stage === 'WAITING') t.kick();
  }

  private closeTable(h: TableHost) {
    h.destroy();
    this.ctx.rooms.delete(h.table.id);
    this.tables = this.tables.filter(t => t !== h);
  }

  private checkEnd() {
    if (this.state !== 'RUNNING' || this.alive.size > 1) return;
    const [last] = [...this.alive.values()];
    if (last) { this.alive.delete(last.id); this.places.push({ place: 1, name: last.name, id: last.id, bot: last.bot }); }
    this.finish();
  }

  /** людей не осталось: оставшиеся боты делят места по фишкам */
  private finishBots() {
    const rest = [...this.alive.values()].map(e => ({ e, stack: this.hostOf(e.id)?.table.byId(e.id)?.stack ?? 0 })).sort((a, b) => a.stack - b.stack);
    for (const { e } of rest) { const place = this.alive.size; this.alive.delete(e.id); this.places.push({ place, name: e.name, id: e.id, bot: e.bot }); }
    this.finish();
  }

  private finish() {
    this.state = 'DONE';
    const top = [...this.places].sort((a, b) => a.place - b.place);
    this.results = top.slice(0, 5).map(p => ({ place: p.place, name: p.name, bot: p.bot }));
    // призы — только людям
    top.slice(0, 3).forEach((p, i) => {
      if (p.bot) return;
      const prize = TOURNEY.PRIZES[i];
      this.ctx.reward(p.id, prize.chips, prize.unlock, 0);
      const back = UNLOCKS.find(u => u.id === prize.unlock)?.name || '';
      this.ctx.out(p.id, `«${TOURNEY.NAME}»: ${p.place}-е место! Приз: ${prize.chips.toLocaleString('ru-RU')} фишек и ${back}`);
    });
    for (const t of [...this.tables]) this.closeTable(t);
    const w = top[0];
    if (w) this.ctx.announce(`«${TOURNEY.NAME}» окончена. Победитель — ${w.name}${w.bot ? ' (гость клуба)' : ''}`);
    this.startsAt = nextFriday(Date.now() + 60_000);
    this.startedAt = 0;
    this.save();
    // через минуту снова открыта запись
    setTimeout(() => { if (this.state === 'DONE') { this.state = 'REG'; this.ctx.broadcast(); } }, 60_000);
    this.ctx.broadcast();
  }
}
