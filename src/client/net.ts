// Подключение к игре. Онлайн — WebSocket к серверу клуба; офлайн — тот же движок прямо в браузере
// (тренировочный стол: лобби, боты по кнопке, для превью и при обрыве связи).

import type { ClientMsg, Profile, ServerMsg, TransferRecord } from '../shared/Catalog';
import { DEFAULT_OWNED, ITEM, toggleEquip, WHEEL, WHEEL_COOLDOWN, REFILL, SEASON, UNLOCKS, levelOf, seasonId, nextFriday } from '../shared/Catalog';
import type { OpenTable, TourneyInfo } from '../shared/Catalog';
import type { TableView } from '../shared/Table';
import { TableHost } from '../shared/TableHost';
import { browserRng } from '../shared/Cards';
import { Identity } from './identity';

export type Status = 'connecting' | 'online' | 'offline';
export interface HomeInfo { resume?: string; invite?: string }
export interface WheelResult { ok: boolean; index?: number; prize?: number; wheelAt?: number; text?: string }
export interface TablesInfo { online: number; tables: OpenTable[] }
export type AdminReply = Omit<Extract<ServerMsg, { t: 'ADMIN' }>, 't'>;

export interface Conn {
  readonly online: boolean;
  send(m: ClientMsg): void;
  onState(cb: (v: TableView) => void): void;
  onProfile(cb: (p: Profile) => void): void;
  onToast(cb: (text: string, ok?: boolean) => void): void;
  onStatus(cb: (s: Status) => void): void;
  onHome(cb: (h: HomeInfo) => void): void;
  onAuth(cb: () => void): void;
  onKicked(cb: () => void): void;
  onHistory(cb: (h: TransferRecord[]) => void): void;
  onTop(cb: (t: { name: string; profit: number }[]) => void): void;
  onWheel(cb: (w: WheelResult) => void): void;
  onTables(cb: (t: TablesInfo) => void): void;
  onTourney(cb: (t: TourneyInfo) => void): void;
  onAdmin(cb: (a: AdminReply) => void): void;
}

class Emitter {
  state: ((v: TableView) => void)[] = [];
  profile: ((p: Profile) => void)[] = [];
  toast: ((t: string, ok?: boolean) => void)[] = [];
  status: ((s: Status) => void)[] = [];
  home: ((h: HomeInfo) => void)[] = [];
  auth: (() => void)[] = [];
  kicked: (() => void)[] = [];
  history: ((h: TransferRecord[]) => void)[] = [];
  top: ((t: { name: string; profit: number }[]) => void)[] = [];
  wheel: ((w: WheelResult) => void)[] = [];
  tables: ((t: TablesInfo) => void)[] = [];
  tourney: ((t: TourneyInfo) => void)[] = [];
  admin: ((a: AdminReply) => void)[] = [];
}

abstract class Base implements Conn {
  abstract readonly online: boolean;
  protected e = new Emitter();
  abstract send(m: ClientMsg): void;
  onState(cb: (v: TableView) => void) { this.e.state.push(cb); }
  onProfile(cb: (p: Profile) => void) { this.e.profile.push(cb); }
  onToast(cb: (t: string, ok?: boolean) => void) { this.e.toast.push(cb); }
  onStatus(cb: (s: Status) => void) { this.e.status.push(cb); }
  onHome(cb: (h: HomeInfo) => void) { this.e.home.push(cb); }
  onAuth(cb: () => void) { this.e.auth.push(cb); }
  onKicked(cb: () => void) { this.e.kicked.push(cb); }
  onHistory(cb: (h: TransferRecord[]) => void) { this.e.history.push(cb); }
  onTop(cb: (t: { name: string; profit: number }[]) => void) { this.e.top.push(cb); }
  onWheel(cb: (w: WheelResult) => void) { this.e.wheel.push(cb); }
  onTables(cb: (t: TablesInfo) => void) { this.e.tables.push(cb); }
  onTourney(cb: (t: TourneyInfo) => void) { this.e.tourney.push(cb); }
  onAdmin(cb: (a: AdminReply) => void) { this.e.admin.push(cb); }
}

// ───────────────────────── онлайн ─────────────────────────

