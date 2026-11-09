// Экономика клуба: профили, баланс, бонусы, переводы с антифродом, бутик, ладдер с перстнями.
// Хранение — JSON-файлы с атомарной записью (tmp + rename) и отложенным сохранением.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_EQUIPPED, DEFAULT_OWNED, Equipped, ITEM, Profile, toggleEquip, WHEEL, WHEEL_COOLDOWN, REF_BONUS } from '../shared/Catalog';
import * as crypto from 'node:crypto';

// папка с балансами и аккаунтами; на хостинге — постоянный диск (DATA_DIR)
const DATA = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA, { recursive: true });

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf-8')) as T; } catch { return fallback; }
}
function writeJson(file: string, data: unknown) {
  const p = path.join(DATA, file);
  fs.writeFileSync(p + '.tmp', JSON.stringify(data, null, 1));
  fs.renameSync(p + '.tmp', p);
}

/** короткий код приглашения игрока (детерминированный, из id) */
export function refCode(id: string) {
  return crypto.createHash('sha256').update('ref:' + id).digest('hex').slice(0, 6).toUpperCase();
}

export interface User {
  id: string;            // Telegram ID
  name: string;          // имя для стола
  username: string;      // @username без @
  balance: number;
  tableStack: number;    // фишки, сейчас лежащие на столе
  createdAt: number;
  handsPlayed: number;
  lastBonusAt: number;
  recentOpponents: Record<string, number>;
  owned: string[];
  equipped: Equipped;
  wins?: number;
  biggestPot?: number;
  refBy?: string;
  refs?: number;
  wheelAt?: number;
}

export const ECONOMY = {
  START: 15000,
  BONUS: 1000,
  BONUS_COOLDOWN: 24 * 3600_000,
  FEE: 0.05,
  MIN_TRANSFER: 100,
  TRANSFER_AGE: 48 * 3600_000,
  TRANSFER_HANDS: 50,
  SAME_TABLE_BLOCK: 7 * 24 * 3600_000,
};

class Store {
  private users = new Map<string, User>();
  private timer: NodeJS.Timeout | null = null;
  private busy = new Set<string>();
  /** журнал переводов (data/transfers.json) — история в окне перевода */
  private log: { at: number; from: string; to: string; fromName: string; toName: string; amount: number; fee: number }[] = readJson('transfers.json', []);

  history(id: string) {
    return this.log.filter(r => r.from === id || r.to === id).slice(-25).reverse().map(r => ({
      at: r.at, amount: r.amount, fee: r.fee,
      dir: (r.from === id ? 'out' : 'in') as 'in' | 'out',
      from: r.fromName, to: r.toName,
    }));
  }

