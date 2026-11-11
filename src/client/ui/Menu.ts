// Общее меню клуба: одна круглая кнопка справа наверху раскрывает панель со всеми функциями.
// Работает и в лобби, и за столом. Новые функции добавляются сюда же — одной строкой в items().

import type { ClientMsg, Profile, TourneyInfo, AdminUser, AdminOverview, ClubEvent } from '../../shared/Catalog';
import { WHEEL, REF_BONUS, SEASON, TOURNEY, UNLOCKS, levelOf, seasonId, seasonName, seasonEnds } from '../../shared/Catalog';
import type { TablesInfo, WheelResult, AdminReply } from '../net';
import { PWA } from '../pwa';
import { Identity } from '../identity';
import { Telegram } from '../telegram';
import { CARD_BACKS, currentBack, viewMode, saveViewMode, FELTS, savedFeltId, saveFelt, isOpen } from '../looks';
import { rollTo } from './roll';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
};
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export { FELTS, savedFelt } from '../looks';

const I = (d: string) => `<svg viewBox="0 0 24 24">${d}</svg>`;
export const ICON = {
  menu: I('<path d="M5 7h14M5 12h14M5 17h14"/>'),
  close: I('<path d="M6 6l12 12M18 6 6 18"/>'),
  wheel: I('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2"/><path d="M12 3.5V10M12 14v6.5M3.5 12H10M14 12h6.5M6 6l4.6 4.6M13.4 13.4 18 18M18 6l-4.6 4.6M10.6 13.4 6 18"/>'),
  profile: I('<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1-4 4-6 7.5-6s6.5 2 7.5 6"/>'),
  tables: I('<ellipse cx="12" cy="12" rx="9" ry="5.5"/><ellipse cx="12" cy="12" rx="5.5" ry="2.8"/>'),
  gift: I('<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M3 9h18M12 9v11M12 9c-2-4-6-4-6-1.5S10 9 12 9Zm0 0c2-4 6-4 6-1.5S14 9 12 9Z"/>'),
  send: I('<path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z"/>'),
  top: I('<path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H4.5c0 3 1.5 4.5 3.7 4.8M16 6h3.5c0 3-1.5 4.5-3.7 4.8M12 13v4M8.5 20h7"/>'),
  palette: I('<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 1.8-.8 1.8-1.6 0-1.3-1.1-1.6-1.1-2.7 0-1 .8-1.7 1.9-1.7h2.2a3.7 3.7 0 0 0 3.7-3.7C20.5 6.6 16.7 3.5 12 3.5Z"/><circle cx="7.5" cy="11" r="1.1"/><circle cx="10" cy="7.3" r="1.1"/><circle cx="14.5" cy="7.3" r="1.1"/>'),
  bulb: I('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z"/>'),
  note: I('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'),
  invite: I('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M18 7v6M15 10h6"/>'),
  exit: I('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/>'),
  out: I('<path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 16l4-4-4-4M18 12H8"/>'),
  moon: I('<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/><path d="M15 4.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6Z"/>'),
  ticket: I('<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V7Z"/><path d="M14 7v10" stroke-dasharray="1.6 1.8"/>'),
  phone: I('<rect x="7" y="2.8" width="10" height="18.4" rx="2.2"/><path d="M10.5 18h3M12 7v6.5M9.6 11.2 12 13.6l2.4-2.4"/>'),
  key: I('<circle cx="8" cy="12" r="3.6"/><path d="M11.6 12H21M17.5 12v3M20 12v2.2"/>'),
  lock: I('<rect x="5.5" y="10.5" width="13" height="9.5" rx="1.6"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
};

export interface MenuHandlers {
  send(m: ClientMsg): void;
  tap(): void;
  tick(): void;
  win(): void;
  toast(t: string, ok?: boolean): void;
  online(): boolean;
  transfer(): void;
  hints(): boolean;
  toggleHints(): boolean;
  setFelt(color: string): void;
  setBack(style: string): void;
  inviteTable(): void;
  leave(): void;
  signOut?: () => void;
}

type Item = { id: string; icon: string; label: string; sub?: string; on?: boolean; badge?: string; run: () => void };

export class Menu {
  private btn = h('button', 'qm-btn', `<span class="a">${ICON.menu}</span><span class="b">${ICON.close}</span><i class="dot"></i>`) as HTMLButtonElement;
  private panel = h('div', 'qm-panel');
  private back = h('div', 'qm-back');
  private modalBack = h('div', 'sheet-back qm-mback');
  private modal: HTMLElement | null = null;
  private profile: Profile | null = null;
  private atTable = false;
  private openState = false;
  private tablesTimer = 0;
  private spinning = false;
  signedIn = false;

  constructor(private H: MenuHandlers) {
    this.btn.title = 'Меню клуба';
    this.btn.setAttribute('aria-label', 'Меню клуба');
    this.btn.onclick = () => { H.tap(); Telegram.haptic('tap'); this.toggle(); };
    this.back.onclick = () => this.toggle(false);
    this.modalBack.onclick = () => this.closeModal();
    document.body.append(this.back, this.panel, this.btn, this.modalBack);
    addEventListener('keydown', e => { if (e.key === 'Escape') { if (this.modal) this.closeModal(); else this.toggle(false); } });
    // точка на кнопке — колесо готово к прокрутке
    window.setInterval(() => this.refreshBadges(), 1000);
  }

  setProfile(p: Profile) {
    this.profile = p;
    this.refreshBadges();
    const k = this.modal?.dataset.kind, mb = this.modal?.querySelector('.qm-body') as HTMLElement | null;
    if (mb && k === 'profile') this.renderProfile(mb);
    if (mb && k === 'season') this.renderSeason(mb);
    if (mb && k === 'look') this.renderLook(mb);
  }

  /** где мы: в лобби или за столом (меняется состав пунктов) */
  setContext(atTable: boolean) {
    if (this.atTable === atTable) return;
    this.atTable = atTable;
    if (this.openState) this.render();
  }

  private wheelReady() {
    const at = this.profile?.wheelAt || 0;
    return at <= Date.now();
  }

  private refreshBadges() {
    this.btn.classList.toggle('ready', this.wheelReady() && !!this.profile);
    if (this.openState) {
      const b = this.panel.querySelector('[data-id="wheel"] .sub');
      if (b) b.textContent = this.wheelSub();
    }
    const tc = this.modal?.querySelector('.qm-tcd');
    if (tc) tc.textContent = this.tourneyLeft();
    const rf = document.querySelectorAll('.qm-refill');
    rf.forEach(el => (el.textContent = this.refillText()));
    const cd = this.modal?.querySelector('.qm-cd');
    if (cd) cd.textContent = this.wheelReady() ? '' : `Следующая прокрутка через ${this.left()}`;
    const spin = this.modal?.querySelector('.qm-spin') as HTMLButtonElement | null;
    if (spin && !this.spinning) spin.disabled = !this.wheelReady();
  }

  private left() {
    const ms = Math.max(0, (this.profile?.wheelAt || 0) - Date.now());
    const hh = Math.floor(ms / 3600_000), mm = Math.floor(ms / 60_000) % 60, ss = Math.floor(ms / 1000) % 60;
    return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  private wheelSub() { return this.wheelReady() ? 'готово · до 25 000' : `через ${this.left()}`; }

  private items(): Item[][] {
    const H = this.H;
    const club: Item[] = [
      { id: 'wheel', icon: ICON.wheel, label: 'Колесо фортуны', sub: this.wheelSub(), badge: this.wheelReady() ? '●' : '', run: () => this.openWheel() },
      { id: 'profile', icon: ICON.profile, label: 'Профиль', sub: 'статистика игр', run: () => this.openProfile() },
      { id: 'tables', icon: ICON.tables, label: 'Открытые столы', sub: 'подсесть к игрокам', run: () => this.openTables() },
      { id: 'ref', icon: ICON.gift, label: 'Пригласить друга', sub: `+${fmt(REF_BONUS)} обоим`, run: () => this.openRef() },
      { id: 'send', icon: ICON.send, label: 'Перевод фишек', sub: 'по @username', run: () => { this.toggle(false); H.transfer(); } },
      { id: 'top', icon: ICON.top, label: 'Топ месяца', sub: 'лучшие игроки', run: () => this.openTop() },
      { id: 'tourney', icon: ICON.moon, label: TOURNEY.NAME, sub: this.tourneySub(), badge: this.tourney?.me ? '●' : '', run: () => this.openTourney() },
      { id: 'season', icon: ICON.ticket, label: 'Сезонный пропуск', sub: this.seasonSub(), run: () => this.openSeason() },
    ];
    const table: Item[] = this.atTable ? [
      { id: 'inv', icon: ICON.invite, label: 'Позвать за стол', sub: 'ссылка на этот стол', run: () => { this.toggle(false); H.inviteTable(); } },
      { id: 'exit', icon: ICON.exit, label: 'Выйти из-за стола', sub: document.body.classList.contains('in-tourney') ? 'это выход из турнира' : 'фишки вернутся на баланс', run: () => { this.toggle(false); H.leave(); } },
    ] : [];
    const settings: Item[] = [
      { id: 'look', icon: ICON.palette, label: 'Оформление', sub: 'сукно и рубашка карт', run: () => this.openLook() },
      { id: 'hints', icon: ICON.bulb, label: 'Подсказки', sub: H.hints() ? 'включены' : 'выключены', on: H.hints(), run: () => { H.toggleHints(); this.render(); } },
    ];
    if (!PWA.standalone) settings.push({ id: 'install', icon: ICON.phone, label: 'Установить на телефон', sub: 'иконка и вход за полсекунды', run: () => this.install() });
    if (this.profile?.admin) settings.push({ id: 'admin', icon: ICON.key, label: 'Админ-панель', sub: 'фишки, предметы, турнир', run: () => this.openAdmin() });
    if (!this.atTable && this.signedIn && H.signOut) settings.push({ id: 'out', icon: ICON.out, label: 'Выйти из аккаунта', run: () => H.signOut!() });
    return [club, table, settings].filter(g => g.length);
  }

  private render() {
    this.panel.innerHTML = '';
    const p = this.profile;
    const head = h('div', 'qm-head', `<div class="av">${esc((p?.name || 'В')[0].toUpperCase())}</div><div><b>${esc(p?.name || 'Гость')}</b><span><em class="qm-hb">${p ? fmt(this.shownBal ?? p.balance) : ''}</em>${p ? ' фишек' : ''}</span></div>`);
    this.panel.append(head);
    const titles = this.atTable ? ['Клуб', 'Стол', 'Настройки'] : ['Клуб', 'Настройки'];
    this.items().forEach((group, gi) => {
      this.panel.append(h('div', 'qm-sec', titles[gi]));
      const grid = h('div', 'qm-grid');
      for (const it of group) {
        const b = h('button', 'qm-item' + (it.on === false ? ' off' : '') + (it.on ? ' on' : ''), `<i>${it.icon}</i><span><b>${it.label}</b>${it.sub ? `<small class="sub">${it.sub}</small>` : ''}</span>${it.badge ? '<em></em>' : ''}`) as HTMLButtonElement;
        b.dataset.id = it.id;
        b.onclick = () => { this.H.tap(); Telegram.haptic('tap'); it.run(); };
        grid.append(b);
      }
      this.panel.append(grid);
    });
    this.rollHead();
    this.panel.querySelectorAll('.qm-item').forEach((el, i) => ((el as HTMLElement).style.transitionDelay = `${0.03 + i * 0.025}s`));
  }

  private shownBal: number | null = null;
  private rollHead() {
    const el = this.panel.querySelector('.qm-hb') as HTMLElement | null;
    const p = this.profile;
    if (!el || !p) return;
    if (this.shownBal != null) { rollTo(el, this.shownBal); rollTo(el, p.balance); }
    this.shownBal = p.balance;
  }

  toggle(v = !this.openState) {
    this.openState = v;
    if (v) this.render();
    this.btn.classList.toggle('open', v);
    this.panel.classList.toggle('open', v);
    this.back.classList.toggle('open', v);
  }

  // ───────────────────────── окна ─────────────────────────

  private openModal(kind: string, title: string, sub = '') {
    this.toggle(false);
    this.closeModal(true);
    const m = h('div', 'xfer qm-modal', `<div class="head"><h2>${title}</h2><button class="x" aria-label="Закрыть">×</button></div>${sub ? `<div class="sub">${sub}</div>` : ''}<div class="qm-body"></div>`);
    m.dataset.kind = kind;
    (m.querySelector('.x') as HTMLElement).onclick = () => this.closeModal();
    document.body.append(m);
    this.modal = m;
    requestAnimationFrame(() => { m.classList.add('open'); this.modalBack.classList.add('open'); });
    return m.querySelector('.qm-body') as HTMLElement;
  }

  closeModal(instant = false) {
    const m = this.modal;
    if (!m) return;
    if (this.spinning && !instant) return; // колесо докручивается — не закрываем
    this.modal = null;
    clearInterval(this.tablesTimer);
    clearInterval(this.adminTimer);
    m.classList.remove('open');
    this.modalBack.classList.remove('open');
    setTimeout(() => m.remove(), instant ? 0 : 280);
  }

  // ── колесо фортуны ──
  private wheelCanvas!: HTMLCanvasElement;
  private wheelAngle = 0;

  private openWheel() {
    const body = this.openModal('wheel', 'Колесо фортуны', 'Раз в сутки — бесплатная прокрутка. Выигрыш от 500 до 25 000 фишек.');
    const wrap = h('div', 'qm-wheel');
    const c = h('canvas') as HTMLCanvasElement;
    const S = 300, dpr = Math.min(3, devicePixelRatio || 1);
    c.width = c.height = S * dpr;
    this.wheelCanvas = c;
    wrap.append(c, h('div', 'qm-pin'), h('div', 'qm-hub', '♠'));
    const res = h('div', 'qm-res');
    const cd = h('div', 'qm-cd');
    const spin = h('button', 'lobby-btn gold big qm-spin', 'Крутить') as HTMLButtonElement;
    spin.disabled = !this.wheelReady();
    spin.onclick = () => {
      if (this.spinning || !this.wheelReady()) return;
      this.spinning = true;
      spin.disabled = true;
      res.textContent = '';
      wrap.classList.add('go');
      Telegram.haptic('bet');
      this.H.send({ t: 'WHEEL' });
    };
    body.append(wrap, res, spin, cd);
    this.drawWheel();
    this.refreshBadges();
  }

  private drawWheel() {
    const c = this.wheelCanvas;
    const g = c.getContext('2d')!;
    const R = c.width / 2;
    const n = WHEEL.length, seg = (Math.PI * 2) / n;
    g.clearRect(0, 0, c.width, c.height);
    g.save();
    g.translate(R, R);
    g.rotate(this.wheelAngle);
    // обод
    const rim = g.createRadialGradient(0, 0, R * 0.8, 0, 0, R);
    rim.addColorStop(0, '#6b4f1c'); rim.addColorStop(0.5, '#ead4a0'); rim.addColorStop(1, '#5a4014');
    g.fillStyle = rim;
    g.beginPath(); g.arc(0, 0, R * 0.99, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + i * seg - seg / 2;
      const v = WHEEL[i].v;
      const big = v >= 10000;
      const grd = g.createRadialGradient(0, 0, R * 0.1, 0, 0, R * 0.9);
      const base = big ? ['#f3d98a', '#b88a2c'] : i % 2 ? ['#2a1015', '#120709'] : ['#7a1a2c', '#3d0b16'];
      grd.addColorStop(0, base[0]); grd.addColorStop(1, base[1]);
      g.fillStyle = grd;
      g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R * 0.9, a0, a0 + seg); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(230,196,106,.55)'; g.lineWidth = R * 0.012; g.stroke();
      g.save();
      g.rotate(a0 + seg / 2);
      g.translate(R * 0.6, 0);
      g.rotate(Math.PI / 2);
      g.fillStyle = big ? '#2a1606' : '#f3e6c4';
      g.font = `700 ${R * (v >= 10000 ? 0.12 : 0.11)}px "Bodoni Moda", serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(v >= 1000 ? `${v / 1000}K` : String(v), 0, 0);
      g.restore();
    }
    // лампочки по ободу
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2;
      g.fillStyle = i % 2 ? '#fff4cf' : '#e6b84a';
      g.beginPath(); g.arc(Math.cos(a) * R * 0.945, Math.sin(a) * R * 0.945, R * 0.018, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }

  /** ответ сервера: крутим колесо так, чтобы сектор index остановился под стрелкой */
  onWheel(w: WheelResult) {
    if (w.wheelAt && this.profile) this.profile.wheelAt = w.wheelAt;
    const m = this.modal;
    if (!m || m.dataset.kind !== 'wheel') { if (!w.ok && w.text) this.H.toast(w.text, false); this.spinning = false; return; }
    const res = m.querySelector('.qm-res') as HTMLElement;
    const wrap = m.querySelector('.qm-wheel') as HTMLElement;
    if (!w.ok || w.index == null) {
      this.spinning = false;
      wrap.classList.remove('go');
      res.textContent = w.text || 'Колесо пока отдыхает';
      this.refreshBadges();
      return;
    }
    const n = WHEEL.length, seg = (Math.PI * 2) / n;
    const from = this.wheelAngle;
    const jitter = (Math.random() - 0.5) * seg * 0.6;
    let to = -w.index * seg + jitter;
    const turns = 6;
    to += Math.ceil((from - to) / (Math.PI * 2)) * Math.PI * 2 + turns * Math.PI * 2;
    const T = 4800, t0 = performance.now();
    let lastSeg = Math.floor((from + seg / 2) / seg);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / T);
      // быстрый разгон и долгое мягкое торможение
      const e = 1 - Math.pow(1 - k, 4);
      this.wheelAngle = from + (to - from) * e;
      this.drawWheel();
      const s = Math.floor((this.wheelAngle + seg / 2) / seg);
      if (s !== lastSeg) { lastSeg = s; this.H.tick(); (m.querySelector('.qm-pin') as HTMLElement)?.animate([{ transform: 'translateX(-50%) rotate(-14deg)' }, { transform: 'translateX(-50%) rotate(0)' }], { duration: 120 }); }
      if (k < 1) { requestAnimationFrame(step); return; }
      this.spinning = false;
      wrap.classList.remove('go');
      wrap.classList.add('won');
      setTimeout(() => wrap.classList.remove('won'), 1600);
      res.innerHTML = `<b>+${fmt(w.prize || 0)}</b> фишек`;
      this.burst(wrap);
      this.H.win();
      Telegram.haptic('win');
      this.refreshBadges();
    };
    requestAnimationFrame(step);
  }

  /** золотые искры вокруг колеса */
  private burst(el: HTMLElement) {
    for (let i = 0; i < 26; i++) {
      const s = h('i', 'qm-spark');
      const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 90;
      s.style.setProperty('--x', `${Math.cos(a) * d}px`);
      s.style.setProperty('--y', `${Math.sin(a) * d}px`);
      s.style.animationDelay = `${Math.random() * 0.15}s`;
      el.append(s);
      setTimeout(() => s.remove(), 1400);
    }
  }

  // ── профиль ──
  private openProfile() {
    const body = this.openModal('profile', 'Профиль игрока');
    this.renderProfile(body);
  }

  private renderProfile(body: HTMLElement) {
    const p = this.profile;
    const st = p?.stats || { hands: 0, wins: 0, biggestPot: 0, refs: 0 };
    const pct = st.hands ? Math.round((st.wins / st.hands) * 100) : 0;
    body.innerHTML = `
      <div class="qm-pro">
        <div class="av">${esc((p?.name || 'В')[0].toUpperCase())}</div>
        <div><b>${esc(p?.name || 'Гость')}</b><span>${p?.username ? '@' + esc(p.username) : this.H.online() ? 'вход без Telegram' : 'тренировочный режим'}</span></div>
      </div>
      <div class="qm-bal"><small>Баланс</small><b class="qm-pb">0</b></div>
      <div class="qm-refill">${this.refillText()}</div>
      ${p?.username ? `<button class="qm-code"><small>Telegram</small><b>@${esc(p.username)}</b><span>скопировать</span></button>` : ''}
      <div class="qm-stats">
        <div><b>${fmt(st.hands)}</b><small>сыграно рук</small></div>
        <div><b>${fmt(st.wins)}</b><small>выиграно рук</small></div>
        <div class="ring" style="--p:${pct}"><b>${pct}%</b><small>процент побед</small></div>
        <div><b>${fmt(st.biggestPot)}</b><small>самый большой банк</small></div>
        <div><b>${fmt(st.refs)}</b><small>друзей пришло</small></div>
      </div>`;
    const cb = body.querySelector('.qm-code') as HTMLElement | null;
    if (cb && p?.username) cb.onclick = () => navigator.clipboard?.writeText('@' + p.username).then(() => this.H.toast('Юзернейм скопирован — по нему вам переводят фишки', true), () => this.H.toast('@' + p.username));
    const pb = body.querySelector('.qm-pb') as HTMLElement;
    rollTo(pb, 0); rollTo(pb, p?.balance || 0, fmt, 1100);
  }

  // ── открытые столы ──
  private openTables() {
    const body = this.openModal('tables', 'Открытые столы');
    body.innerHTML = '<div class="qm-online"><i></i><span>Ищем столы…</span></div><div class="qm-tables"></div>';
    this.H.send({ t: 'TABLES' });
    clearInterval(this.tablesTimer);
    this.tablesTimer = window.setInterval(() => this.H.send({ t: 'TABLES' }), 5000);
  }

  onTables(t: TablesInfo) {
    const m = this.modal;
    if (!m || m.dataset.kind !== 'tables') return;
    const on = m.querySelector('.qm-online span') as HTMLElement;
    const list = m.querySelector('.qm-tables') as HTMLElement;
    on.innerHTML = this.H.online() ? `Сейчас в клубе: <b>${fmt(t.online)}</b> ${plural(t.online, 'игрок', 'игрока', 'игроков')}` : 'Сервер клуба недоступен — открытые столы появятся онлайн';
    if (!t.tables.length) {
      list.innerHTML = `<div class="none">${this.H.online() ? 'Свободных столов нет — создайте свой и позовите друзей' : ''}</div>`;
      return;
    }
    list.innerHTML = '';
    for (const tb of t.tables) {
      const seats = Array.from({ length: 6 }, (_, i) => `<i class="${i < tb.players ? 'f' : ''}"></i>`).join('');
      const row = h('div', 'qm-trow', `
        <div class="l"><b>${fmt(tb.sb)}/${fmt(tb.bb)}</b><small>${esc(tb.owner)} · ${tb.started ? 'идёт игра' : 'ждут игроков'}</small></div>
        <div class="seats">${seats}</div>`);
      const go = h('button', 'lh-go', 'Сесть') as HTMLButtonElement;
      go.onclick = () => { this.H.tap(); this.closeModal(); this.H.send({ t: 'JOIN', room: tb.id }); };
      row.append(go);
      list.append(row);
    }
  }

  // ── пригласить друга ──
  private openRef() {
    const code = this.profile?.refCode || '';
    const online = this.H.online() && code && code !== 'TRAIN';
    const body = this.openModal('ref', 'Пригласить друга', `Друг входит в клуб по вашей ссылке — вы оба получаете по <b>${fmt(REF_BONUS)}</b> фишек.`);
    if (!online) { body.innerHTML = '<div class="none">Реферальная ссылка работает онлайн, после входа в клуб.</div>'; return; }
    const link = Identity.refLink(code);
    body.innerHTML = `
      <div class="qm-ref"><span>${esc(link)}</span></div>
      <div class="qm-row2"><button class="lobby-btn copy">Скопировать</button><button class="lobby-btn gold share">Поделиться</button></div>
      <div class="qm-refs">Пришло по вашей ссылке: <b>${fmt(this.profile?.stats?.refs || 0)}</b></div>`;
    (body.querySelector('.copy') as HTMLElement).onclick = () => {
      navigator.clipboard?.writeText(link).then(() => this.H.toast('Ссылка скопирована', true), () => this.H.toast(link));
    };
    (body.querySelector('.share') as HTMLElement).onclick = () => {
      Telegram.share(link, `Заходи в QWX POKER — по моей ссылке нам обоим ${fmt(REF_BONUS)} фишек`);
    };
  }

  // ── топ месяца ──
  private openTop() {
    const body = this.openModal('top', 'Топ месяца', 'Выигрыш за месяц за всеми столами клуба.');
    body.innerHTML = '<div class="lobby-top open qm-top"><div class="none">Загружаем…</div></div>';
    this.H.send({ t: 'TOP' });
  }

  /** true — топ показан в окне меню */
  onTop(top: { name: string; profit: number }[]) {
    const box = this.modal?.dataset.kind === 'top' ? this.modal.querySelector('.qm-top') as HTMLElement : null;
    if (!box) return false;
    box.innerHTML = top.length
      ? top.map((e, i) => `<div><i>${i + 1}</i><b>${esc(e.name)}</b><span>${e.profit >= 0 ? '+' : ''}${fmt(e.profit)}</span></div>`).join('')
      : '<div class="none">В этом месяце ещё никто не играл</div>';
    return true;
  }

  // ── оформление ──
  private openLook() {
    const body = this.openModal('look', 'Оформление', 'Видно только вам: остальные игроки видят свой выбор.');
    this.renderLook(body);
  }

  private renderLook(body: HTMLElement) {
    const feltId = savedFeltId();
    const back = currentBack();
    const mode = viewMode();
    const un = this.profile?.unlocks;
    const lock = `<em class="lk">${ICON.lock}</em>`;
    const themes = FELTS.filter(f => f.theme), plain = FELTS.filter(f => !f.theme);
    const feltBtn = (f: typeof FELTS[number]) => {
      const open = isOpen(f.id, un, f.unlock);
      return `<button data-f="${f.id}" class="${f.id === feltId ? 'on' : ''}${open ? '' : ' locked'}"${f.theme ? ` data-t="${f.theme}"` : ''}><i style="--c:${f.color}"></i><span>${f.name}${open ? '' : `<small>${f.hint}</small>`}</span>${open ? '' : lock}</button>`;
    };
    body.innerHTML = `
      <div class="lh-label">Вид стола</div>
      <div class="qm-sw view">
        <button data-v="3d" class="${mode === '3d' ? 'on' : ''}"><i class="vw v3"><s></s></i><span><b>3D</b><small>кино, свет и тени</small></span></button>
        <button data-v="2d" class="${mode === '2d' ? 'on' : ''}"><i class="vw v2"><s></s></i><span><b>2D</b><small>лёгкий, для телефона</small></span></button>
      </div>
      <div class="lh-label">Тема стола</div>
      <div class="qm-sw felt themes">${themes.map(feltBtn).join('')}</div>
      <div class="lh-label">Сукно</div>
      <div class="qm-sw felt">${plain.map(feltBtn).join('')}</div>
      <div class="lh-label">Рубашка карт</div>
      <div class="qm-sw backs">${Object.entries(CARD_BACKS).map(([id, b]) => {
        const open = isOpen(id, un, b.unlock);
        return `<button data-b="${id}" class="${id === back ? 'on' : ''}${open ? '' : ' locked'}"><i class="card" style="--c:${b.bg};--l:${b.line};--f:${b.frame}"></i><span>${b.name}${open ? '' : `<small>${b.hint}</small>`}</span>${open ? '' : lock}</button>`;
      }).join('')}</div>`;
    body.querySelectorAll<HTMLButtonElement>('.view button').forEach(b => b.onclick = () => {
      const m = b.dataset.v as '3d' | '2d';
      if (m === viewMode()) return;
      this.H.tap();
      body.querySelectorAll('.view button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      saveViewMode(m);
      // если сидим за столом — после перезапуска сразу вернёмся за него
      if (this.atTable) { try { sessionStorage.setItem('pn.autoResume', '1'); } catch { /* */ } }
      this.H.toast(m === '2d' ? 'Включаем 2D-стол…' : 'Включаем 3D-зал…', true);
      document.body.classList.add('view-switch');
      setTimeout(() => location.reload(), 650);
    });
    const locked = (b: HTMLElement, hint?: string) => {
      this.H.toast(`Пока закрыто: ${hint || ''}`, false);
      b.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 260 });
    };
    body.querySelectorAll<HTMLButtonElement>('.felt button').forEach(b => b.onclick = () => {
      const f = FELTS.find(x => x.id === b.dataset.f)!;
      if (b.classList.contains('locked')) { locked(b, f.hint); return; }
      this.H.tap();
      body.querySelectorAll('.felt button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      saveFelt(f.id);
      this.H.setFelt(f.color);
    });
    body.querySelectorAll<HTMLButtonElement>('.backs button').forEach(b => b.onclick = () => {
      if (b.classList.contains('locked')) { locked(b, CARD_BACKS[b.dataset.b!]?.hint); return; }
      this.H.tap();
      body.querySelectorAll('.backs button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      this.H.setBack(b.dataset.b!);
    });
  }

  // ── турнир «Ночь пятницы» ──
  private tourney: TourneyInfo | null = null;

  onTourney(t: TourneyInfo) {
    this.tourney = t;
    if (this.modal?.dataset.kind === 'tourney') this.renderTourney(this.modal.querySelector('.qm-body')!);
    if (this.openState) { const sub = this.panel.querySelector('[data-id="tourney"] .sub'); if (sub) sub.textContent = this.tourneySub(); }
  }

  private tourneyLeft() {
    const t = this.tourney;
    if (!t || t.state !== 'REG') return '';
    const ms = Math.max(0, t.startsAt - Date.now());
    const d = Math.floor(ms / 86400_000), hh = Math.floor(ms / 3600_000) % 24, mm = Math.floor(ms / 60_000) % 60, ss = Math.floor(ms / 1000) % 60;
    return (d ? `${d} д ` : '') + `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  private tourneySub() {
    const t = this.tourney;
    if (!t) return 'пятница · 21:00';
    if (t.state === 'RUNNING') return `идёт · осталось ${t.left}`;
    return t.me ? 'вы записаны · пт 21:00' : `пт 21:00 · ${t.registered}/${TOURNEY.MAX}`;
  }

  private openTourney() {
    const body = this.openModal('tourney', TOURNEY.NAME, `Турнир на ${TOURNEY.MAX} игроков каждую пятницу в 21:00 по Москве. Призы — именные рубашки карт.`);
    this.renderTourney(body);
    this.H.send({ t: 'TOURNEY' });
  }

  private renderTourney(body: HTMLElement) {
    const t = this.tourney;
    const prize = (i: number) => {
      const p = TOURNEY.PRIZES[i];
      const b = CARD_BACKS[p.unlock];
      return `<div class="qm-prize p${i + 1}"><i class="card" style="--c:${b.bg};--l:${b.line};--f:${b.frame}"></i><div><b>${i + 1} место</b><small>${b.name} · +${fmt(p.chips)} фишек</small></div></div>`;
    };
    const when = t ? new Date(t.startsAt).toLocaleString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }) : '';
    let top = '';
    if (!t || t.state === 'REG' || t.state === 'DONE') {
      top = `<div class="qm-tour"><small>${t?.state === 'DONE' ? 'Турнир окончен · следующий' : 'До начала'}</small><b class="qm-tcd">${this.tourneyLeft()}</b><span>${esc(when)} МСК</span></div>
        <div class="qm-seats">${Array.from({ length: TOURNEY.MAX }, (_, i) => `<i class="${i < (t?.registered || 0) ? 'f' : ''}"></i>`).join('')}</div>
        <div class="qm-tnote">Записалось: <b>${t?.registered || 0}</b> из ${TOURNEY.MAX}. Наберётся 18 — начнём сразу, не дожидаясь пятницы. Пустые места займут гости клуба.</div>
        <button class="lobby-btn ${t?.me ? '' : 'gold'} big qm-treg">${t?.me ? 'Выйти из списка' : 'Записаться бесплатно'}</button>`;
    } else {
      top = `<div class="qm-tour live"><small>Идёт игра</small><b>Осталось ${t.left}</b><span>Уровень ${t.level} · блайнды ${t.blinds ? fmt(t.blinds[0]) + '/' + fmt(t.blinds[1]) : ''}</span></div>
        <div class="qm-tnote">${t.playing ? 'Вы в игре — удачи!' : 'Запись закрыта. Следующая «Ночь пятницы» — через неделю.'}</div>`;
    }
    const res = t?.results?.length ? `<div class="lh-label">Прошлый турнир</div><div class="lobby-top open qm-top">${t.results.map(r => `<div><i>${r.place}</i><b>${esc(r.name)}</b><span>${r.bot ? 'гость клуба' : ''}</span></div>`).join('')}</div>` : '';
    body.innerHTML = `${top}
      <div class="lh-label">Призы</div>
      <div class="qm-prizes">${prize(0)}${prize(1)}${prize(2)}</div>
      <div class="qm-rules">Стек ${fmt(TOURNEY.STACK)} · блайнды растут каждые 5 минут · без докупок · за участие +${SEASON.XP_TOURNEY} опыта сезона</div>
      ${res}`;
    const reg = body.querySelector('.qm-treg') as HTMLButtonElement | null;
    if (reg) reg.onclick = () => {
      if (!this.H.online()) { this.H.toast('Турнир проходит онлайн — нужен вход через Telegram', false); return; }
      this.H.tap(); Telegram.haptic('tap');
      this.H.send({ t: 'TOURNEY_REG', on: !t?.me });
    };
  }

  // ── сезонный пропуск ──
  private seasonSub() {
    const xp = this.seasonXp();
    const lvl = levelOf(xp);
    return lvl >= SEASON.LEVELS ? 'максимальный уровень' : `уровень ${lvl} · ${xp % SEASON.PER_LEVEL}/${SEASON.PER_LEVEL}`;
  }
  private seasonXp() { const p = this.profile; return p && p.season === seasonId() ? p.xp || 0 : 0; }

  private openSeason() {
    const end = new Date(seasonEnds()).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    const body = this.openModal('season', 'Сезонный пропуск', `${seasonName(seasonId())} · до ${end}. Просто играйте: +${SEASON.XP_HAND} опыта за руку, +${SEASON.XP_WIN} за выигранную, +${SEASON.XP_TOURNEY} за турнир.`);
    this.renderSeason(body);
  }

  private renderSeason(body: HTMLElement) {
    const xp = this.seasonXp();
    const lvl = levelOf(xp);
    const into = lvl >= SEASON.LEVELS ? SEASON.PER_LEVEL : xp % SEASON.PER_LEVEL;
    const rows: string[] = [];
    for (let l = 2; l <= SEASON.LEVELS; l++) {
      const r = SEASON.REWARDS[l];
      if (!r) continue;
      const name = r.unlock ? UNLOCKS.find(u => u.id === r.unlock)?.name || '' : `+${fmt(r.chips || 0)} фишек`;
      const sw = r.unlock ? (CARD_BACKS[r.unlock] ? `<i class="card" style="--c:${CARD_BACKS[r.unlock].bg};--l:${CARD_BACKS[r.unlock].line};--f:${CARD_BACKS[r.unlock].frame}"></i>` : `<i class="cloth" style="--c:${FELTS.find(f => f.id === r.unlock)?.color}"></i>`) : '<i class="chipi"></i>';
      rows.push(`<div class="qm-lv ${l <= lvl ? 'got' : l === lvl + 1 ? 'next' : ''}"><em>${l}</em>${sw}<span>${esc(name)}</span><b>${l <= lvl ? '✓' : ''}</b></div>`);
    }
    body.innerHTML = `
      <div class="qm-pass"><div class="lvl"><small>уровень</small><b>${lvl}</b></div>
        <div class="bar"><i style="width:${(into / SEASON.PER_LEVEL) * 100}%"></i></div>
        <span>${lvl >= SEASON.LEVELS ? 'Сезон пройден полностью' : `${into} / ${SEASON.PER_LEVEL} опыта до уровня ${lvl + 1}`}</span></div>
      <div class="qm-track">${rows.join('')}</div>`;
    body.querySelector('.qm-lv.next')?.scrollIntoView({ block: 'center' });
  }

  // ── установка на телефон ──
  private async install() {
    if (PWA.canPrompt) {
      this.toggle(false);
      const r = await PWA.install();
      if (r === 'ok') this.H.toast('Готово — QWX POKER на главном экране', true);
      return;
    }
    const body = this.openModal('install', 'Установить на телефон', 'Игра появится на главном экране отдельной иконкой и будет открываться за полсекунды.');
    body.innerHTML = PWA.ios
      ? `<ol class="qm-steps"><li>Откройте игру в <b>Safari</b></li><li>Нажмите <b>«Поделиться»</b> — квадрат со стрелкой внизу экрана</li><li>Выберите <b>«На экран „Домой“»</b> и нажмите «Добавить»</li></ol>`
      : `<ol class="qm-steps"><li>Откройте игру в <b>Chrome</b> (или Яндекс Браузере)</li><li>Нажмите <b>⋮</b> — меню справа вверху</li><li>Выберите <b>«Установить приложение»</b> или «Добавить на главный экран»</li></ol>
         <div class="qm-tnote">Если игра открыта внутри Telegram — нажмите ⋯ и «Открыть в браузере».</div>`;
  }

  // ── фишки кончились ──
  refillText() {
    const at = this.profile?.refillAt || 0;
    if (!at) return '';
    const ms = Math.max(0, at - Date.now());
    return ms ? `Фишки кончились. Заведение угостит 1 000 через ${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}` : 'Заведение вот-вот угостит 1 000 фишек';
  }

  // ── админ-панель: обзор, игроки, журнал, управление ──
  private adminUser: AdminUser | null = null;
  private adminTab: 'over' | 'users' | 'log' | 'ctl' = 'over';
  private adminTimer = 0;
  private logKind = '';

  private openAdmin(tab: Menu['adminTab'] = this.adminTab) {
    const body = this.openModal('admin', 'Админ-панель', 'Видна только вам. Все действия записываются в журнал.');
    this.modal!.classList.add('qm-admin');
    body.innerHTML = `
      <div class="qa-tabs">${[['over', 'Обзор'], ['users', 'Игроки'], ['log', 'Журнал'], ['ctl', 'Управление']].map(([k, n]) => `<button data-k="${k}">${n}</button>`).join('')}</div>
      <div class="qa-pane"></div>`;
    body.querySelectorAll<HTMLButtonElement>('.qa-tabs button').forEach(b => b.onclick = () => { this.H.tap(); this.adminShow(b.dataset.k as Menu['adminTab']); });
    this.adminShow(tab);
  }

  private adminShow(tab: Menu['adminTab']) {
    const m = this.modal;
    if (!m || m.dataset.kind !== 'admin') return;
    this.adminTab = tab;
    m.querySelectorAll<HTMLButtonElement>('.qa-tabs button').forEach(b => b.classList.toggle('on', b.dataset.k === tab));
    const pane = m.querySelector('.qa-pane') as HTMLElement;
    clearInterval(this.adminTimer);
    const send = (x: Omit<Extract<ClientMsg, { t: 'ADMIN' }>, 't'>) => this.H.send({ t: 'ADMIN', ...x });
    if (tab === 'over') {
      pane.innerHTML = '<div class="none">Загружаем…</div>';
      send({ op: 'overview' });
      this.adminTimer = window.setInterval(() => { if (!document.hidden) send({ op: 'overview' }); }, 5000);
    } else if (tab === 'users') {
      pane.innerHTML = `<div class="qm-adm-find"><input class="qa-search" placeholder="Поиск: @username или имя" autocomplete="off" autocapitalize="off" spellcheck="false" /></div>
        <div class="qa-sum"></div><div class="qa-users"><div class="none">Загружаем…</div></div>`;
      const inp = pane.querySelector('.qa-search') as HTMLInputElement;
      let t = 0;
      inp.oninput = () => { clearTimeout(t); t = window.setTimeout(() => send({ op: 'list', text: inp.value.trim() }), 250); };
      send({ op: 'list' });
      this.adminTimer = window.setInterval(() => { if (!document.hidden && !inp.value) send({ op: 'list' }); }, 10000);
    } else if (tab === 'log') {
      const kinds: [string, string][] = [['', 'Все'], ['join', 'Входы'], ['new', 'Новые'], ['win', 'Крупные банки'], ['transfer', 'Переводы'], ['wheel', 'Колесо'], ['table', 'Столы'], ['tourney', 'Турнир'], ['refill', 'Угощение'], ['admin', 'Админ']];
      pane.innerHTML = `<div class="qa-chips">${kinds.map(([k, n]) => `<button data-k="${k}" class="${k === this.logKind ? 'on' : ''}">${n}</button>`).join('')}</div><div class="qa-events big"><div class="none">Загружаем…</div></div>`;
      pane.querySelectorAll<HTMLButtonElement>('.qa-chips button').forEach(b => b.onclick = () => {
        this.logKind = b.dataset.k || '';
        pane.querySelectorAll('.qa-chips button').forEach(x => x.classList.toggle('on', x === b));
        send({ op: 'events', text: this.logKind });
      });
      send({ op: 'events', text: this.logKind });
      this.adminTimer = window.setInterval(() => { if (!document.hidden) send({ op: 'events', text: this.logKind }); }, 5000);
    } else this.renderControl(pane);
  }

  private renderControl(pane: HTMLElement) {
    const items = UNLOCKS.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('');
    pane.innerHTML = `
      <div class="qm-adm-find"><input class="qa-q" placeholder="@username или код QWX-…" autocomplete="off" autocapitalize="off" spellcheck="false" /><button class="lobby-btn gold qa-find">Найти</button></div>
      <div class="qa-user"></div>
      <div class="qa-tools" hidden>
        <div class="lh-label">Фишки</div>
        <div class="qm-adm-row"><input class="qa-amt" type="number" inputmode="numeric" placeholder="сумма" />
          <button class="lobby-btn gold qa-give">Выдать</button><button class="lobby-btn qa-take">Забрать</button><button class="lobby-btn qa-set">= Баланс</button></div>
        <div class="qm-quick">${[1000, 5000, 25000, 100000].map(v => `<button data-v="${v}">+${fmt(v)}</button>`).join('')}</div>
        <div class="lh-label">Предметы</div>
        <div class="qm-adm-row"><select class="qa-item">${items}</select><button class="lobby-btn gold qa-unlock">Выдать</button><button class="lobby-btn qa-lock">Забрать</button></div>
        <div class="lh-label">Сезон и колесо</div>
        <div class="qm-adm-row"><input class="qa-xp" type="number" inputmode="numeric" placeholder="опыт" value="200" /><button class="lobby-btn gold qa-addxp">+ Опыт</button><button class="lobby-btn qa-wheel">Сбросить колесо</button></div>
        <div class="lh-label">История игрока</div>
        <div class="qa-events qa-uev"></div>
      </div>
      <div class="lh-label">Клуб</div>
      <div class="qm-adm-row"><input class="qa-msg" placeholder="Объявление всем онлайн" maxlength="200" /><button class="lobby-btn gold qa-say">Отправить</button></div>
      <div class="qm-adm-row"><button class="lobby-btn qa-tstart">Запустить турнир сейчас</button></div>
      <div class="qa-out"></div>`;
    const $ = <T extends HTMLElement>(c: string) => pane.querySelector(c) as T;
    const q = $<HTMLInputElement>('.qa-q');
    const target = () => this.adminUser ? this.adminUser.id : q.value.trim();
    const op = (x: Omit<Extract<ClientMsg, { t: 'ADMIN' }>, 't'>) => { this.H.tap(); this.H.send({ t: 'ADMIN', ...x }); };
    const amt = () => Math.trunc(Number($<HTMLInputElement>('.qa-amt').value) || 0);
    $('.qa-find').onclick = () => { if (q.value.trim()) { this.adminUser = null; op({ op: 'find', target: q.value.trim() }); } };
    q.onkeydown = e => { if (e.key === 'Enter') $<HTMLButtonElement>('.qa-find').click(); };
    $('.qa-give').onclick = () => { if (amt()) op({ op: 'give', target: target(), amount: Math.abs(amt()) }); };
    $('.qa-take').onclick = () => { if (amt()) op({ op: 'give', target: target(), amount: -Math.abs(amt()) }); };
    $('.qa-set').onclick = () => { const v = $<HTMLInputElement>('.qa-amt').value; if (v !== '' && confirmNum(v)) op({ op: 'set', target: target(), amount: amt() }); };
    pane.querySelectorAll<HTMLButtonElement>('.qm-quick button').forEach(b => b.onclick = () => op({ op: 'give', target: target(), amount: Number(b.dataset.v) }));
    $('.qa-unlock').onclick = () => op({ op: 'unlock', target: target(), item: $<HTMLSelectElement>('.qa-item').value });
    $('.qa-lock').onclick = () => op({ op: 'lock', target: target(), item: $<HTMLSelectElement>('.qa-item').value });
    $('.qa-addxp').onclick = () => op({ op: 'xp', target: target(), amount: Math.trunc(Number($<HTMLInputElement>('.qa-xp').value) || 0) });
    $('.qa-wheel').onclick = () => op({ op: 'resetWheel', target: target() });
    $('.qa-say').onclick = () => { const v = $<HTMLInputElement>('.qa-msg').value.trim(); if (v) { op({ op: 'broadcast', text: v }); $<HTMLInputElement>('.qa-msg').value = ''; } };
    $('.qa-tstart').onclick = () => op({ op: 'tourneyStart' });
    if (this.adminUser) { q.value = this.adminUser.username ? '@' + this.adminUser.username : this.adminUser.id; this.renderAdminUser(); this.H.send({ t: 'ADMIN', op: 'find', target: this.adminUser.id }); }
  }

  onAdmin(a: AdminReply) {
    const m = this.modal;
    if (!m || m.dataset.kind !== 'admin') { if (a.text) this.H.toast(a.text, a.ok); return; }
    const pane = m.querySelector('.qa-pane') as HTMLElement;
    if (a.overview && this.adminTab === 'over') { this.renderOverview(pane, a.overview); return; }
    if (a.events && this.adminTab === 'log') { (pane.querySelector('.qa-events') as HTMLElement).innerHTML = evList(a.events); return; }
    if (a.users && this.adminTab === 'users') {
      const box = pane.querySelector('.qa-users') as HTMLElement;
      (pane.querySelector('.qa-sum') as HTMLElement).textContent = a.text || '';
      box.innerHTML = a.users.length ? a.users.map(u => `
        <button class="qa-row" data-id="${esc(u.id)}"><i class="${u.online ? 'on' : ''}"></i>
          <span class="n"><b>${esc(u.username ? '@' + u.username : u.name)}</b><small>${u.username ? esc(u.name) + ' · ' : ''}${u.online ? (u.table ? 'за столом ' + esc(u.table) : 'в лобби') : 'был ' + ago(u.lastSeen || u.createdAt)} · ${fmt(u.hands)} рук</small></span>
          <span class="v">${fmt(u.balance + u.tableStack)}</span></button>`).join('') : '<div class="none">Никого не нашли</div>';
      box.querySelectorAll<HTMLButtonElement>('.qa-row').forEach(b => b.onclick = () => {
        this.H.tap();
        this.adminUser = a.users!.find(u => u.id === b.dataset.id) || null;
        this.adminShow('ctl');
      });
      return;
    }
    if (this.adminTab !== 'ctl') { if (a.text && !a.overview && !a.events && !a.users) this.H.toast(a.text, a.ok); return; }
    const out = pane.querySelector('.qa-out') as HTMLElement | null;
    if (out && a.text && !a.user) { out.className = 'qa-out ' + (a.ok ? 'ok' : 'err'); out.textContent = a.text; }
    if (a.user) {
      this.adminUser = a.user;
      this.renderAdminUser();
      if (a.text && a.userEvents === undefined) this.H.toast(a.text, a.ok);
      if (a.userEvents) (pane.querySelector('.qa-uev') as HTMLElement).innerHTML = a.userEvents.length ? evList(a.userEvents) : '<div class="none">Пока ничего</div>';
      else this.H.send({ t: 'ADMIN', op: 'find', target: a.user.id });
    } else if (!a.ok && a.text) this.H.toast(a.text, false);
  }

  private renderOverview(pane: HTMLElement, o: AdminOverview) {
    const d = o.days[0], y = o.days[1];
    const net = d.won - d.lost;
    const cmp = (now: number, was: number) => was ? `<em class="${now >= was ? 'up' : 'dn'}">${now >= was ? '▲' : '▼'} ${Math.abs(Math.round(((now - was) / was) * 100))}%</em>` : '';
    const card = (label: string, value: string, sub = '', cls = '') => `<div class="qa-k ${cls}"><small>${label}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
    const maxT = Math.max(1, ...o.days.map(x => x.turnover));
    const week = [...o.days].reverse().map(x => `<div class="qa-bar${x === d ? ' today' : ''}"><i style="height:${Math.max(3, (x.turnover / maxT) * 100)}%"></i><b>${short(x.turnover)}</b><small>${x.day.slice(8)}.${x.day.slice(5, 7)}</small></div>`).join('');
    pane.innerHTML = `
      <div class="lh-label">Сегодня · ${d.day.slice(8)}.${d.day.slice(5, 7)} (по Москве)</div>
      <div class="qa-kpi">
        ${card('Оборот (сумма банков)', fmt(d.turnover), cmp(d.turnover, y.turnover) + ' вчера ' + fmt(y.turnover), 'wide gold')}
        ${card('Игроки выиграли', '+' + fmt(d.won), '', 'up')}
        ${card('Игроки проиграли', '−' + fmt(d.lost), '', 'dn')}
        ${card('Итог игроков', (net >= 0 ? '+' : '−') + fmt(Math.abs(net)), net >= 0 ? 'обыграли ботов' : 'проиграли ботам')}
        ${card('Раздач', fmt(d.hands), 'самый большой банк ' + fmt(d.biggestPot))}
        ${card('Онлайн сейчас', fmt(o.online), 'пик за день ' + fmt(d.peakOnline))}
        ${card('Заходили сегодня', fmt(d.players), 'новых ' + fmt(d.newPlayers))}
        ${card('Колесо выдало', fmt(d.wheel))}
        ${card('Угощение 1 000', fmt(d.refill))}
        ${card('Переводы', fmt(d.transfers), 'комиссия ' + fmt(d.fees))}
        ${card('Вы выдали / забрали', fmt(d.adminGiven) + ' / ' + fmt(d.adminTaken))}
        ${card('Призы турнира', fmt(d.tourneyPrizes), 'столов открыто ' + fmt(d.tables))}
      </div>
      <div class="lh-label">Оборот за неделю</div>
      <div class="qa-week">${week}</div>
      <div class="lh-label">Весь клуб</div>
      <div class="qa-kpi">
        ${card('Аккаунтов', fmt(o.users))}
        ${card('Фишек у игроков', short(o.chipsTotal), 'из них на столах ' + short(o.chipsOnTables))}
      </div>
      <div class="lh-label">Онлайн · ${o.onlineUsers.length}</div>
      <div class="qa-users">${o.onlineUsers.length ? o.onlineUsers.map(u => `<button class="qa-row" data-id="${esc(u.id)}"><i class="on"></i><span class="n"><b>${esc(u.username ? '@' + u.username : u.name)}</b><small>${u.table ? 'стол ' + esc(u.table) : 'в лобби'}</small></span><span class="v">${fmt(u.balance + u.tableStack)}</span></button>`).join('') : '<div class="none">Сейчас никого</div>'}</div>
      <div class="lh-label">Столы · ${o.tables.length}</div>
      <div class="qa-tables">${o.tables.length ? o.tables.map(t => `<div class="qa-t"><b>${esc(t.id)}${t.tourney ? ' <em>турнир</em>' : ''}</b><span>${esc(t.blinds)} · ${t.players}/6 · раздача №${t.hands}${t.pot ? ' · в банке ' + fmt(t.pot) : ''}</span><small>${t.humans.length ? t.humans.map(esc).join(', ') : 'только боты'}</small></div>`).join('') : '<div class="none">Открытых столов нет</div>'}</div>
      <div class="lh-label">Что происходит</div>
      <div class="qa-events">${evList(o.events.slice(0, 30))}</div>`;
    pane.querySelectorAll<HTMLButtonElement>('.qa-row').forEach(b => b.onclick = () => {
      this.H.tap();
      this.adminUser = o.onlineUsers.find(u => u.id === b.dataset.id) || null;
      this.adminShow('ctl');
    });
  }

  private renderAdminUser() {
    const m = this.modal;
    const u = this.adminUser;
    if (!m || !u || this.adminTab !== 'ctl') return;
    (m.querySelector('.qa-tools') as HTMLElement).hidden = false;
    const lv = levelOf(u.xp);
    (m.querySelector('.qa-user') as HTMLElement).innerHTML = `
      <div class="qa-card"><div class="av">${esc((u.name || '?')[0].toUpperCase())}</div>
        <div class="who"><b>${esc(u.name)}</b><span>${u.username ? '@' + esc(u.username) : 'без username'} · ${u.online ? '<em class="on">онлайн</em>' : 'был ' + ago(u.lastSeen || u.createdAt)}${u.code ? ' · ' + esc(u.code) : ''}</span>
        ${u.table ? `<span>за столом ${esc(u.table)}</span>` : ''}</div></div>
      <div class="qm-stats qa-st">
        <div><b>${fmt(u.balance)}</b><small>баланс</small></div>
        <div><b>${fmt(u.tableStack)}</b><small>за столом</small></div>
        <div><b>${fmt(u.hands)}</b><small>рук · ${fmt(u.wins)} побед</small></div>
        <div><b>${lv}</b><small>уровень сезона</small></div>
      </div>
      <div class="qa-meta">В клубе с ${new Date(u.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
      ${u.unlocks.length ? `<div class="qa-items">${u.unlocks.map(id => `<span>${esc(UNLOCKS.find(x => x.id === id)?.name || id)}</span>`).join('')}</div>` : ''}`;
  }

  /** Итоги после выхода из-за стола */
  showSummary(r: { hands: number; won: number; net: number; bestHand: string; biggestPot: number; minutes: number }) {
    const up = r.net >= 0;
    const body = this.openModal('summary', 'Итоги за столом', `${r.minutes} мин за столом`);
    body.innerHTML = `
      <div class="qm-net ${up ? 'up' : 'down'}"><small>${up ? 'Вы в плюсе' : 'Вы в минусе'}</small><b>${up ? '+' : '−'}${fmt(Math.abs(r.net))}</b></div>
      <div class="qm-stats">
        <div><b>${fmt(r.hands)}</b><small>сыграно рук</small></div>
        <div><b>${fmt(r.won)}</b><small>выиграно</small></div>
        <div><b>${r.bestHand ? esc(r.bestHand) : '—'}</b><small>лучшая рука</small></div>
        <div><b>${fmt(r.biggestPot)}</b><small>самый большой выигрыш</small></div>
      </div>
      <button class="lobby-btn gold big qm-ok">В лобби</button>`;
    (body.querySelector('.qm-ok') as HTMLElement).onclick = () => this.closeModal();
    if (up && r.net > 0) this.burst(body.querySelector('.qm-net') as HTMLElement);
  }

  /** открыть пункт меню снаружи (плитки лобби) */
  open(kind: 'wheel' | 'profile' | 'tables' | 'ref' | 'top' | 'look' | 'tourney' | 'season') {
    ({ wheel: () => this.openWheel(), profile: () => this.openProfile(), tables: () => this.openTables(), ref: () => this.openRef(), top: () => this.openTop(), look: () => this.openLook(), tourney: () => this.openTourney(), season: () => this.openSeason() })[kind]();
  }
}

function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
  return many;
}

/** «5 мин назад», «вчера в 21:40» */
function ago(t: number) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  return new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function short(n: number) {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + ' млн';
  if (Math.abs(n) >= 1e4) return Math.round(n / 1000) + ' тыс';
  return Math.round(n).toLocaleString('ru-RU');
}
function confirmNum(v: string) { return confirm(`Установить баланс ровно ${Number(v).toLocaleString('ru-RU')}?`); }
const EV_ICON: Record<string, string> = { join: '→', new: '★', table: '◎', win: '♠', wheel: '✺', transfer: '⇄', refill: '☕', tourney: '☾', admin: '⚿', ref: '✉' };
function evList(list: ClubEvent[]) {
  if (!list.length) return '<div class="none">Пока ничего</div>';
  return list.map(e => {
    const d = new Date(e.at);
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
    const day = Date.now() - e.at > 20 * 3600_000 ? d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' }) + ' ' : '';
    return `<div class="qa-ev k-${e.kind}"><i>${EV_ICON[e.kind] || '·'}</i><span>${esc(e.text)}</span><time>${day}${time}</time></div>`;
  }).join('');
}
