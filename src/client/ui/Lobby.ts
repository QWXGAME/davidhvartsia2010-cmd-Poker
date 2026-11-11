// Лобби: свой стол, приглашение друзей (ссылка / @username), боты — только по кнопке хозяина.

import type { LobbyInfo, TableView } from '../../shared/Table';
import type { ClientMsg, Profile } from '../../shared/Catalog';
import { Telegram } from '../telegram';
import { Identity } from '../identity';
import type { HomeInfo } from '../net';
import { ICON } from './Menu';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
};
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const BLINDS: [number, number][] = [[25, 50], [100, 200], [500, 1000]];

export class Lobby {
  private el = h('div', 'lobby');
  private mode: 'home' | 'room' | 'none' = 'none';
  private blinds = 25;
  private profile: Profile | null = null;
  private info: LobbyInfo | null = null;
  private myId = '';
  private lastKey = '';
  private topBox = h('div', 'lobby-top');

  showTop(top: { name: string; profit: number }[]) {
    this.topBox.innerHTML = top.length
      ? top.map((e, i) => `<div><i>${i + 1}</i><b>${esc(e.name)}</b><span>${e.profit >= 0 ? '+' : ''}${fmt(e.profit)}</span></div>`).join('')
      : '<div class="none">В этом месяце ещё никто не играл</div>';
    this.topBox.classList.add('open');
  }

  constructor(private send: (m: ClientMsg) => void, private tap: () => void, private online: () => boolean, private toast: (t: string, ok?: boolean) => void) {
    document.body.appendChild(this.el);
  }

  setProfile(p: Profile) {
    this.profile = p;
    this.myId = p.id;
    if (this.mode === 'home') this.renderHome();
  }

  signedIn = false;
  /** открыть пункт общего меню (колесо, столы, приглашение) */
  onOpen?: (k: 'wheel' | 'tables' | 'ref' | 'tourney' | 'season') => void;
  private onlineCount = 0;
  private liveEl: HTMLElement | null = null;
  setOnline(n: number) {
    this.onlineCount = n;
    const s = this.liveEl?.querySelector('span');
    if (s && this.online()) s.innerHTML = `Сейчас в клубе: <b>${fmt(n)}</b>`;
  }
  get isHome() { return this.mode === 'home'; }
  onTransfer?: () => void;
  /** лобби закрылось — игрок за столом (запускаем «осмотр зала») */
  onEnterTable?: () => void;
  onSignOut?: () => void;
  private homeInfo: HomeInfo = {};

  showHome(h: HomeInfo = {}) {
    this.mode = 'home';
    this.info = null;
    this.lastKey = '';
    this.homeInfo = h;
    this.el.innerHTML = '';   // новое появление лобби — с анимацией
    this.renderHome();
  }

  /** обновление из состояния стола: пока игра не началась — экран ожидания */
  update(v: TableView) {
    const info = v.lobby;
    if (!info) return;
    this.info = info;
    if (v.mySeat >= 0) this.myId = v.seats[v.mySeat]!.id;
    if (info.started) {
      if (this.mode !== 'none') { this.mode = 'none'; this.el.classList.remove('open'); this.onVisible?.(false); this.onEnterTable?.(); }
      return;
    }
    this.mode = 'room';
    const key = JSON.stringify(info);
    if (key !== this.lastKey) { this.lastKey = key; this.renderRoom(); }
  }

  get visible() { return this.mode !== 'none'; }

  // ───────────────────────── главный экран ─────────────────────────

