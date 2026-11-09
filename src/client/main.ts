// Точка входа клиента Poker Noir.

import './ui/style.css';
import { Telegram } from './telegram';
import { Audio } from './audio';
import { World } from './scene/World';
import { Hud } from './ui/Hud';
import { Lobby } from './ui/Lobby';
import { AutoConn } from './net';
import { login } from './ui/Login';
import { Loading } from './ui/loading';
import { loadBakeManifest, bakedReady } from './scene/bake';
import { Identity } from './identity';
import { FELT_COLOR } from '../shared/Catalog';
import { Menu, savedFelt, FELTS } from './ui/Menu';
import { SessionTracker } from './session';
import { Smoke } from './ui/smoke';
import { setCardBack } from './scene/textures';
import { bakeMode } from './scene/bake';

async function boot() {
  Telegram.boot();
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

  // запечённые текстуры: список файлов грузится заранее, сами картинки — параллельно со стартом сцены
  await loadBakeManifest();
  const world = new World(document.getElementById('stage')!, {
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
  }, {
    felt: savedFelt(FELT_COLOR),
    ring: 'RING_GOLD',
  });
  world.onSqueeze = active => {
    // пока тянем карты — никаких системных свайпов
    document.body.style.overscrollBehavior = active ? 'none' : '';
  };
  world.onPropTap = which => {
    if (which === 'glass') audio.pour();
    Telegram.haptic('tap');
  };

  // ── соединение: сервер клуба (тот же сайт или VITE_SERVER_URL), при недоступности — тренировочный стол ──
  const wsBase = base.replace(/^http/, 'ws');
  // конфиг входа: null — сервер недоступен; required=false — режим разработки (без входа)
  let cfg: AuthCfg | null = null;
  if (!offlineOnly) {
    cfg = await Promise.race([cfgFetch, new Promise<null>(r => setTimeout(() => r(null), 15000))]);
  }
  const google = cfg === null ? null : cfg.required || cfg.google ? 'required' : '';
  if (google && !Identity.session) {
    document.getElementById('splash')?.classList.add('gone');
    const r = await login({ google: cfg!.google || undefined, telegram: cfg!.telegram || undefined }, base);
    Identity.session = r.session;
    if (!Identity.name) Identity.name = r.name;
  }
  const q = new URLSearchParams(google
    ? { session: Identity.session, room: Identity.room }
    : { token: Identity.token, name: Identity.name || 'Гость', room: Identity.room });
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
    music: () => audio.toggleMusic(),
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
    music: () => audio.musicEnabled,
    toggleMusic: () => audio.toggleMusic(),
    setFelt: c => world.setFelt(c),
    setBack: b => setCardBack(b),
    inviteTable: () => hud.inviteTable(),
    leave: () => conn.send({ t: 'LEAVE' }),
    signOut: () => { Identity.session = ''; location.reload(); },
  });
  menu.signedIn = !!google;
  conn.onWheel(w => menu.onWheel(w));
  conn.onTables(t => { menu.onTables(t); lobby.setOnline(t.online); });
  lobby.onOpen = k => menu.open(k);
  conn.onTop(t => { if (!menu.onTop(t)) lobby.showTop(t); });
  // счётчик «Сейчас в клубе» в лобби
  setInterval(() => { if (lobby.isHome && conn.online && !document.hidden) conn.send({ t: 'TABLES' }); }, 15000);
  // пришёл по реферальной ссылке — после подключения просим сервер начислить бонус
  conn.onStatus(s => { if (s === 'online' && Identity.ref) { conn.send({ t: 'REF', code: Identity.ref }); Identity.clearRef(); } if (s === 'online') conn.send({ t: 'TABLES' }); });
  hud.onMyTurn = () => { audio.myTurn(); Telegram.haptic('turn'); world.glanceOnTurn(); };
  conn.onState(v => { session.onState(v); world.apply(v); hud.render(v); lobby.update(v); menu.setContext(true); audio.setScene('table'); });
  conn.onProfile(p => { hud.setProfile(p); lobby.setProfile(p); menu.setProfile(p); });
  conn.onHome(h => { const sum = session.finish(); if (sum) setTimeout(() => menu.showSummary(sum), 500); world.clear(); hud.home(); lobby.showHome(h); menu.setContext(false); audio.setScene('lobby'); });
  // лобби видно сразу, ещё до ответа сервера
  lobby.showHome({});
  lobby.signedIn = !!google;
  lobby.onTransfer = () => hud.openTransfer(true);
  lobby.onEnterTable = () => world.stage.intro();
  lobby.onVisible = v => {
    world.stage.orbit = v;
    smokeCanvas.classList.toggle('on', v);
    if (v) smoke.start(); else setTimeout(() => { if (!smokeCanvas.classList.contains('on')) smoke.pause(); }, 1300);
  };
  lobby.onSignOut = () => { Identity.session = ''; location.reload(); };
  conn.onToast((t, ok) => hud.toast(t, ok));
  conn.onStatus(s => hud.setStatus(s, conn.online));
  world.stage.onFrame(() => hud.frame());
  // слабое устройство: интерфейс без дорогого размытия и второго слоя дыма
  world.stage.onLowPower(l => document.body.classList.toggle('lowfx', l));
  // ?bake: заодно запечь сукно всех цветов, затем вернуть выбранное
  if (bakeMode) { for (const f of FELTS) world.setFelt(f.color); world.setFelt(savedFelt(FELT_COLOR)); }
  // для автотестов: нажать табличку в борту
  (window as unknown as { __world: World }).__world = world;
  (window as unknown as { __audio: unknown }).__audio = audio;
  (window as unknown as { __send: unknown }).__send = (m: Parameters<typeof conn.send>[0]) => conn.send(m);
  (window as unknown as { __plate: (i: number) => void }).__plate = i => { world.buttons.press(i); world.onPlate?.(i); };

  // заставка гаснет, когда сцена отрисовалась
  requestAnimationFrame(() => requestAnimationFrame(() => {
    // пока висит заставка: докачать текстуры и заранее скомпилировать все шейдеры — без рывков в первые секунды
    const st = world.stage;
    const compile = (st.renderer.compileAsync ? st.renderer.compileAsync(st.scene, st.camera) : Promise.resolve()).catch(() => {}).then(() => Loading.done('shaders'));
    const textures = bakedReady().then(() => Loading.done('textures'));
    const hands = new Promise<void>(r => { const prev = world.hands.onReady; world.hands.onReady = () => { prev?.(); r(); }; if (world.hands.isReady) r(); });
    Promise.race([Promise.all([textures, compile, hands]), new Promise(r => setTimeout(r, 7000))])
      .then(() => { Loading.done('textures'); Loading.done('hands'); Loading.done('shaders'); setTimeout(() => document.getElementById('splash')?.classList.add('gone'), 700); });
  }));
}

boot();