  constructor() {
    for (const u of readJson<User[]>('users.json', [])) this.users.set(u.id, u);
    // фишки, зависшие на столах при перезапуске сервера, возвращаются на баланс
    let refunded = 0;
    for (const u of this.users.values()) {
      if (u.tableStack > 0) { u.balance += u.tableStack; refunded += u.tableStack; u.tableStack = 0; }
      u.owned ??= [...DEFAULT_OWNED];
      if (!u.equipped || !Array.isArray((u.equipped as Equipped).items)) u.equipped = { ...DEFAULT_EQUIPPED, items: [] };
      u.owned = (u.owned || []).filter(id => ITEM[id]);
    }
    if (refunded) { console.log(`↩︎ Возвращено со столов после перезапуска: ${refunded}`); this.flush(); }
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 400);
  }
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    writeJson('users.json', [...this.users.values()]);
  }

  get(id: string) { return this.users.get(id); }

  getOrCreate(id: string, name: string, username: string): User {
    let u = this.users.get(id);
    if (!u) {
      u = {
        id, name: name || username || 'Гость', username, balance: ECONOMY.START, tableStack: 0,
        createdAt: Date.now(), handsPlayed: 0, lastBonusAt: 0, recentOpponents: {},
        owned: [...DEFAULT_OWNED], equipped: { items: [] },
      };
      this.users.set(id, u);
      this.save();
    } else if ((name && u.name !== name) || (username && u.username !== username)) {
      if (name) u.name = name;
      if (username) u.username = username;
      this.save();
    }
    return u;
  }

  profile(u: User): Profile {
    return {
      id: u.id, name: u.name, balance: u.balance, owned: [...u.owned], equipped: { items: [...u.equipped.items] }, username: u.username || undefined,
      stats: { hands: u.handsPlayed, wins: u.wins || 0, biggestPot: u.biggestPot || 0, refs: u.refs || 0 },
      refCode: refCode(u.id),
      wheelAt: Math.max(0, (u.wheelAt || 0) + WHEEL_COOLDOWN - Date.now()) ? (u.wheelAt || 0) + WHEEL_COOLDOWN : 0,
    };
  }

  /** Колесо фортуны: раз в сутки, приз выбирается по весам секторов. */
  spinWheel(id: string): { ok: boolean; index?: number; prize?: number; wheelAt?: number; text?: string } {
    const u = this.users.get(id);
    if (!u) return { ok: false, text: 'Сначала войдите в клуб' };
    const next = (u.wheelAt || 0) + WHEEL_COOLDOWN;
    if (next > Date.now()) return { ok: false, wheelAt: next, text: `Колесо снова через ${Math.ceil((next - Date.now()) / 3600_000)} ч.` };
    const total = WHEEL.reduce((s, x) => s + x.w, 0);
    let r = crypto.randomInt(0, total), index = 0;
    for (; index < WHEEL.length; index++) { r -= WHEEL[index].w; if (r < 0) break; }
    const prize = WHEEL[index].v;
    u.balance += prize;
    u.wheelAt = Date.now();
    this.save();
    return { ok: true, index, prize, wheelAt: u.wheelAt + WHEEL_COOLDOWN };
  }

  /** Реферал: новичок, пришедший по ссылке, и пригласивший получают по REF_BONUS. Только один раз и только для новых аккаунтов. */
  applyRef(id: string, code: string): { ok: boolean; text: string; inviter?: string } {
    const u = this.users.get(id);
    const c = code.trim().toUpperCase();
    if (!u || !c) return { ok: false, text: '' };
    if (u.refBy) return { ok: false, text: '' };
    if (u.handsPlayed > 0 || Date.now() - u.createdAt > 24 * 3600_000) return { ok: false, text: 'Бонус за приглашение — только для новых игроков' };
    const inviter = [...this.users.values()].find(x => refCode(x.id) === c);
    if (!inviter || inviter.id === u.id) return { ok: false, text: '' };
    u.refBy = inviter.id;
    u.balance += REF_BONUS;
    inviter.balance += REF_BONUS;
    inviter.refs = (inviter.refs || 0) + 1;
    this.save();
    return { ok: true, inviter: inviter.id, text: `Подарок за приглашение: +${REF_BONUS.toLocaleString('ru-RU')} фишек вам и ${inviter.username ? '@' + inviter.username : inviter.name}` };
  }

  /** Перевод баланса → стол. */
  buyIn(u: User, want: number, min: number): number {
    const amount = Math.min(want, u.balance);
    if (amount < min) return 0;
    u.balance -= amount;
    u.tableStack += amount;
    this.save();
    return amount;
  }

  cashOut(u: User, amount: number) {
    u.balance += amount;
    u.tableStack = 0;
    this.save();
  }

  /** Купить предмет (он сразу ложится на стол) или убрать/вернуть уже купленный. */
  shop(u: User, itemId: string): { ok: boolean; text: string } {
    const it = ITEM[itemId];
    if (!it) return { ok: false, text: 'Такого предмета нет' };
    if (!u.owned.includes(it.id)) {
      if (u.balance < it.price) return { ok: false, text: `Не хватает фишек: нужно ${it.price.toLocaleString('ru-RU')}` };
      u.balance -= it.price;
      u.owned.push(it.id);
      u.equipped.items = toggleEquip(u.equipped.items, it.id);
      this.save();
      return { ok: true, text: `Куплено: ${it.name} — уже на столе` };
    }
    const on = u.equipped.items.includes(it.id);
    u.equipped.items = toggleEquip(u.equipped.items, it.id);
    this.save();
    return { ok: true, text: on ? `${it.name} убран со стола` : `${it.name} на столе` };
  }

  bonus(id: string): string {
    const u = this.users.get(id);
    if (!u) return 'Сначала нажми /start';
    const left = u.lastBonusAt + ECONOMY.BONUS_COOLDOWN - Date.now();
    if (left > 0) return `⏳ Следующий бонус через ${Math.ceil(left / 3600_000)} ч.`;
    u.balance += ECONOMY.BONUS;
    u.lastBonusAt = Date.now();
    this.save();
    return `🥃 +${ECONOMY.BONUS.toLocaleString('ru-RU')} фишек. Баланс: ${u.balance.toLocaleString('ru-RU')}`;
  }

  findByUsername(name: string) {
    const n = name.replace(/^@/, '').toLowerCase();
    for (const u of this.users.values()) if (u.username.toLowerCase() === n) return u;
    return undefined;
  }

  /**
   * Перевод фишек по Telegram @username. Атомарно (на время операции отправитель заблокирован),
   * комиссия клуба 5% сжигается — это гасит «перекачку» фишек между своими аккаунтами.
   */
  transfer(fromId: string, toName: string, amount: number): { ok: boolean; text: string; to?: string } {
    if (this.busy.has(fromId)) return { ok: false, text: 'Операция уже выполняется' };
    this.busy.add(fromId);
    try {
      const a = this.users.get(fromId);
      const name = toName.trim().replace(/^@/, '');
      const b = this.findByUsername(name);
      if (!a) return { ok: false, text: 'Сначала войдите в клуб' };
      if (!/^[A-Za-z0-9_]{3,32}$/.test(name)) return { ok: false, text: 'Укажите Telegram-юзернейм, например @ivan_petrov' };
      if (!b) return { ok: false, text: `@${name} ещё не входил в клуб через Telegram` };
      if (a.id === b.id) return { ok: false, text: 'Себе переводить нельзя' };
      if (!Number.isInteger(amount) || amount < ECONOMY.MIN_TRANSFER) return { ok: false, text: `Минимум — ${ECONOMY.MIN_TRANSFER.toLocaleString('ru-RU')} фишек` };
      if (a.balance < amount) return { ok: false, text: `Не хватает фишек. Баланс: ${a.balance.toLocaleString('ru-RU')}` };
      const fee = Math.floor(amount * ECONOMY.FEE);
      a.balance -= amount;
      b.balance += amount - fee;
      this.log.push({ at: Date.now(), from: a.id, to: b.id, fromName: a.username || a.name, toName: b.username || b.name, amount, fee });
      if (this.log.length > 5000) this.log.splice(0, this.log.length - 5000);
      writeJson('transfers.json', this.log);
      this.save();
      return { ok: true, to: b.id, text: `Отправлено @${b.username}: ${(amount - fee).toLocaleString('ru-RU')} (комиссия клуба ${fee.toLocaleString('ru-RU')})` };
    } finally {
      this.busy.delete(fromId);
    }
  }

  recordHand(ids: string[], stacks: Map<string, number>, deltas?: Map<string, number>, pot = 0) {
    const now = Date.now();
    for (const id of ids) {
      const u = this.users.get(id);
      if (!u) continue;
      u.handsPlayed++;
      if ((deltas?.get(id) ?? 0) > 0) { u.wins = (u.wins || 0) + 1; u.biggestPot = Math.max(u.biggestPot || 0, pot); }
      if (stacks.has(id)) u.tableStack = stacks.get(id)!;
      for (const o of ids) if (o !== id) u.recentOpponents[o] = now;
      // чистим старые записи
      for (const [k, t] of Object.entries(u.recentOpponents)) if (now - t > ECONOMY.SAME_TABLE_BLOCK) delete u.recentOpponents[k];
    }
    this.save();
  }

  grantRing(id: string, ring: string) {
    const u = this.users.get(id);
    if (!u) return;
    if (!u.owned.includes(ring)) u.owned.push(ring);
    this.save();
  }
}

