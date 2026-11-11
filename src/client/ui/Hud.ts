// Интерфейс поверх 3D: плашки игроков, банк, кнопки действий, рейз, show/muck, бутик, тосты.

import type { TableView, SeatView } from '../../shared/Table';
import type { Profile } from '../../shared/Catalog';
import { CATALOG } from '../../shared/Catalog';
import type { TableHost } from '../scene/host';
import { MAX_SEATS } from '../../shared/Table';
import { makeHint } from '../../shared/Hints';
import { equity } from '../../shared/Bots';
import { Telegram } from '../telegram';
import { rollTo } from './roll';

const fmt = (n: number) => {
  if (n >= 10_000_000) return (n / 1_000_000).toFixed(1).replace('.', ',') + ' М';
  return Math.round(n).toLocaleString('ru-RU');
};

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
  return many;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '') => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
};

const ICON = {
  hat: '<svg viewBox="0 0 24 24"><path d="M3 17c3 2 15 2 18 0M6 16.5 7.5 8c.3-1.6 2-2.4 3.4-1.6l1.1.6 1.1-.6c1.4-.8 3.1 0 3.4 1.6L18 16.5M7 12.5c3 1 7 1 10 0"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
  card: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="12" height="17" rx="2"/><path d="M8 3.5 10 2l9 2.5-3 15"/></svg>',
  invite: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M18 7v6M15 10h6"/></svg>',
  bulb: '<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z"/></svg>',
  exit: '<svg viewBox="0 0 24 24"><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/></svg>',
};

const ACT_LABEL: Record<string, string> = {
  FOLD: 'Фолд', CHECK: 'Чек', CALL: 'Колл', RAISE: 'Рейз', ALLIN: 'Олл-ин', SB: 'SB', BB: 'BB',
};

function miniCard(code: string, win = false) {
  const suit = { s: '♠', h: '♥', d: '♦', c: '♣' }[code[1]]!;
  const r = code[0] === 'T' ? '10' : code[0];
  const red = code[1] === 'h' || code[1] === 'd';
  return `<div class="mini-card${red ? ' red' : ''}${win ? ' win' : ''}">${r}<span>${suit}</span></div>`;
}

interface Tag { root: HTMLElement; box: HTMLElement; name: HTMLElement; stack: HTMLElement; act: HTMLElement; timer: HTMLElement; reveal: HTMLElement; won: HTMLElement; dealer: HTMLElement; actKey: string; dl: number; total: number }

export interface HudHandlers {
  action(type: 'FOLD' | 'CHECK' | 'CALL' | 'RAISE' | 'ALLIN', amount?: number): void;
  reveal(which: 'NONE' | 'ONE' | 'BOTH'): void;
  shop(itemId: string): void;
  press(): void;
  leave(): void;
  rebuy(): void;
  transfer(to: string, amount: number): void;
  history(): void;
}

export class Hud {
  private ui = h('div', 'ui');
  private tags: Tag[] = [];
  private pot = h('div', 'pot');
  private me = h('div', 'me');
  private meStack = h('span', 'stack');
  private meHand = h('span', 'hand');
  private meTip = h('span', 'tip');
  private oddsKey = '';
  private oddsVal = 0;
  hintsOn = (() => { try { return localStorage.getItem('pn.hints') !== '0'; } catch { return true; } })();
  /** включить/выключить подсказки новичку */
  toggleHints() {
    this.hintsOn = !this.hintsOn;
    try { localStorage.setItem('pn.hints', this.hintsOn ? '1' : '0'); } catch { /* */ }
    this.toast(this.hintsOn ? 'Подсказки включены: комбинация, шанс и совет' : 'Подсказки выключены', true);
    this.hintBtn?.classList.toggle('off', !this.hintsOn);
    if (this.view) this.render(this.view);
    if (!this.hintsOn) this.world.highlightCodes([]);
  }
  private hintBtn?: HTMLButtonElement;
  private meDealer = h('div', 'dealer', 'D');
  private actions = h('div', 'plates');
  private rail = h('div', 'rail hidden');
  private pre = h('div', 'pre');
  private raiseBox = h('div', 'raise hidden');
  private revealBox = h('div', 'reveal-box hidden');
  private rebuyBox = h('div', 'actions hidden');
  private banner = h('div', 'banner');
  private toasts = h('div', 'toasts');
  private tableInfo = h('div', 'blinds');
  private dot = h('span', 'dot wait');
  private sheet = h('div', 'sheet');
  private sheetBack = h('div', 'sheet-back');
  private bottomEl!: HTMLElement;
  private inviteBtn!: HTMLButtonElement;
  private exitBtn!: HTMLButtonElement;
  private btnFold!: HTMLButtonElement;
  private btnCall!: HTMLButtonElement;
  private btnRaise!: HTMLButtonElement;
  private slider!: HTMLInputElement;
  private raiseVal!: HTMLElement;
  private preCheckFold!: HTMLButtonElement;
  private preCall!: HTMLButtonElement;
  private preMode: 'none' | 'checkfold' | 'call' = 'none';
  private view: TableView | null = null;
  private profile: Profile | null = null;
  private bannerHand = -1;
  private myTurnHand = '';
  private pos = { x: 0, y: 0, visible: false };
  onMyTurn?: () => void;
  onPreview?: (p: Profile) => void;