export class OnlineConn extends Base {
  readonly online = true;
  private ws: WebSocket | null = null;
  private retry = 0;
  private outbox: ClientMsg[] = [];
  private authFailed = false;
  private lastMsg = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private url: string, private failed?: () => void) {
    super();
    this.open();
    // связь вернулась / вкладку снова открыли — переподключаемся сразу, не дожидаясь таймера
    const now = () => { if (this.authFailed) return; const st = this.ws?.readyState; if (st === WebSocket.CLOSED || st === WebSocket.CLOSING || (st === WebSocket.OPEN && Date.now() - this.lastMsg > 25_000)) this.reopen(); };
    addEventListener('online', now);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) now(); });
    // пульс: сервер отвечает PONG; тишина 25 с — соединение мёртвое, открываем новое
    setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastMsg > 25_000) { this.reopen(); return; }
      this.ws.send(JSON.stringify({ t: 'PING' }));
    }, 10_000);
  }

  private reopen() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const old = this.ws;
    if (old) { old.onclose = null; old.onmessage = null; try { old.close(); } catch { /* */ } }
    this.retry = 0;
    this.open();
  }

  private open() {
    this.timer = null;
    this.e.status.forEach(f => f('connecting'));
    const ws = new WebSocket(this.url);
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.retry = 0;
      this.lastMsg = Date.now();
      this.e.status.forEach(f => f('online'));
      for (const m of this.outbox.splice(0)) ws.send(JSON.stringify(m));
    };
    ws.onmessage = (ev) => {
      this.lastMsg = Date.now();
      const m = JSON.parse(ev.data) as ServerMsg;
      if (m.t === 'PONG') return;
      if (m.t === 'STATE') this.e.state.forEach(f => f(m.view));
      else if (m.t === 'PROFILE') this.e.profile.forEach(f => f(m.profile));
      else if (m.t === 'TOAST') this.e.toast.forEach(f => f(m.text, m.ok));
      else if (m.t === 'ERROR') this.e.toast.forEach(f => f(m.text, false));
      else if (m.t === 'HOME') this.e.home.forEach(f => f({ resume: m.resume, invite: m.invite }));
      else if (m.t === 'AUTH') { this.authFailed = true; this.e.auth.forEach(f => f()); }
      else if (m.t === 'KICKED') { this.authFailed = true; this.e.kicked.forEach(f => f()); }
      else if (m.t === 'HISTORY') this.e.history.forEach(f => f(m.items));
      else if (m.t === 'TOP') this.e.top.forEach(f => f(m.top));
      else if (m.t === 'WHEEL') this.e.wheel.forEach(f => f(m));
      else if (m.t === 'TABLES') this.e.tables.forEach(f => f({ online: m.online, tables: m.tables }));
      else if (m.t === 'TOURNEY') this.e.tourney.forEach(f => f(m.info));
      else if (m.t === 'ADMIN') this.e.admin.forEach(f => f(m));
    };
    ws.onclose = () => {
      if (this.authFailed) return;
      this.e.status.forEach(f => f('offline'));
      if (!opened && this.retry >= 2 && this.failed) { this.failed(); this.failed = undefined; return; }
      // первая попытка почти сразу, дальше реже
      const delay = [150, 500, 1200, 2500][this.retry++] ?? 4000;
      this.timer = setTimeout(() => this.open(), delay);
    };
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    else if (m.t !== 'ACTION') this.outbox.push(m);
  }
}

// ───────────────────────── офлайн ─────────────────────────

const LS = 'pn.offline.v2';
const BLINDS: [number, number][] = [[25, 50], [100, 200], [500, 1000]];

export class OfflineConn extends Base {
  readonly online = false;
  private host: TableHost | null = null;
  private unsub: () => void = () => {};
  private profile: Profile;
  private meId = 'me';
  private tableStack = 0;
  private lastBonus = 0;
  private brokeAt = 0;

  constructor() {
    super();
    this.profile = this.load();
    // фишки, оставшиеся на столе с прошлого визита, возвращаются на баланс
    this.profile.balance += this.tableStack;
    this.tableStack = 0;
    this.save();
    setInterval(() => { if (this.refill()) this.pushProfile(); }, 30_000);
    this.refill();
    queueMicrotask(() => {
      this.e.status.forEach(f => f('offline'));
      this.pushProfile();
      this.e.home.forEach(f => f({}));
    });
  }

