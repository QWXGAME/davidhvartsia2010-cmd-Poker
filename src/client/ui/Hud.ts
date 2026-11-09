import * as THREE from 'three';
// Интерфейс поверх 3D: плашки игроков, банк, кнопки действий, рейз, show/muck, бутик, тосты.

import type { TableView, SeatView } from '../../shared/Table';
import type { Profile } from '../../shared/Catalog';
import { CATALOG } from '../../shared/Catalog';
import type { World } from '../scene/World';
import { MAX_SEATS } from '../../shared/Table';
import { makeHint } from '../../shared/Hints';
import { equity } from '../../shared/Bots';
import { Telegram } from '../telegram';
import { rollTo } from './roll';

const fmt = (n: number) => {
  if (n >= 10_000_000) return (n / 1_000_000).toFixed(1).replace('.', ',') + ' М';
  return Math.round(n).toLocaleString('ru-RU');
};

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
  music(): boolean;
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
  private plateAt = new THREE.Vector3();
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

  constructor(private world: World, private H: HudHandlers) {
    document.body.appendChild(this.ui);
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
    const music = h('button', 'icon-btn', ICON.note) as HTMLButtonElement;
    music.title = 'Музыка';
    music.onclick = () => { const on = this.H.music(); music.classList.toggle('off', !on); Telegram.haptic('tap'); };
    try { if (localStorage.getItem('pn.music2') === '0') music.classList.add('off'); } catch { /* */ }
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
    void squeeze; void invite; void icons; void bulb; void send; void music; void shop; void exit;
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
      <div class="sub">Получатель — Telegram-юзернейм игрока, который хоть раз входил в клуб через Telegram. Комиссия клуба 5%.</div>
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
      const u = to.value.trim().replace(/^@/, '');
      if (!u || !n) { this.toast('Укажите юзернейм и сумму', false); return; }
      this.H.transfer(u, n);
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
    if (un) un.textContent = this.profile?.username ? `Ваш юзернейм: @${this.profile.username} · баланс ${fmt(this.profile.balance)}` : 'Чтобы получать переводы, войдите через Telegram';
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
      const who = r.dir === 'out' ? `→ @${esc(r.to)}` : `← @${esc(r.from)}`;
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
    this.rail.classList.add('hidden');
    this.world.buttons.group.visible = false;
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
    (this.tableInfo.lastChild as HTMLElement).textContent = `${v.sb} / ${v.bb}`;

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
    // HTML-панель больше не показываем: действия — латунные таблички в борту стола (3D)
    this.rail.classList.add('hidden');
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
    this.rebuyBox.classList.toggle('hidden', !(me && me.stack === 0 && (v.stage === 'HAND_OVER' || v.stage === 'WAITING' || !me.inHand)));

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
    const B = this.world.buttons;
    B.group.visible = atTable;
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
    const st = this.world.stage;
    for (let i = 0; i < MAX_SEATS; i++) {
      const s = v.seats[i];
      const t = this.tags[i];
      if (!s || i === v.mySeat) continue;
      st.project(this.world.seatAnchor(i), this.pos);
      if (this.pos.visible) {
        const half = (t.root.offsetWidth || 100) / 2 + 6;
        const top = (t.root.offsetHeight || 60) + 56;
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
    if (innerWidth / innerHeight < 1.25 && this.world.buttons.group.visible) {
      let top = innerHeight;
      for (const p of this.world.buttons.plates) {
        p.root.getWorldPosition(this.plateAt);
        this.plateAt.y += 0.09; this.plateAt.z -= 0.05;   // верхний край кнопки
        st.project(this.plateAt, this.pos);
        top = Math.min(top, this.pos.y);
      }
      this.bottomEl.style.bottom = `${Math.max(14, innerHeight - top + 10).toFixed(0)}px`;
      this.bottomEl.classList.toggle('raising', !this.raiseBox.classList.contains('hidden'));
    } else {
      this.bottomEl.style.bottom = '';
      this.bottomEl.classList.remove('raising');
    }
    st.project(this.world.boardAnchor(), this.pos);
    // банк — над общими картами
    this.pot.style.transform = `translate3d(${this.pos.x.toFixed(1)}px, ${(this.pos.y - 26).toFixed(1)}px, 0) translate(-50%, -100%)`;
  }
}