  // ── турнир: уровень, игроки, время до роста блайндов ──
  private tourney: TableView['tourney'] | null = null;
  private paintInfo() {
    const v = this.view;
    if (!v) return;
    const el = this.tableInfo.lastChild as HTMLElement;
    const t = this.tourney;
    document.body.classList.toggle('in-tourney', !!t);
    if (!t) { el.textContent = `${v.sb} / ${v.bb}`; return; }
    const ms = Math.max(0, t.nextAt - Date.now());
    el.innerHTML = `<b class="tn">${t.name}</b> · ${fmt(v.sb)}/${fmt(v.bb)} · ур. ${t.level} <i class="tl">↑ ${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}</i> · осталось ${t.left}`;
  }

  // ── долгое нажатие на соперника — его статистика ──
  private statsEl: HTMLElement | null = null;
  private closeStats() {
    const el = this.statsEl;
    if (!el) return;
    this.statsEl = null;
    el.classList.remove('open');
    setTimeout(() => el.remove(), 220);
  }
  private seatAt(x: number, y: number): number {
    const v = this.view;
    if (!v) return -1;
    let best = -1, bestD = 70 * 70;
    const p = { x: 0, y: 0, visible: false };
    for (let i = 0; i < MAX_SEATS; i++) {
      if (!v.seats[i] || i === v.mySeat) continue;
      this.world.seatScreen(i, p);
      if (!p.visible) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  private showStats(seat: number) {
    const s = this.view?.seats[seat];
    if (!s) return;
    this.closeStats();
    const st = s.stats || { hands: 0, vpip: 0, pfr: 0, af: 0, won: 0 };
    const style = st.hands < 8 ? 'мало рук — присматривайтесь' : st.vpip >= 40 ? (st.pfr >= 20 ? 'агрессивный, играет много' : 'играет много, часто коллирует') : st.vpip <= 18 ? (st.pfr >= 12 ? 'тайтовый и точный' : 'очень осторожный') : st.pfr >= 18 ? 'уверенный регуляр' : 'спокойный, без спешки';
    const el = h('div', 'pstats', `
      <div class="ph"><b>${esc(s.name)}</b><span>${fmt(st.hands)} ${plural(st.hands, 'рука', 'руки', 'рук')} за этим столом</span></div>
      <div class="pg">
        <div><b>${st.vpip}%</b><small>играет рук</small><i style="--p:${st.vpip}"></i></div>
        <div><b>${st.pfr}%</b><small>рейзит до флопа</small><i style="--p:${st.pfr}"></i></div>
        <div><b>${st.af}</b><small>агрессия</small><i style="--p:${Math.min(100, st.af * 25)}"></i></div>
        <div><b>${fmt(st.won)}</b><small>выиграл банков</small></div>
      </div>
      <div class="pt">${style}</div>`);
    const p = { x: 0, y: 0, visible: false };
    this.world.seatScreen(seat, p);
    el.style.left = Math.max(130, Math.min(innerWidth - 130, p.x)) + 'px';
    el.style.top = Math.max(110, Math.min(innerHeight - 120, p.y)) + 'px';
    el.onclick = () => this.closeStats();
    document.body.appendChild(el);
    this.statsEl = el;
    requestAnimationFrame(() => el.classList.add('open'));
    Telegram.haptic('tap');
  }
  private bindHold() {
    let timer = 0, sx = 0, sy = 0;
    const cancel = () => { clearTimeout(timer); timer = 0; };
    addEventListener('pointerdown', e => {
      if (this.statsEl && !(e.target as HTMLElement).closest('.pstats')) this.closeStats();
      if (!this.view || (e.target as HTMLElement).closest('button, input, .sheet, .xfer, .qm-panel, .bottom, .actions')) return;
      const seat = this.seatAt(e.clientX, e.clientY);
      if (seat < 0) return;
      sx = e.clientX; sy = e.clientY;
      cancel();
      timer = window.setTimeout(() => { timer = 0; this.showStats(seat); }, 480);
    }, { passive: true });
    addEventListener('pointermove', e => { if (timer && (e.clientX - sx) ** 2 + (e.clientY - sy) ** 2 > 100) cancel(); }, { passive: true });
    addEventListener('pointerup', cancel, { passive: true });
    addEventListener('pointercancel', cancel, { passive: true });
    addEventListener('contextmenu', e => { if (this.view && this.seatAt(e.clientX, e.clientY) >= 0) e.preventDefault(); });
  }

  constructor(private world: TableHost, private H: HudHandlers) {
    document.body.appendChild(this.ui);
    this.bindHold();
    setInterval(() => { if (this.tourney) this.paintInfo(); }, 1000);
    this.buildTop();
    for (let i = 0; i < MAX_SEATS; i++) this.tags.push(this.buildTag());
    this.ui.appendChild(this.pot);
    this.ui.appendChild(this.banner);
    this.ui.appendChild(this.toasts);
    this.buildBottom();
    this.buildShop();
  }

  // ───────────────────────── построение ─────────────────────────

  private buildTop() {
    const bar = h('div', 'topbar');
    this.tableInfo.append(this.dot, h('span', '', 'Стол'));
    const icons = h('div', 'icons');
    const shop = h('button', 'icon-btn', ICON.hat) as HTMLButtonElement;
    shop.title = 'VIP-бутик';
    shop.onclick = () => { this.openShop(true); Telegram.haptic('tap'); };
    const squeeze = h('button', 'icon-btn', ICON.card) as HTMLButtonElement;
    squeeze.title = 'Сквиз: карты закрыты, тяни вверх чтобы подсмотреть';
    const setSq = (v: boolean) => { this.world.squeezeMode = v; squeeze.classList.toggle('off', !v); };
    let sq = false;
    try { sq = localStorage.getItem('pn.squeeze') === '1'; } catch { /* */ }
    setSq(sq);
    squeeze.onclick = () => {
      sq = !sq; setSq(sq);
      try { localStorage.setItem('pn.squeeze', sq ? '1' : '0'); } catch { /* */ }
      this.toast(sq ? 'Сквиз включён — тяни карты вверх' : 'Карты открываются сами', true);
    };
    const invite = h('button', 'icon-btn', ICON.invite) as HTMLButtonElement;
    invite.title = 'Позвать друга';
    invite.onclick = () => {
      const l = this.view?.lobby;
      if (l) Telegram.share(l.invite || location.href, `Садись за мой стол в QWX POKER · код ${l.id}`);
      Telegram.haptic('tap');
    };
    const exit = h('button', 'icon-btn', ICON.exit) as HTMLButtonElement;
    exit.title = 'Выйти из-за стола';
    exit.onclick = () => { Telegram.haptic('tap'); this.H.leave(); };
    this.inviteBtn = invite;
    this.exitBtn = exit;
    // минимум: музыка, бутик, выход. Блайнды и статус — тонкой строкой, без плашек
    const send = h('button', 'icon-btn', ICON.send) as HTMLButtonElement;
    send.title = 'Перевод фишек';
    send.onclick = () => { Telegram.haptic('tap'); this.openTransfer(true); };
    const bulb = h('button', 'icon-btn' + (this.hintsOn ? '' : ' off'), ICON.bulb) as HTMLButtonElement;
    bulb.title = 'Подсказки новичку';
    bulb.onclick = () => { Telegram.haptic('tap'); this.toggleHints(); };
    this.hintBtn = bulb;
    // все кнопки живут в общем меню клуба (Menu.ts) — здесь только строка со ставками стола
    void squeeze; void invite; void icons; void bulb; void send; void shop; void exit;
    bar.append(this.tableInfo);
    this.ui.appendChild(bar);
  }

  private buildTag(): Tag {
    const root = h('div', 'tag');
    const act = h('div', 'act');
    const box = h('div', 'box');
    const name = h('div', 'name');
    const stack = h('div', 'stack');
    const timer = h('div', 'timer hidden');
    const dealer = h('div', 'dealer hidden', 'D');
    box.append(name, stack, timer, dealer);
    const reveal = h('div', 'reveal');
    const won = h('div', 'won');
    root.append(won, act, box, reveal);
    this.ui.appendChild(root);
    return { root, box, name, stack, act, timer, reveal, won, dealer, actKey: '', dl: 0, total: 1 };
  }

  private buildBottom() {
    const bottom = h('div', 'bottom');
    this.bottomEl = bottom;
    // баланс: тонкая латунная подпись над столом, без коробки и без мини-карт (карты лежат на сукне)
    this.me.append(this.meHand, this.meTip, h('span', 'lbl', 'Фишки'), this.meStack, this.meDealer);

    // рейз
    this.raiseVal = h('div', 'val');
    this.slider = h('input') as HTMLInputElement;
    this.slider.type = 'range';
    this.slider.oninput = () => { this.updateRaiseLabel(); Telegram.haptic('select'); };
    const presets = h('div', 'presets');
    const P: [string, (v: TableView) => number][] = [
      ['Мин', v => v.minRaiseTo],
      ['½ банка', v => this.potRaise(v, 0.5)],
      ['¾', v => this.potRaise(v, 0.75)],
      ['Банк', v => this.potRaise(v, 1)],
      ['Олл-ин', v => v.maxRaiseTo],
    ];
    for (const [label, f] of P) {
      const b = h('button', '', label) as HTMLButtonElement;
      b.onclick = () => {
        if (!this.view) return;
        this.slider.value = String(this.clampRaise(f(this.view)));
        this.updateRaiseLabel();
        Telegram.haptic('select');
      };
      presets.appendChild(b);
    }
    this.raiseBox.append(this.raiseVal, this.slider, presets);

    // кнопки
    this.btnFold = h('button', 'plate', 'Фолд') as HTMLButtonElement;
    this.btnCall = h('button', 'plate', 'Чек') as HTMLButtonElement;
    this.btnRaise = h('button', 'plate gold', 'Рейз') as HTMLButtonElement;
    for (const b of [this.btnFold, this.btnCall, this.btnRaise]) {
      b.addEventListener('pointerdown', () => { if (!b.disabled) this.H.press(); });
    }
    this.btnFold.onclick = () => this.act('FOLD');
    this.btnCall.onclick = () => this.act(this.view?.canCheck ? 'CHECK' : 'CALL');
    this.btnRaise.onclick = () => {
      const v = this.view;
      if (!v) return;
      if (this.raiseBox.classList.contains('hidden')) {
        this.slider.min = String(v.minRaiseTo);
        this.slider.max = String(v.maxRaiseTo);
        this.slider.step = String(Math.max(1, v.sb));
        this.slider.value = String(this.clampRaise(this.potRaise(v, 0.66)));
        this.updateRaiseLabel();
        this.raiseBox.classList.remove('hidden');
        this.btnRaise.innerHTML = 'Поставить';
        Telegram.haptic('tap');
        this.syncPlates();
      } else {
        const amt = Number(this.slider.value);
        this.act(amt >= v.maxRaiseTo ? 'ALLIN' : 'RAISE', amt);
      }
    };
    this.actions.append(this.btnFold, this.btnCall, this.btnRaise);
    this.rail.append(this.actions);
    // таблички в борту нажимают те же кнопки
    this.world.onPlate = i => {
      const b = [this.btnFold, this.btnCall, this.btnRaise][i];
      if (b.disabled) return;
      this.H.press();
      // табличка проседает — действие уходит после щелчка
      setTimeout(() => b.click(), 170);
    };

    // пре-действия
    this.preCheckFold = h('button', '', 'Чек / фолд') as HTMLButtonElement;
    this.preCall = h('button', '', 'Колл любую') as HTMLButtonElement;
    this.preCheckFold.onclick = () => this.setPre(this.preMode === 'checkfold' ? 'none' : 'checkfold');
    this.preCall.onclick = () => this.setPre(this.preMode === 'call' ? 'none' : 'call');
    this.pre.append(this.preCheckFold, this.preCall);

    // show / muck
    const muck = h('button', 'btn', 'Сбросить') as HTMLButtonElement;
    const one = h('button', 'btn', 'Показать 1') as HTMLButtonElement;
    const both = h('button', 'btn primary', 'Вскрыть блеф') as HTMLButtonElement;
    muck.onclick = () => { this.H.reveal('NONE'); this.revealBox.classList.add('hidden'); };
    one.onclick = () => { this.H.reveal('ONE'); this.revealBox.classList.add('hidden'); Telegram.haptic('tap'); };
    both.onclick = () => { this.H.reveal('BOTH'); this.revealBox.classList.add('hidden'); Telegram.haptic('bet'); };
    this.revealBox.append(muck, one, both);

    const rebuy = h('button', 'btn primary', 'Докупиться') as HTMLButtonElement;
    rebuy.onclick = () => { this.H.rebuy(); Telegram.haptic('bet'); };
    this.rebuyBox.append(rebuy);

    bottom.append(this.raiseBox, this.revealBox, this.me, this.pre, this.rebuyBox);
    this.ui.appendChild(this.rail);
    this.ui.appendChild(bottom);
  }

  private buildShop() {
    this.sheetBack.className = 'sheet-back';
    this.sheetBack.onclick = () => this.openShop(false);
    document.body.append(this.sheetBack, this.sheet);
    // свайп вниз закрывает
    let y0 = 0;
    this.sheet.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; }, { passive: true });
    this.sheet.addEventListener('touchmove', e => {
      const dy = e.touches[0].clientY - y0;
      if (dy > 0) this.sheet.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    this.sheet.addEventListener('touchend', e => {
      const dy = e.changedTouches[0].clientY - y0;
      this.sheet.style.transform = '';
      if (dy > 90) this.openShop(false);
    });
    this.renderShop();
  }

  private renderShop() {
    const p = this.profile;
    const bal = p ? fmt(p.balance) : '—';
    this.sheet.innerHTML = `
      <div class="grab"></div>
      <div class="head">
        <div><h2>VIP-бутик</h2><div class="sub">Вещи лежат у твоих рук — их видят все. На столе — до двух</div></div>
        <div class="bal">Фишки<b>${bal}</b></div>
      </div>`;
    const list = h('div', 'items');
    if (!CATALOG.length) {
      list.innerHTML = '<div class="shop-empty">Витрина пока пуста.<br>Скоро здесь появятся вещи для твоего места за столом.</div>';
    }
    for (const it of CATALOG) {
      const owned = p?.owned.includes(it.id);
      const onTable = p?.equipped.items.includes(it.id);
      const b = h('button', 'item' + (onTable ? ' eq' : '')) as HTMLButtonElement;
      b.innerHTML = `
        <div class="sw"${(() => { const u = this.world.itemThumb(it.model); return u ? ` style="background:radial-gradient(circle at 50% 40%,#3a1620,#120709) center/cover;background-image:url(${u}),radial-gradient(circle at 50% 40%,#3a1620,#120709)"` : ''; })()}></div>
        <div class="t"><b>${it.name}</b><span>${it.note}</span></div>
        <div class="pr${owned ? ' own' : ''}">${onTable ? 'На столе' : owned ? 'Положить' : fmt(it.price)}</div>`;
      b.onclick = () => { this.H.shop(it.id); Telegram.haptic(owned ? 'select' : 'bet'); };
      list.appendChild(b);
    }
    this.sheet.append(list);
  }

  // ───────────────────────── перевод фишек ─────────────────────────

  private xfer = h('div', 'xfer');
  private xferBack = h('div', 'sheet-back');

  private buildTransfer() {
    this.xfer.innerHTML = `
      <div class="head"><h2>Перевод фишек</h2><button class="x" aria-label="Закрыть">×</button></div>
      <div class="sub">Получатель — Telegram-юзернейм игрока клуба, например @ivan_petrov. Комиссия клуба 5%.</div>
      <label>Кому<input class="to" placeholder="@username" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="33"></label>
      <label>Сколько<input class="amt" inputmode="numeric" placeholder="1 000" maxlength="10"></label>
      <div class="calc"></div>
      <button class="lobby-btn gold big go">Отправить</button>
      <div class="me-un"></div>
      <div class="hist-title">История</div>
      <div class="hist"><div class="none">Переводов пока не было</div></div>`;
    const to = this.xfer.querySelector('.to') as HTMLInputElement;
    const amt = this.xfer.querySelector('.amt') as HTMLInputElement;
    const calc = this.xfer.querySelector('.calc') as HTMLElement;
    const upd = () => {
      const n = Number(amt.value.replace(/\D/g, '')) || 0;
      amt.value = n ? fmt(n) : '';
      calc.textContent = n ? `Получит ${fmt(n - Math.floor(n * 0.05))}` : '';
    };
    amt.oninput = upd;
    (this.xfer.querySelector('.x') as HTMLElement).onclick = () => this.openTransfer(false);
    this.xferBack.onclick = () => this.openTransfer(false);
    (this.xfer.querySelector('.go') as HTMLButtonElement).onclick = () => {
      const n = Number(amt.value.replace(/\D/g, '')) || 0;
      const u = to.value.trim();
      if (!u || !n) { this.toast('Укажите @username и сумму', false); return; }
      const un = '@' + u.replace(/^@/, '');
      this.H.transfer(un, n);
      Telegram.haptic('bet');
      amt.value = ''; calc.textContent = '';
      this.openTransfer(false);
    };
    document.body.append(this.xferBack, this.xfer);
  }

  openTransfer(open: boolean) {
    if (open && !this.xfer.childElementCount) this.buildTransfer();
    if (open) this.H.history();
    const un = this.xfer.querySelector('.me-un') as HTMLElement | null;
    if (un) {
      const name = this.profile?.username ? '@' + this.profile.username : '';
      un.innerHTML = name ? `Ваш юзернейм: <b class="mycode">${name}</b> · баланс ${fmt(this.profile!.balance)}` : 'Чтобы получать переводы, задайте @username в настройках Telegram и войдите заново';
      const b = un.querySelector('.mycode') as HTMLElement | null;
      if (b && name) b.onclick = () => navigator.clipboard?.writeText(name).then(() => this.toast('Юзернейм скопирован', true), () => {});
    }
    this.xfer.classList.toggle('open', open);
    this.xferBack.classList.toggle('open', open);
  }

  showHistory(items: { at: number; from: string; to: string; amount: number; fee: number; dir: 'in' | 'out' }[]) {
    const box = this.xfer.querySelector('.hist') as HTMLElement | null;
    if (!box) return;
    const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    box.innerHTML = items.length ? items.map(r => {
      const d = new Date(r.at);
      const when = `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
      const who = r.dir === 'out' ? `→ ${esc(r.to)}` : `← ${esc(r.from)}`;
      const sum = r.dir === 'out' ? `−${fmt(r.amount)}` : `+${fmt(r.amount - r.fee)}`;
      return `<div class="row ${r.dir}"><span>${who}<i>${when}</i></span><b>${sum}</b></div>`;
    }).join('') : '<div class="none">Переводов пока не было</div>';
  }

  /** поделиться ссылкой на текущий стол */
  inviteTable() {
    const l = this.view?.lobby;
    if (l) Telegram.share(l.invite || location.href, `Садись за мой стол в QWX POKER · код ${l.id}`);
    else this.toast('Сначала сядьте за стол', false);
  }

  openShop(open: boolean) {
    this.sheet.classList.toggle('open', open);
    this.sheetBack.classList.toggle('open', open);
  }

  // ───────────────────────── данные ─────────────────────────

  setProfile(p: Profile) {
    this.profile = p;
    this.renderShop();
    this.onPreview?.(p);
  }

  /** Вне стола: прячем всё игровое. */
  home() {
    this.view = null;
    this.tourney = null;
    document.body.classList.remove('my-turn', 'in-tourney');
    this.closeStats();
    this.rail.classList.add('hidden');
    this.world.plates.visible = false;
    this.raiseBox.classList.add('hidden');
    this.revealBox.classList.add('hidden');
    this.rebuyBox.classList.add('hidden');
    this.pre.classList.add('hidden');
    this.me.classList.add('hidden');
    this.pot.style.opacity = '0';
    this.banner.classList.remove('show');
    this.inviteBtn.classList.add('hidden');
    this.exitBtn.classList.add('hidden');
    for (const t of this.tags) t.root.classList.add('hidden');
  }

  setStatus(s: 'connecting' | 'online' | 'offline', online: boolean) {
    this.dot.className = 'dot' + (s === 'online' ? '' : s === 'connecting' ? ' wait' : ' off');
    if (!online) this.dot.className = 'dot off';
  }

  render(v: TableView) {
    const prev = this.view;
    this.view = v;
    this.tourney = v.tourney || null;
    this.paintInfo();

    // плашки
    for (let i = 0; i < MAX_SEATS; i++) {
      const s = v.seats[i];
      const t = this.tags[i];
      const isMe = i === v.mySeat;
      t.root.classList.toggle('hidden', !s || isMe);
      if (!s || isMe) continue;
      this.renderTag(t, s, v, prev);
    }

    // я
    const me = v.mySeat >= 0 ? v.seats[v.mySeat] : null;
    this.inviteBtn.classList.toggle('hidden', !v.lobby || v.seats.filter(Boolean).length >= 6);
    this.exitBtn.classList.toggle('hidden', !me);
    this.me.style.visibility = v.lobby && !v.lobby.started ? 'hidden' : '';
    const myTurn = !!me && v.activeSeat === v.mySeat;
    document.body.classList.toggle('my-turn', myTurn && v.stage !== 'HAND_OVER' && v.stage !== 'WAITING');
    this.me.classList.toggle('hidden', !me);
    this.me.classList.toggle('active', myTurn);
    if (me) rollTo(this.meStack, me.stack, fmt); else this.meStack.textContent = '';
    // подсказка новичку: что собралось и что делать
    const live = !!me && !me.folded && me.hasCards && v.stage !== 'WAITING' && v.stage !== 'HAND_OVER';
    const hint = live && this.hintsOn ? makeHint(me!.cards.filter(Boolean) as string[], v.board, v.toCall) : null;
    this.meHand.textContent = hint ? hint.name : (me && !me.folded && v.stage !== 'WAITING' ? v.handName || '' : '');
    // шанс выиграть: Monte-Carlo против оставшихся в раздаче (считается один раз на улицу, ~1500 розыгрышей)
    let odds = '';
    if (hint) {
      const opp = v.seats.filter(s => s && s.seat !== v.mySeat && s.inHand && !s.folded).length;
      const key = `${v.handId}:${v.board.length}:${opp}`;
      if (key !== this.oddsKey) { this.oddsKey = key; this.oddsVal = opp ? equity(me!.cards.filter(Boolean) as string[], v.board, opp, 1500) : 1; }
      odds = `Шанс выиграть ≈ ${Math.round(this.oddsVal * 100)}%`;
    }
    this.meTip.innerHTML = hint ? `<b>${odds}</b>${v.activeSeat === v.mySeat ? `<span>${hint.tip}</span>` : ''}` : '';
    this.meTip.className = 'tip l' + (hint?.level ?? 0);
    if (v.stage !== 'HAND_OVER') this.world.highlightCodes(hint ? hint.made : []);
    this.meDealer.classList.toggle('hidden', v.button !== v.mySeat);

    const best = new Set(v.winners.flatMap(w => w.best || []));
    // мои карты рядом со стеком
    const mine = me && !me.folded && me.hasCards ? (me.cards.filter(Boolean) as string[]) : [];
    const mineHtml = mine.map(c => miniCard(c, v.stage === 'HAND_OVER' && best.has(c))).join('');
    void mineHtml;

    // пот
    this.pot.innerHTML = `Банк<b>${fmt(v.pot)}</b>`;
    this.pot.style.opacity = v.pot > 0 && v.stage !== 'HAND_OVER' ? '1' : '0';

    // действия
    const inHand = !!me && me.inHand && !me.folded && !me.allIn && v.stage !== 'HAND_OVER' && v.stage !== 'WAITING';
    if (myTurn) {
      const key = `${v.handId}:${v.stage}:${v.toCall}`;
      // пре-действие
      if (this.preMode !== 'none') {
        const mode = this.preMode;
        this.setPre('none');
        // отправляем после отрисовки, чтобы не прерывать рендер
        queueMicrotask(() => this.act(mode === 'checkfold' ? (v.canCheck ? 'CHECK' : 'FOLD') : (v.canCheck ? 'CHECK' : 'CALL')));
      }
      if (this.myTurnHand !== key) {
        this.myTurnHand = key;
        this.onMyTurn?.();
      }
    }
    // борт с пластинами — всегда на месте, пока сидишь за столом; оживает на твоём ходу
    for (const b of [this.btnFold, this.btnCall, this.btnRaise]) b.disabled = !myTurn;
    this.pre.classList.toggle('hidden', myTurn || !inHand);
    if (!myTurn) this.raiseBox.classList.add('hidden');
    if (myTurn) {
      this.btnCall.innerHTML = v.canCheck ? 'Чек' : `Колл<small>${fmt(v.toCall)}</small>`;
      this.btnRaise.disabled = v.maxRaiseTo <= 0;
      if (this.raiseBox.classList.contains('hidden')) {
        this.btnRaise.innerHTML = v.maxRaiseTo > 0 && v.minRaiseTo >= v.maxRaiseTo ? 'Олл-ин' : (v.toCall > 0 || v.stage === 'PREFLOP' ? 'Рейз' : 'Бет');
      }
    }
    if (prev && (prev.handId !== v.handId)) this.setPre('none');
    if (this.preMode === 'call' && v.toCall > 0) this.preCall.innerHTML = `Колл ${fmt(v.toCall)}`;
    else this.preCall.innerHTML = 'Колл любую';

    this.syncPlates();

    // show / muck
    this.revealBox.classList.toggle('hidden', !v.canReveal);
    // докупиться
    this.rebuyBox.classList.toggle('hidden', !!v.tourney || !(me && me.stack === 0 && (v.stage === 'HAND_OVER' || v.stage === 'WAITING' || !me.inHand)));

    // баннер победителя
    if (v.stage === 'HAND_OVER' && v.winners.length && this.bannerHand !== v.handId) {
      this.bannerHand = v.handId;
      const w = v.winners[0];
      const who = w.seat === v.mySeat ? 'Вы забираете' : `${v.seats[w.seat]?.name ?? ''} забирает`;
      const total = v.winners.reduce((s, x) => s + x.amount, 0);
      const split = v.winners.length > 1 ? ` · делёж на ${v.winners.length}` : '';
      setTimeout(() => {
        this.banner.innerHTML = `<div class="who">${who}</div><div class="amt">${fmt(total)}</div><div class="hand">${w.handName ? w.handName + split : 'без вскрытия'}</div>`;
        this.banner.classList.add('show');
        if (w.seat === v.mySeat) Telegram.haptic('win');
      }, v.showdown ? 900 : 350);
      setTimeout(() => this.banner.classList.remove('show'), v.showdown ? 4600 : 2600);
    }
    if (v.stage !== 'HAND_OVER') this.banner.classList.remove('show');

    Telegram.guardClose(!!me && me.inHand && v.stage !== 'HAND_OVER' && v.stage !== 'WAITING');
  }

  private renderTag(t: Tag, s: SeatView, v: TableView, prev: TableView | null) {
    t.name.textContent = s.name;
    t.stack.textContent = s.allIn ? 'Олл-ин' : fmt(s.stack);
    t.root.classList.toggle('active', v.activeSeat === s.seat);
    t.root.classList.toggle('folded', s.folded || !s.inHand);
    t.dealer.classList.toggle('hidden', v.button !== s.seat);
    // действие
    const la = s.lastAction;
    const key = la ? `${v.handId}:${la.type}:${la.amount}` : '';
    if (key !== t.actKey) {
      t.actKey = key;
      if (la && la.type !== 'SB' && la.type !== 'BB') {
        const amt = la.type === 'CALL' || la.type === 'RAISE' || la.type === 'ALLIN' ? ` ${fmt(la.amount)}` : '';
        t.act.textContent = ACT_LABEL[la.type] + amt;
        t.act.className = 'act show ' + la.type.toLowerCase();
      } else {
        t.act.className = 'act';
      }
    }
    if (v.stage === 'HAND_OVER' && prev?.stage !== 'HAND_OVER') {
      // в конце раздачи тег действия гаснет через пару секунд
      setTimeout(() => { if (t.actKey === key) t.act.className = 'act'; }, 2500);
    }
    // вскрытые карты
    const shown = s.cards.filter(Boolean) as string[];
    const best = new Set(v.winners.flatMap(w => w.best || []));
    const html = shown.length ? shown.map(c => miniCard(c, best.has(c))).join('') : '';
    if (t.reveal.innerHTML !== html) t.reveal.innerHTML = html;
    // выигрыш
    const w = v.stage === 'HAND_OVER' ? v.winners.filter(x => x.seat === s.seat).reduce((a, x) => a + x.amount, 0) : 0;
    if (w > 0) {
      t.won.textContent = '+' + fmt(w);
      setTimeout(() => t.won.classList.add('show'), 700);
    } else t.won.classList.remove('show');
  }

  /** перенести надписи и доступность кнопок на 3D-таблички */
  private syncPlates() {
    const v = this.view;
    const me = v && v.mySeat >= 0 ? v.seats[v.mySeat] : null;
    const atTable = !!me && !!v?.lobby?.started;
    const B = this.world.plates;
    B.visible = atTable;
    // 2D: кнопки действий — обычные кнопки внизу экрана; 3D — таблички в борту стола
    this.rail.classList.toggle('hidden', this.world.kind === '3d' || !atTable);
    const read = (b: HTMLButtonElement) => {
      const small = b.querySelector('small')?.textContent || '';
      const main = (b.childNodes[0]?.textContent || b.textContent || '').trim();
      return [main, small] as const;
    };
    [this.btnFold, this.btnCall, this.btnRaise].forEach((b, i) => {
      const [main, small] = read(b);
      B.set(i, main.toUpperCase(), small, !b.disabled);
    });
    B.setLive(!!v && v.activeSeat === v.mySeat && v.mySeat >= 0);
    // 2D: кнопки выезжают только на моём ходу
    this.rail.classList.toggle('live', !!v && v.activeSeat === v.mySeat && v.mySeat >= 0 && v.stage !== 'HAND_OVER');
  }

  private setPre(m: 'none' | 'checkfold' | 'call') {
    this.preMode = m;
    this.preCheckFold.classList.toggle('on', m === 'checkfold');
    this.preCall.classList.toggle('on', m === 'call');
    if (m !== 'none') Telegram.haptic('select');
  }

  private act(type: 'FOLD' | 'CHECK' | 'CALL' | 'RAISE' | 'ALLIN', amount?: number) {
    this.raiseBox.classList.add('hidden');
    for (const b of [this.btnFold, this.btnCall, this.btnRaise]) b.disabled = true;
    this.syncPlates();
    this.H.action(type, amount);
    Telegram.haptic(type === 'FOLD' || type === 'CHECK' ? 'tap' : 'bet');
  }

  private potRaise(v: TableView, frac: number) {
    const me = v.seats[v.mySeat];
    const myBet = me?.bet ?? 0;
    // «в банк»: колл + доля (банк после колла)
    const potAfterCall = v.pot + v.toCall;
    return myBet + v.toCall + Math.round(potAfterCall * frac);
  }

  private clampRaise(x: number) {
    const v = this.view!;
    const step = Math.max(1, v.sb);
    const r = Math.round(x / step) * step;
    return Math.max(v.minRaiseTo, Math.min(v.maxRaiseTo, r));
  }

  private updateRaiseLabel() {
    const v = this.view;
    if (!v) return;
    const val = Number(this.slider.value);
    const min = Number(this.slider.min), max = Number(this.slider.max);
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 100;
    this.slider.style.setProperty('--p', pct + '%');
    const allIn = val >= v.maxRaiseTo;
    this.raiseVal.innerHTML = `<small>${allIn ? 'Олл-ин' : v.toCall > 0 || v.stage === 'PREFLOP' ? 'Рейз до' : 'Ставка'}</small>${fmt(val)}`;
  }

  toast(text: string, ok?: boolean) {
    const t = h('div', 'toast' + (ok === true ? ' ok' : ok === false ? ' bad' : ''), text);
    this.toasts.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; }, 2400);
    setTimeout(() => t.remove(), 2900);
  }

  // ───────────────────────── каждый кадр: позиции и таймер ─────────────────────────

  frame() {
    const v = this.view;
    if (!v) return;
    for (let i = 0; i < MAX_SEATS; i++) {
      const s = v.seats[i];
      const t = this.tags[i];
      if (!s || i === v.mySeat) continue;
      this.world.seatScreen(i, this.pos);
      if (this.pos.visible) {
        const half = (t.root.offsetWidth || 100) / 2 + 6;
        // 3D: не залезать под верхнюю строку; 2D: над печаткой только короткая надпись действия
        const top = this.world.kind === '2d' ? (t.root.offsetHeight || 24) + 4 : (t.root.offsetHeight || 60) + 56;
        const x = Math.max(half, Math.min(innerWidth - half, this.pos.x));
        const y = Math.max(top, this.pos.y);
        t.root.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
      }
      // таймер хода
      const active = v.activeSeat === i && v.deadline > 0;
      t.timer.classList.toggle('hidden', !active);
      if (active) {
        if (t.dl !== v.deadline) { t.dl = v.deadline; t.total = Math.max(1, v.deadline - Date.now()); }
        const left = Math.max(0, v.deadline - Date.now());
        t.timer.style.transform = `scaleX(${Math.min(1, left / t.total).toFixed(3)})`;
      }
    }
    // телефон (портрет): панель ставки и баланс всегда над 3D-кнопками в борту — не закрывают «Поставить»
    const top = this.world.plates.topY();
    if (top !== null) {
      this.bottomEl.style.bottom = `${Math.max(14, innerHeight - top + 10).toFixed(0)}px`;
      this.bottomEl.classList.toggle('raising', !this.raiseBox.classList.contains('hidden'));
    } else {
      this.bottomEl.style.bottom = '';
      this.bottomEl.classList.remove('raising');
    }
    this.world.boardScreen(this.pos);
    // банк — над общими картами
    this.pot.style.transform = `translate3d(${this.pos.x.toFixed(1)}px, ${(this.pos.y - 26).toFixed(1)}px, 0) translate(-50%, -100%)`;
  }
}