  private load(): Profile {
    try {
      const raw = JSON.parse(localStorage.getItem(LS) || 'null');
      if (raw?.profile) {
        if (!Array.isArray(raw.profile.equipped?.items)) raw.profile.equipped = { items: [] };
        raw.profile.owned = (raw.profile.owned || []).filter((id: string) => ITEM[id]); this.tableStack = raw.tableStack || 0; this.lastBonus = raw.lastBonus || 0; this.brokeAt = raw.brokeAt || 0;
        raw.profile.wheelAt = this.lastBonus ? this.lastBonus + WHEEL_COOLDOWN : 0; return raw.profile; }
    } catch { /* */ }
    return {
      id: 'me', name: Identity.name || 'Вы', balance: 15000, refCode: 'TRAIN', code: 'QWX-TRAIN1',
      owned: [...DEFAULT_OWNED], equipped: { items: [] },
    };
  }

  private save() {
    try { localStorage.setItem(LS, JSON.stringify({ profile: this.profile, tableStack: this.tableStack, lastBonus: this.lastBonus, brokeAt: this.brokeAt })); } catch { /* */ }
  }

  /** фишки кончились: через 30 минут заведение угощает 1 000 (как на сервере) */
  private refill(): boolean {
    const total = this.profile.balance + (this.host ? this.tableStack : 0);
    if (total >= REFILL.BELOW) { this.brokeAt = 0; return false; }
    if (this.host && this.tableStack > 0) return false;
    if (!this.brokeAt) { this.brokeAt = Date.now(); this.save(); return false; }
    if (Date.now() - this.brokeAt < REFILL.WAIT) return false;
    this.profile.balance += REFILL.AMOUNT;
    this.brokeAt = 0;
    this.save();
    this.toast(`Заведение угощает: +${REFILL.AMOUNT.toLocaleString('ru-RU')} фишек`, true);
    return true;
  }
  private brokeText() {
    const left = this.brokeAt ? Math.max(1, Math.ceil((this.brokeAt + REFILL.WAIT - Date.now()) / 60_000)) : 0;
    return left ? `Фишки кончились. Через ${left} мин. заведение угостит ${REFILL.AMOUNT.toLocaleString('ru-RU')} фишками — или покрути колесо фортуны` : 'Не хватает фишек — покрути колесо фортуны в меню';
  }
  private addXp(n: number) {
    const p = this.profile;
    const sid = seasonId();
    const extra = p as Profile & { seasonClaimed?: number };
    if (p.season !== sid) { p.season = sid; p.xp = 0; extra.seasonClaimed = 1; }
    p.xp = (p.xp || 0) + n;
    const lvl = levelOf(p.xp);
    for (let l = (extra.seasonClaimed || 1) + 1; l <= lvl; l++) {
      const r = SEASON.REWARDS[l];
      this.toast(`Сезонный пропуск: уровень ${l}!`, true);
      if (r?.chips) { p.balance += r.chips; this.toast(`Награда: +${r.chips.toLocaleString('ru-RU')} фишек`, true); }
      if (r?.unlock && !(p.unlocks ||= []).includes(r.unlock)) { p.unlocks.push(r.unlock); this.toast(`Награда: ${UNLOCKS.find(x => x.id === r.unlock)?.name}`, true); }
    }
    extra.seasonClaimed = Math.max(extra.seasonClaimed || 1, lvl);
  }

  private pushProfile() {
    this.profile.refillAt = this.brokeAt ? this.brokeAt + REFILL.WAIT : 0;
    this.e.profile.forEach(f => f({ ...this.profile, owned: [...this.profile.owned], equipped: { items: [...this.profile.equipped.items] } }));
  }
  private toast(t: string, ok?: boolean) { this.e.toast.forEach(f => f(t, ok)); }