export const store = new Store();

// ───────────────────────── Ладдер месяца ─────────────────────────

interface LadderEntry { id: string; name: string; profit: number; won: number }
interface LadderState { month: string; entries: Record<string, LadderEntry>; history: { month: string; top: LadderEntry[] }[] }

const monthKey = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

class Ladder {
  private s: LadderState = readJson<LadderState>('ladder.json', { month: monthKey(), entries: {}, history: [] });

  /** 1-го числа: награды топ-10 и сброс. Топ-1 — Платиновый оникс, 2–3 — Рубин, 4–10 — Золотая печатка. */
  rollover() {
    if (this.s.month === monthKey()) return;
    const top = this.top();
    top.forEach((e, i) => {
      if (e.profit <= 0) return;
      store.grantRing(e.id, i === 0 ? 'RING_ONYX' : i < 3 ? 'RING_RUBY' : 'RING_GOLD');
    });
    this.s.history.push({ month: this.s.month, top });
    this.s.month = monthKey();
    this.s.entries = {};
    writeJson('ladder.json', this.s);
  }

  record(id: string, name: string, delta: number) {
    this.rollover();
    const e = (this.s.entries[id] ??= { id, name, profit: 0, won: 0 });
    e.name = name;
    e.profit += delta;
    if (delta > 0) e.won++;
    writeJson('ladder.json', this.s);
  }

  top(): LadderEntry[] {
    return Object.values(this.s.entries).sort((a, b) => b.profit - a.profit).slice(0, 10);
  }
}

export const ladder = new Ladder();
