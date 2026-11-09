// Общее меню клуба: одна круглая кнопка справа наверху раскрывает панель со всеми функциями.
// Работает и в лобби, и за столом. Новые функции добавляются сюда же — одной строкой в items().

import type { ClientMsg, Profile } from '../../shared/Catalog';
import { WHEEL, REF_BONUS } from '../../shared/Catalog';
import type { TablesInfo, WheelResult } from '../net';
import { Identity } from '../identity';
import { Telegram } from '../telegram';
import { CARD_BACKS, currentBack } from '../scene/textures';
import { rollTo } from './roll';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
};
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export const FELTS: { id: string; name: string; color: string }[] = [
  { id: 'bordeaux', name: 'Бордо', color: '#56172a' },
  { id: 'emerald', name: 'Изумруд', color: '#0f4a34' },
  { id: 'midnight', name: 'Полночь', color: '#14213d' },
];
export function savedFelt(def: string) {
  try { const v = localStorage.getItem('pn.felt'); return FELTS.find(f => f.color === v)?.color || def; } catch { return def; }
}

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
  music(): boolean;
  toggleMusic(): boolean;
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
    if (this.modal?.dataset.kind === 'profile') this.renderProfile(this.modal.querySelector('.qm-body')!);
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
    ];
    const table: Item[] = this.atTable ? [
      { id: 'inv', icon: ICON.invite, label: 'Позвать за стол', sub: 'ссылка на этот стол', run: () => { this.toggle(false); H.inviteTable(); } },
      { id: 'exit', icon: ICON.exit, label: 'Выйти из-за стола', sub: 'фишки вернутся на баланс', run: () => { this.toggle(false); H.leave(); } },
    ] : [];
    const settings: Item[] = [
      { id: 'look', icon: ICON.palette, label: 'Оформление', sub: 'сукно и рубашка карт', run: () => this.openLook() },
      { id: 'hints', icon: ICON.bulb, label: 'Подсказки', sub: H.hints() ? 'включены' : 'выключены', on: H.hints(), run: () => { H.toggleHints(); this.render(); } },
      { id: 'music', icon: ICON.note, label: 'Музыка', sub: H.music() ? 'играет' : 'выключена', on: H.music(), run: () => { H.toggleMusic(); this.render(); } },
    ];
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
      <div class="qm-stats">
        <div><b>${fmt(st.hands)}</b><small>сыграно рук</small></div>
        <div><b>${fmt(st.wins)}</b><small>выиграно рук</small></div>
        <div class="ring" style="--p:${pct}"><b>${pct}%</b><small>процент побед</small></div>
        <div><b>${fmt(st.biggestPot)}</b><small>самый большой банк</small></div>
        <div><b>${fmt(st.refs)}</b><small>друзей пришло</small></div>
      </div>`;
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
    const felt = savedFelt(FELTS[0].color);
    const back = currentBack();
    body.innerHTML = `
      <div class="lh-label">Сукно стола</div>
      <div class="qm-sw felt">${FELTS.map(f => `<button data-c="${f.color}" class="${f.color === felt ? 'on' : ''}"><i style="--c:${f.color}"></i><span>${f.name}</span></button>`).join('')}</div>
      <div class="lh-label">Рубашка карт</div>
      <div class="qm-sw backs">${Object.entries(CARD_BACKS).map(([id, b]) => `<button data-b="${id}" class="${id === back ? 'on' : ''}"><i class="card" style="--c:${b.bg};--l:${b.line};--f:${b.frame}"></i><span>${b.name}</span></button>`).join('')}</div>`;
    body.querySelectorAll<HTMLButtonElement>('.felt button').forEach(b => b.onclick = () => {
      this.H.tap();
      body.querySelectorAll('.felt button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      try { localStorage.setItem('pn.felt', b.dataset.c!); } catch { /* */ }
      this.H.setFelt(b.dataset.c!);
    });
    body.querySelectorAll<HTMLButtonElement>('.backs button').forEach(b => b.onclick = () => {
      this.H.tap();
      body.querySelectorAll('.backs button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      this.H.setBack(b.dataset.b!);
    });
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
  open(kind: 'wheel' | 'profile' | 'tables' | 'ref' | 'top' | 'look') {
    ({ wheel: () => this.openWheel(), profile: () => this.openProfile(), tables: () => this.openTables(), ref: () => this.openRef(), top: () => this.openTop(), look: () => this.openLook() })[kind]();
  }
}

function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
  return many;
}