  private create(sb: number, bb: number): boolean {
    this.leave(false);
    const host = new TableHost({
      id: 'TRAIN', sb, bb, rng: browserRng(), turnMs: 30000, owner: this.meId, isPrivate: true,
      invite: Identity.inviteLink('TRAIN'),
      onHandEnd: r => {
        this.tableStack = host.table.byId(this.meId)?.stack ?? 0;
        const st = this.profile.stats ||= { hands: 0, wins: 0, biggestPot: 0, refs: 0 };
        st.hands++;
        const won = (r.deltas.get(this.meId) ?? 0) > 0;
        if (won) { st.wins++; st.biggestPot = Math.max(st.biggestPot, r.potTotal); }
        if (r.humans.includes(this.meId)) this.addXp(SEASON.XP_HAND + (won ? SEASON.XP_WIN : 0));
        this.pushProfile();
        this.save();
      },
    });
    this.refill();
    const buyIn = Math.min(bb * 100, this.profile.balance);
    if (buyIn < bb * 20) {
      host.destroy();
      this.refill();
      this.pushProfile();
      this.toast(this.brokeText(), false);
      this.e.home.forEach(f => f({}));
      return false;
    }
    this.host = host;
    this.profile.balance -= buyIn;
    this.tableStack = buyIn;
    this.save();
    this.pushProfile();
    host.join(this.meId, this.profile.name, buyIn, 'RING_GOLD', this.profile.equipped.items);
    this.unsub = host.subscribe(this.meId, v => {
      this.tableStack = v.seats[v.mySeat]?.stack ?? this.tableStack;
      this.e.state.forEach(f => f(v));
    });
    return true;
  }

  private leave(goHome = true) {
    if (!this.host) return;
    this.unsub();
    const p = this.host.table.byId(this.meId);
    this.profile.balance += p?.stack ?? this.tableStack;
    this.tableStack = 0;
    this.host.destroy();
    this.host = null;
    this.save();
    this.pushProfile();
    if (goHome) this.e.home.forEach(f => f({}));
  }

  send(m: ClientMsg) {
    const host = this.host;
    switch (m.t) {
      case 'CREATE': {
        const [sb, bb] = BLINDS.find(([s]) => s === m.sb) || BLINDS[0];
        this.create(sb, bb);
        break;
      }
      case 'QUICK': {
        const [sb, bb] = BLINDS.find(([s]) => s === m.sb) || BLINDS[0];
        if (!this.create(sb, bb)) break;
        for (let i = 0; i < 5; i++) this.host!.addBot();
        this.host!.start();
        break;
      }
      case 'JOIN': this.toast('Сервер клуба недоступен — играем тренировочный стол', false); break;
      case 'TRANSFER': this.toast('Переводы работают только онлайн, с входом через Telegram', false); break;
      case 'BONUS':
      case 'WHEEL': {
        const next = this.lastBonus + WHEEL_COOLDOWN;
        if (next > Date.now()) { this.e.wheel.forEach(f => f({ ok: false, wheelAt: next, text: `Колесо снова через ${Math.ceil((next - Date.now()) / 3600_000)} ч.` })); break; }
        const total = WHEEL.reduce((a, x) => a + x.w, 0);
        let rr = Math.floor(Math.random() * total), index = 0;
        for (; index < WHEEL.length; index++) { rr -= WHEEL[index].w; if (rr < 0) break; }
        const prize = WHEEL[index].v;
        this.lastBonus = Date.now();
        this.profile.balance += prize;
        this.profile.wheelAt = this.lastBonus + WHEEL_COOLDOWN;
        this.save();
        this.e.wheel.forEach(f => f({ ok: true, index, prize, wheelAt: this.profile.wheelAt }));
        setTimeout(() => this.pushProfile(), 5200);
        break;
      }
      case 'TABLES': this.e.tables.forEach(f => f({ online: 1, tables: [] })); break;
      case 'TOURNEY': this.e.tourney.forEach(f => f({ state: 'REG', startsAt: nextFriday(), registered: 0, me: false })); break;
      case 'TOURNEY_REG': this.toast('Турнир проходит онлайн — нужен вход через Telegram', false); break;
      case 'ADMIN': this.e.admin.forEach(f => f({ ok: false, text: 'Админ-панель работает только онлайн' })); break;
      case 'PING': break;
      case 'REF': break;
      case 'TOP': this.e.top.forEach(f => f([])); break;
      case 'RENAME': this.profile.name = m.name.slice(0, 20); this.save(); this.pushProfile(); break;
      case 'ADD_BOT': if (host && !host.addBot()) this.toast('Свободных мест нет', false); break;
      case 'REMOVE_BOT': host?.removeBot(); break;
      case 'START': if (host && !host.start()) this.toast('Нужно хотя бы два игрока — посади бота', false); break;
      case 'LEAVE': this.leave(); break;
      case 'ACTION': host?.action(this.meId, m.action, m.amount); break;
      case 'REVEAL': host?.reveal(this.meId, m.which); break;
      case 'REBUY': {
        if (!host) break;
        const bb = host.table.bb;
        if (this.profile.balance < bb * 20) { this.tableStack = 0; this.refill(); }
        if (this.profile.balance < bb * 20) { this.pushProfile(); this.toast(this.brokeText(), false); break; }
        const take = Math.min(bb * 100, this.profile.balance);
        if (host.rebuy(this.meId, take)) {
          this.profile.balance -= take;
          this.tableStack = take;
          this.save();
          this.pushProfile();
        }
        break;
      }
      case 'SHOP': {
        const it = ITEM[m.itemId];
        if (!it) return;
        const p = this.profile;
        if (!p.owned.includes(it.id)) {
          if (p.balance < it.price) { this.toast(`Не хватает фишек: нужно ${it.price.toLocaleString('ru-RU')}`, false); return; }
          p.balance -= it.price;
          p.owned.push(it.id);
          p.equipped.items = toggleEquip(p.equipped.items, it.id);
          this.toast(`Куплено: ${it.name} — уже на столе`, true);
        } else {
          p.equipped.items = toggleEquip(p.equipped.items, it.id);
        }
        host?.setItems(this.meId, p.equipped.items);
        this.save();
        this.pushProfile();
        break;
      }
    }
  }
}

