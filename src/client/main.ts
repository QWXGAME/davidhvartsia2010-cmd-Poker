// Точка входа клиента Poker Noir.

import './ui/style.css';
import { Telegram } from './telegram';
import { Audio } from './audio';
import type { World } from './scene/World';
import type { TableHost, TableFx } from './scene/host';
import { Hud } from './ui/Hud';
import { Lobby } from './ui/Lobby';
import { AutoConn } from './net';
import { login } from './ui/Login';
import { Loading } from './ui/loading';
import { Identity } from './identity';
import { FELT_COLOR } from '../shared/Catalog';
import { Menu, savedFelt, FELTS } from './ui/Menu';
import { SessionTracker } from './session';
import { Smoke } from './ui/smoke';
import { viewMode, saveViewMode, applyTheme } from './looks';
import { PWA, weakDevice } from './pwa';

/** первый запуск на слабом телефоне: сразу предлагаем лёгкий 2D-стол */
function chooseView(): Promise<void> {
  return new Promise(res => {
    const el = document.createElement('div');
    el.className = 'view-ask';
    el.innerHTML = `<div class="va-card"><small>Первый запуск</small><h2>Как будем играть?</h2>
      <p>Похоже, телефон не самый мощный. Лёгкий 2D-стол работает плавно и бережёт батарею — 3D можно включить в любой момент в «Оформлении».</p>
      <button class="lobby-btn gold big" data-v="2d">2D · быстро и плавно</button>
      <button class="lobby-btn big" data-v="3d">3D · кино-зал</button></div>`;
    el.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.onclick = () => {
      saveViewMode(b.dataset.v as '2d' | '3d');
      el.classList.add('gone');
      setTimeout(() => { el.remove(); res(); }, 300);
    });
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('open'));
  });
}