  private renderHome() {
    const p = this.profile;
    // повторная отрисовка (пришёл баланс, имя) — без анимации появления, чтобы карточка не «вспыхивала»
    const again = !!this.el.querySelector('.lobby-card.home');
    this.el.innerHTML = '';
    const card = h('div', 'lobby-card home' + (again ? ' static' : ''));
    const initial = (Identity.name || p?.name || 'Q').trim().charAt(0).toUpperCase();
    card.innerHTML = `
      <div class="lh-brand st">
        <div class="lh-suits"><i>♠</i><i class="r">♥</i><i>♣</i><i class="r">♦</i></div>
        <h1><span>Q</span><span>W</span><span>X</span><em>POKER</em></h1>
        <p>закрытый клуб</p>
      </div>
      <div class="lh-profile st">
        <div class="lh-ava">${esc(initial)}</div>
        <div class="lh-who"><input class="lh-name" maxlength="20" placeholder="Ваше имя за столом" /><span>${p?.username ? '@' + esc(p.username) : 'игрок клуба'}</span></div>
        <div class="lh-bal"><i></i><b class="lh-num">${p ? fmt(p.balance) : '—'}</b></div>
      </div>`;
    const nameIn = card.querySelector('.lh-name') as HTMLInputElement;
    nameIn.value = Identity.name || (p && p.name !== 'Гость' && p.name !== 'Вы' ? p.name : '');
    nameIn.onchange = () => { const n = nameIn.value.trim(); if (n) { Identity.name = n; this.send({ t: 'RENAME', name: n }); } };
    const rename = () => { const n = nameIn.value.trim(); if (n && n !== Identity.name) { Identity.name = n; this.send({ t: 'RENAME', name: n }); } };

    // вернуться за стол / сесть по приглашению — самое важное, первым
    const back = this.homeInfo.resume || this.homeInfo.invite;
    if (back) {
      const b = h('button', 'lh-cta st', `<b>${this.homeInfo.resume ? '↩ Вернуться за стол' : '♠ Стол друга'}</b><small>код ${esc(back)}</small>`) as HTMLButtonElement;
      b.onclick = () => { this.tap(); this.send({ t: 'JOIN', room: back }); };
      card.append(b);
    }
    // блайнды — настоящие фишки
    const blinds = h('div', 'lh-blinds st');
    blinds.append(h('div', 'lh-label', 'Ставки стола'));
    const row = h('div', 'lh-chips');
    BLINDS.forEach(([sb, bb], i) => {
      const b = h('button', 'lh-chip c' + i + (sb === this.blinds ? ' on' : ''), `<span>${fmt(sb)}<i>/</i>${fmt(bb)}</span>`) as HTMLButtonElement;
      b.onclick = () => {
        this.blinds = sb; this.tap();
        row.querySelectorAll('.lh-chip').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
      };
      row.appendChild(b);
    });
    blinds.append(row);
    // главная кнопка
    const quick = h('button', 'lh-cta st', '<b>♠ Сыграть с ботами</b><small>мгновенный стол · 5 соперников</small>') as HTMLButtonElement;
    quick.onclick = () => { this.tap(); rename(); this.send({ t: 'QUICK', sb: this.blinds }); };
    // друзья: создать стол или войти по коду
    const friends = h('div', 'lh-friends st');
    const create = h('button', 'lh-tile', `<i>${ICON.invite}</i><b>Стол для друзей</b>`+'<small>ссылка и код приглашения</small>') as HTMLButtonElement;
    create.onclick = () => { this.tap(); rename(); this.send({ t: 'CREATE', sb: this.blinds, bb: this.blinds * 2 }); };
    const join = h('div', 'lh-join');
    const input = h('input') as HTMLInputElement;
    input.placeholder = 'КОД';
    input.maxLength = 6;
    input.autocapitalize = 'characters';
    input.spellcheck = false;
    const go = h('button', 'lh-go', '→') as HTMLButtonElement;
    go.onclick = () => { if (input.value.trim()) { this.tap(); this.send({ t: 'JOIN', room: input.value.trim() }); } };
    input.onkeydown = e => { if (e.key === 'Enter') go.click(); };
    input.oninput = () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); join.classList.toggle('ready', input.value.length >= 4); };
    join.append(input, go);
    friends.append(create, join);
    // быстрые плитки
    const tiles = h('div', 'lh-tiles st');
    const tile = (icon: string, label: string, fn: () => void) => {
      const t = h('button', 'lh-mini', `<i>${icon}</i><span>${label}</span>`) as HTMLButtonElement;
      t.onclick = () => { this.tap(); fn(); };
      return t;
    };
    tiles.append(
      tile(ICON.wheel, 'Колесо фортуны', () => this.onOpen?.('wheel')),
      tile(ICON.moon, 'Ночь пятницы', () => this.onOpen?.('tourney')),
      tile(ICON.ticket, 'Сезон', () => this.onOpen?.('season')),
    );
    // счётчик людей в клубе — обновляется раз в 15 секунд
    const live = h('button', 'lh-live st', `<i></i><span>${this.onlineCount ? `Сейчас в клубе: <b>${fmt(this.onlineCount)}</b>` : this.online() ? 'Клуб открыт' : 'Тренировочный режим'}</span><small>столы →</small>`) as HTMLButtonElement;
    live.onclick = () => { this.tap(); this.onOpen?.('tables'); };
    this.liveEl = live;
    const note = h('div', 'lh-note st', this.online()
      ? 'Позови друзей ссылкой — ботов можно посадить на свободные места.'
      : 'Сервер клуба недоступен — играем тренировочный стол с ботами.');
    card.append(live, blinds, quick, friends, tiles, note);
    // фишки кончились — обратный отсчёт до угощения заведения (текст обновляет меню раз в секунду)
    if (p?.refillAt) live.after(h('div', 'qm-refill lh-refill st', ''));
    // плавное появление блоков по очереди
    card.querySelectorAll('.st').forEach((el, i) => ((el as HTMLElement).style.animationDelay = `${0.08 + i * 0.07}s`));
    this.el.append(card);
    this.el.classList.add('open');
    this.onVisible?.(true);
    // баланс «досчитывается» до значения
    const num = card.querySelector('.lh-num') as HTMLElement;
    if (p) {
      const to = p.balance, from = this.shownBal ?? Math.max(0, to - Math.min(to, 2500));
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / 900), e = 1 - Math.pow(1 - k, 3);
        num.textContent = fmt(Math.round(from + (to - from) * e));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      this.shownBal = to;
    }
  }
  private shownBal: number | null = null;
  /** лобби показано/скрыто — сцена позади медленно облетает стол */
  onVisible?: (v: boolean) => void;

  // ───────────────────────── ожидание за столом ─────────────────────────

  private renderRoom() {
    const info = this.info!;
    const owner = info.owner === this.myId;
    const seats = [...info.players].sort((a, b) => a.seat - b.seat);
    this.el.innerHTML = '';
    const card = h('div', 'lobby-card');
    card.innerHTML = `
      <div class="lobby-head">
        <div><div class="lobby-label">Стол</div><h2>${esc(info.id)}</h2></div>
        <div class="lobby-count">${seats.length}<i>/6</i></div>
      </div>`;
    const list = h('div', 'lobby-seats');
    for (let i = 0; i < 6; i++) {
      const p = seats[i];
      const row = h('div', 'seat-row' + (p ? '' : ' empty'));
      row.innerHTML = p
        ? `<span class="dot${p.isBot ? ' bot' : ''}"></span><b>${esc(p.name)}</b>${p.id === info.owner ? '<em>хозяин</em>' : p.isBot ? '<em>бот</em>' : ''}`
        : '<span class="dot"></span><b>Свободно</b>';
      list.appendChild(row);
    }
    card.appendChild(list);

    // приглашение
    const inv = h('div', 'lobby-invite');
    const share = h('button', 'lobby-btn gold', 'Позвать друзей') as HTMLButtonElement;
    share.onclick = () => {
      this.tap();
      const how = Telegram.share(Identity.inviteLink(info.id), `Садись за мой стол в QWX POKER · код ${info.id}`);
      if (how === 'copied') this.toast('Ссылка скопирована — отправь её друзьям');
    };
    const code = h('div', 'lobby-code', `Код стола <b>${esc(info.id)}</b> — друг вводит его в лобби или открывает ссылку`);
    inv.append(share, code);
    card.appendChild(inv);

    if (owner) {
      const bots = h('div', 'lobby-bots');
      const add = h('button', 'lobby-btn small', '+ Бот') as HTMLButtonElement;
      const rem = h('button', 'lobby-btn small', '− Бот') as HTMLButtonElement;
      add.onclick = () => { this.tap(); this.send({ t: 'ADD_BOT' }); };
      rem.onclick = () => { this.tap(); this.send({ t: 'REMOVE_BOT' }); };
      rem.disabled = !seats.some(p => p.isBot);
      bots.append(add, rem);
      const start = h('button', 'lobby-btn gold big', 'Начать игру') as HTMLButtonElement;
      start.disabled = seats.length < 2;
      start.onclick = () => { this.tap(); Telegram.haptic('bet'); this.send({ t: 'START' }); };
      card.append(bots, start);
    } else {
      card.appendChild(h('div', 'lobby-note', 'Ждём, когда хозяин стола начнёт игру…'));
    }
    const leave = h('button', 'lobby-link', 'Выйти из-за стола') as HTMLButtonElement;
    leave.onclick = () => { this.tap(); this.send({ t: 'LEAVE' }); };
    card.appendChild(leave);
    this.el.append(card);
    this.el.classList.add('open');
  }
}