/** Онлайн с автоматическим переходом на тренировочный стол, если сервер недоступен. */
export class AutoConn extends Base {
  private inner: Conn;
  get online() { return this.inner.online; }

  /** allowOffline=false — вход через Google обязателен: без сервера не играем */
  constructor(url: string | null, private allowOffline = true) {
    super();
    this.inner = url ? new OnlineConn(url, allowOffline ? () => this.fallback() : undefined) : new OfflineConn();
    this.attach(this.inner);
  }

  private attach(c: Conn) {
    c.onState(v => { if (c === this.inner) this.e.state.forEach(f => f(v)); });
    c.onProfile(p => { if (c === this.inner) this.e.profile.forEach(f => f(p)); });
    c.onToast((t, ok) => { if (c === this.inner) this.e.toast.forEach(f => f(t, ok)); });
    c.onStatus(s => { if (c === this.inner) this.e.status.forEach(f => f(s)); });
    c.onHome(h => { if (c === this.inner) this.e.home.forEach(f => f(h)); });
    c.onAuth(() => { if (c === this.inner) this.e.auth.forEach(f => f()); });
    c.onKicked(() => { if (c === this.inner) this.e.kicked.forEach(f => f()); });
    c.onHistory(h => { if (c === this.inner) this.e.history.forEach(f => f(h)); });
    c.onTop(t => { if (c === this.inner) this.e.top.forEach(f => f(t)); });
    c.onWheel(w => { if (c === this.inner) this.e.wheel.forEach(f => f(w)); });
    c.onTables(t => { if (c === this.inner) this.e.tables.forEach(f => f(t)); });
    c.onTourney(t => { if (c === this.inner) this.e.tourney.forEach(f => f(t)); });
    c.onAdmin(a => { if (c === this.inner) this.e.admin.forEach(f => f(a)); });
  }

  private fallback() {
    if (!this.allowOffline) { this.e.toast.forEach(f => f('Сервер клуба недоступен — пробуем снова…', false)); return; }
    this.inner = new OfflineConn();
    this.attach(this.inner);
    this.e.toast.forEach(f => f('Сервер клуба недоступен — тренировочный стол', false));
  }

  send(m: ClientMsg) { this.inner.send(m); }
}