async function boot() {
  Telegram.boot();
  PWA.boot();
  applyTheme();
  let firstRun = false;
  try { firstRun = !localStorage.getItem('pn.view'); } catch { /* */ }
  if (firstRun && weakDevice()) await chooseView();
  // конфиг входа запрашиваем сразу — пока строится сцена, ответ сервера уже придёт
  const base = ((import.meta.env.VITE_SERVER_URL as string | undefined) || location.origin).replace(/\/$/, '');
  const offlineOnly = new URLSearchParams(location.search).has('offline') || location.protocol === 'file:';
  type AuthCfg = { google?: string; telegram?: string; required?: boolean };
  const inlined = (window as unknown as { __QWX_CFG?: AuthCfg }).__QWX_CFG;
  const cfgFetch: Promise<AuthCfg | null> = offlineOnly ? Promise.resolve(null) : inlined ? Promise.resolve(inlined)
    : fetch(`${base}/auth/config`).then(r => (r.ok ? r.json() as Promise<AuthCfg> : null)).catch(() => null);

  // шрифты нужны до отрисовки карт и табличек на canvas
  Loading.done('code');
  await Promise.race([
    Promise.all([
      document.fonts.load('700 80px "Playfair Display"'),
      document.fonts.load('italic 600 40px "Playfair Display"'),
      document.fonts.load('800 40px "Bodoni Moda"'),
      document.fonts.load('600 14px "Manrope"'),
    ]),
    new Promise(r => setTimeout(r, 1800)),
  ]).catch(() => {});
  Loading.done('fonts');

  const audio = new Audio();

  // звуки и эффекты стола — одни и те же для 3D и 2D
  const fx: TableFx = {
    deal: () => audio.deal(),
    chips: n => audio.chips(n),
    check: () => audio.check(),
    fold: () => audio.fold(),
    flip: () => audio.flip(),
    collect: () => audio.collect(),
    paper: () => audio.paper(),
    heartbeat: () => { /* сердцебиение убрано */ },
    chipTick: () => audio.chipTick(0.7),
    win: mine => audio.win(mine),
    shuffle: () => audio.shuffle(),
    allin: () => {
      audio.allIn();
      Telegram.haptic('bet');
      document.body.classList.remove('allin-fx');
      void document.body.offsetWidth;
      document.body.classList.add('allin-fx');
      setTimeout(() => document.body.classList.remove('allin-fx'), 2600);
    },
  };

  // вид стола: 3D-зал (three.js) или лёгкий 2D-стол — в 2D трёхмерный движок вообще не скачивается
  const mode = viewMode();
  document.body.classList.add('mode-' + mode);
  let world: TableHost;
  let w3: World | null = null;
  let bakeMod: typeof import('./scene/bake') | null = null;
  if (mode === '3d') {
    const [{ World }, bake] = await Promise.all([import('./scene/World'), import('./scene/bake')]);
    bakeMod = bake;
    // запечённые текстуры: список файлов грузится заранее, сами картинки — параллельно со стартом сцены
    await bake.loadBakeManifest();
    w3 = new World(document.getElementById('stage')!, fx, { felt: savedFelt(FELT_COLOR), ring: 'RING_GOLD' });
    w3.onSqueeze = active => {
      // пока тянем карты — никаких системных свайпов
      document.body.style.overscrollBehavior = active ? 'none' : '';
    };
    w3.onPropTap = which => {
      if (which === 'glass') audio.pour();
      Telegram.haptic('tap');
    };
    world = w3;
  } else {
    const { Table2D } = await import('./two/Table2D');
    world = new Table2D(document.getElementById('stage')!, fx, { felt: savedFelt(FELT_COLOR) });
  }

  // ── соединение: сервер клуба (тот же сайт или VITE_SERVER_URL), при недоступности — тренировочный стол ──
  const wsBase = base.replace(/^http/, 'ws');
  // конфиг входа: null — сервер недоступен; required=false — режим разработки (без входа)
  let cfg: AuthCfg | null = null;
  if (!offlineOnly) {
    cfg = await Promise.race([cfgFetch, new Promise<null>(r => setTimeout(() => r(null), 15000))]);
  }
  let google = cfg === null ? null : cfg.required || cfg.google ? 'required' : '';
  // открыто как мини-приложение Telegram: входим сами, без экрана входа
  if (cfg && Telegram.initData) {
    try {
      const r = await fetch(`${base}/auth/tma`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: Telegram.initData }) });
      if (r.ok) { const j = await r.json(); Identity.session = j.session; if (!Identity.name) Identity.name = j.name; google = 'required'; }
    } catch { /* нет связи — обычный вход */ }
  }
  if (google && !Identity.session) {
    document.getElementById('splash')?.classList.add('gone');
    // вход только через Telegram
    const r = await login({ telegram: cfg!.telegram || undefined }, base);
    Identity.session = r.session;
    if (!Identity.name) Identity.name = r.name;
  }
  const q = new URLSearchParams(google
    ? { session: Identity.session, room: Identity.room || Telegram.startParam }
    : { token: Identity.token, name: Identity.name || 'Гость', room: Identity.room || Telegram.startParam });
  const conn = new AutoConn(offlineOnly || google === null ? null : `${wsBase}/ws?${q}`, !google);
  // сессия истекла или аккаунт не найден — снова на вход
  conn.onAuth(() => { Identity.session = ''; location.reload(); });
  // аккаунт открыли в другой вкладке/на другом устройстве — эта вкладка засыпает, без «перетягивания»
  conn.onKicked(() => {
    const el = document.createElement('div');
    el.className = 'login open';
    el.innerHTML = `<div class="login-card"><div class="lobby-logo"><span>♠</span><h1>QWX POKER</h1><p>закрытый клуб</p></div>
      <p class="login-text">Игра открыта на другом устройстве или в другой вкладке.<br>Одновременно можно играть только в одном месте.</p>
      <button class="lobby-btn gold big">Играть здесь</button></div>`;
    (el.querySelector('button') as HTMLButtonElement).onclick = () => location.reload();
    document.body.appendChild(el);
  });
  conn.onHistory(h => hud.showHistory(h));

  const session = new SessionTracker();
  const hud = new Hud(world, {
    action: (type, amount) => conn.send({ t: 'ACTION', action: type, amount }),
    reveal: which => conn.send({ t: 'REVEAL', which }),
    shop: itemId => conn.send({ t: 'SHOP', itemId }),
    rebuy: () => { session.rebuy(); conn.send({ t: 'REBUY' }); },
    press: () => audio.press(),
    leave: () => conn.send({ t: 'LEAVE' }),
    transfer: (to, amount) => conn.send({ t: 'TRANSFER', to, amount }),
    history: () => conn.send({ t: 'HISTORY' }),
  });
  // живой дым за меню лобби (под карточкой, над сценой)
  const smokeCanvas = document.createElement('canvas');
  smokeCanvas.className = 'lobby-smoke';
  document.body.appendChild(smokeCanvas);
  const smoke = new Smoke(smokeCanvas, 0.8);
  const lobby = new Lobby(m => conn.send(m), () => { audio.press(); Telegram.haptic('tap'); }, () => conn.online, (t, ok) => hud.toast(t, ok));
  const menu = new Menu({
    send: m => conn.send(m),
    tap: () => audio.press(),
    tick: () => audio.chipTick(0.35),
    win: () => audio.win(true),
    toast: (t, ok) => hud.toast(t, ok),
    online: () => conn.online,
    transfer: () => hud.openTransfer(true),
    hints: () => hud.hintsOn,
    toggleHints: () => { hud.toggleHints(); return hud.hintsOn; },
    setFelt: c => world.setFelt(c),
    setBack: b => world.setBack(b),
    inviteTable: () => hud.inviteTable(),
    leave: () => conn.send({ t: 'LEAVE' }),
    signOut: () => { Identity.session = ''; location.reload(); },
  });
  menu.signedIn = !!google;
  conn.onWheel(w => menu.onWheel(w));
  conn.onTourney(t => menu.onTourney(t));
  conn.onAdmin(a => menu.onAdmin(a));
  conn.onTables(t => { menu.onTables(t); lobby.setOnline(t.online); });
  lobby.onOpen = k => menu.open(k);
  conn.onTop(t => { if (!menu.onTop(t)) lobby.showTop(t); });
  // счётчик «Сейчас в клубе» в лобби
  setInterval(() => { if (lobby.isHome && conn.online && !document.hidden) conn.send({ t: 'TABLES' }); }, 15000);
  // пришёл по реферальной ссылке — после подключения просим сервер начислить бонус
  conn.onStatus(s => { if (s === 'online' && Identity.ref) { conn.send({ t: 'REF', code: Identity.ref }); Identity.clearRef(); } if (s === 'online') conn.send({ t: 'TABLES' }); });
  hud.onMyTurn = () => { audio.myTurn(); Telegram.haptic('turn'); world.glanceOnTurn(); };
  conn.onState(v => { session.onState(v); world.apply(v); hud.render(v); lobby.update(v); menu.setContext(true); });
  conn.onProfile(p => { hud.setProfile(p); lobby.setProfile(p); menu.setProfile(p); });
  conn.onHome(h => {
    // после переключения 3D/2D за столом — сразу обратно за тот же стол
    let auto = false;
    try { auto = sessionStorage.getItem('pn.autoResume') === '1'; sessionStorage.removeItem('pn.autoResume'); } catch { /* */ }
    if (auto && h.resume) { conn.send({ t: 'JOIN', room: h.resume }); return; }
    const sum = session.finish(); if (sum) setTimeout(() => menu.showSummary(sum), 500); world.clear(); hud.home(); lobby.showHome(h); menu.setContext(false); });
  // лобби видно сразу, ещё до ответа сервера
  lobby.showHome({});
  lobby.signedIn = !!google;
  lobby.onTransfer = () => hud.openTransfer(true);
  lobby.onEnterTable = () => world.intro();
  lobby.onVisible = v => {
    world.setOrbit(v);
    smokeCanvas.classList.toggle('on', v);
    if (v) smoke.start(); else setTimeout(() => { if (!smokeCanvas.classList.contains('on')) smoke.pause(); }, 1300);
  };
  lobby.onSignOut = () => { Identity.session = ''; location.reload(); };
  conn.onToast((t, ok) => hud.toast(t, ok));
  conn.onStatus(s => hud.setStatus(s, conn.online));
  // связь прервалась — аккуратная плашка «Переподключение…», место за столом держится
  const reconn = document.createElement('div');
  reconn.className = 'reconn';
  reconn.innerHTML = '<i></i><span>Переподключение…</span>';
  document.body.appendChild(reconn);
  let reconnT = 0;
  conn.onStatus(s => {
    clearTimeout(reconnT);
    if (s === 'online' || !conn.online) { reconn.classList.remove('on'); return; }
    // короткие обрывы (до 0,8 с) не показываем вовсе
    reconnT = window.setTimeout(() => reconn.classList.add('on'), 800);
  });
  world.onFrame(() => hud.frame());
  // слабое устройство: интерфейс без дорогого размытия и второго слоя дыма
  world.onLowPower(l => document.body.classList.toggle('lowfx', l));
  // ?bake: заодно запечь сукно всех цветов, затем вернуть выбранное
  if (bakeMod?.bakeMode) { for (const f of FELTS) world.setFelt(f.color); world.setFelt(savedFelt(FELT_COLOR)); }
  // для автотестов: нажать табличку в борту
  (window as unknown as { __world: TableHost }).__world = world;
  (window as unknown as { __audio: unknown }).__audio = audio;
  (window as unknown as { __send: unknown }).__send = (m: Parameters<typeof conn.send>[0]) => conn.send(m);
  (window as unknown as { __plate: (i: number) => void }).__plate = i => { world.plates.press(i); world.onPlate?.(i); };

  // заставка гаснет, когда сцена отрисовалась
  if (!w3) {
    // 2D: готово сразу — ни текстур, ни моделей, ни шейдеров
    Loading.done('textures'); Loading.done('hands'); Loading.done('shaders');
    setTimeout(() => document.getElementById('splash')?.classList.add('gone'), 350);
    return;
  }
  const w = w3, bk = bakeMod!;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    // пока висит заставка: докачать текстуры и заранее скомпилировать все шейдеры — без рывков в первые секунды
    const st = w.stage;
    const compile = (st.renderer.compileAsync ? st.renderer.compileAsync(st.scene, st.camera) : Promise.resolve()).catch(() => {}).then(() => Loading.done('shaders'));
    const textures = bk.bakedReady().then(() => Loading.done('textures'));
    const hands = new Promise<void>(r => { const prev = w.hands.onReady; w.hands.onReady = () => { prev?.(); r(); }; if (w.hands.isReady) r(); });
    Promise.race([Promise.all([textures, compile, hands]), new Promise(r => setTimeout(r, 7000))])
      .then(() => { Loading.done('textures'); Loading.done('hands'); Loading.done('shaders'); setTimeout(() => document.getElementById('splash')?.classList.add('gone'), 700); });
  }));
}

boot();
