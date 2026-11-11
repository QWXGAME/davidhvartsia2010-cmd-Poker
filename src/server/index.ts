// Сервер QWX POKER: раздаёт собранный клиент и держит столы по WebSocket.
//
//   PUBLIC_URL — адрес сайта с игрой (для ссылок-приглашений), например https://poker.example.com
//   PORT       — порт (по умолчанию 3000)
//
// Вход: аккаунт Telegram (бот задан — гостей нет). Без бота — режим разработки:
// браузер хранит секретный токен, сервер узнаёт игрока по его хэшу.

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { TableHost } from '../shared/TableHost';
import type { ClientMsg, ServerMsg } from '../shared/Catalog';
import { UNLOCKS, UNLOCK_IDS, REFILL } from '../shared/Catalog';
import { store, ladder, isAdmin } from './db';
import { Tourney } from './tourney';
import { stats } from './stats';
import type { AdminOverview, AdminTable } from '../shared/Catalog';

/** как показывать игрока в журнале: @username или имя */
const nick = (u: { username?: string; name: string } | undefined) => !u ? '?' : u.username ? '@' + u.username : u.name;
import { GOOGLE_CLIENT_ID, TELEGRAM_BOT_NAME, LOGIN_REQUIRED, verifyGoogle, verifyTelegram, verifyTelegramWebApp, issueSession, checkSession } from './auth';

const PORT = Number(process.env.PORT) || 3000;
// адрес сайта для ссылок-приглашений: из PUBLIC_URL, а если не задан — берём домен из первого запроса к сайту
let PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
let originKnown = !!process.env.PUBLIC_URL;
function learnOrigin(req: http.IncomingMessage) {
  if (originKnown) return;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  if (!host || /^(localhost|127\.|0\.0\.0\.0)/.test(host)) return;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  PUBLIC_URL = `${proto}://${host}`;
  originKnown = true;
}

const BLINDS: [number, number][] = [[25, 50], [100, 200], [500, 1000]];

// ───────────────────────── вход ─────────────────────────

const cleanName = (n: string) => n.replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);

function identify(token: string, name: string): { id: string; name: string } | null {
  if (!/^[a-f0-9]{32,64}$/.test(token)) return null;
  const id = 'u_' + crypto.createHash('sha256').update(token).digest('hex').slice(0, 20);
  return { id, name: cleanName(name) || 'Гость' };
}

// ───────────────────────── столы ─────────────────────────

const rooms = new Map<string, TableHost>();
const emptySince = new Map<string, number>();

export function inviteLink(roomId: string): string {
  return `${PUBLIC_URL}/?room=${roomId}`;
}

function fairHash(deck: string[]) {
  const seed = crypto.randomBytes(16).toString('hex');
  return { seed, hash: crypto.createHash('sha256').update(`${seed}:${deck.join(',')}`).digest('hex') };
}

/** Стол игрока: он хозяин, зовёт друзей; ботов сажает только сам. Код стола — 6 символов. */
export function createRoom(owner: string, sb: number, bb: number): TableHost {
  let id: string;
  do id = crypto.randomBytes(3).toString('hex').toUpperCase(); while (rooms.has(id));
  const host: TableHost = new TableHost({
    id, sb, bb, turnMs: 25000, owner, isPrivate: false, invite: inviteLink(id),
    rng: n => crypto.randomInt(0, n),
    fair: fairHash,
    onHandEnd: r => {
      const stacks = new Map<string, number>();
      for (const pid of r.humans) stacks.set(pid, host.table.byId(pid)?.stack ?? 0);
      const msgs = store.recordHand(r.humans, stacks, r.deltas, r.potTotal);
      stats.hand(r.potTotal, r.humans.map(pid => r.deltas.get(pid) ?? 0));
      for (const pid of r.humans) {
        const d = r.deltas.get(pid) ?? 0;
        if (d >= host.table.bb * 20) stats.event('win', `${nick(store.get(pid))} выиграл банк ${fmtN(r.potTotal)} (+${fmtN(d)}) · стол ${id}`, pid);
      }
      for (const pid of r.humans) pushProfile(pid);
      seasonToasts(msgs);
      for (const pid of r.humans) {
        const u = store.get(pid);
        if (u) ladder.record(pid, u.name, r.deltas.get(pid) ?? 0);
      }
    },
    onCashout: (pid, amount) => {
      const u = store.get(pid);
      if (u) { store.cashOut(u, amount); pushProfile(pid); }
    },
  });
  rooms.set(id, host);
  stats.add('tables');
  stats.event('table', `${nick(store.get(owner))} открыл стол ${id} · ${sb}/${bb}`, owner);
  return host;
}

// пустые столы живут 15 минут
setInterval(() => {
  const now = Date.now();
  for (const [id, host] of rooms) {
    if (host.humans > 0 || tourney.owns(host)) { emptySince.delete(id); continue; }
    const since = emptySince.get(id) ?? now;
    emptySince.set(id, since);
    if (now - since > 15 * 60_000) { host.destroy(); rooms.delete(id); emptySince.delete(id); }
  }
}, 60_000);

// ───────────────────────── сессии ─────────────────────────

interface Session { ws: WebSocket; userId: string; room: TableHost | null; unsub: () => void }
const sessions = new Map<string, Session>();
const leaveTimers = new Map<string, NodeJS.Timeout>();

const send = (ws: WebSocket, m: ServerMsg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
const toast = (ws: WebSocket, text: string, ok?: boolean) => send(ws, { t: 'TOAST', text, ok });

function pushProfile(userId: string) {
  const s = sessions.get(userId);
  const u = store.get(userId);
  if (s && u) send(s.ws, { t: 'PROFILE', profile: store.profile(u) });
}

function roomOf(userId: string) {
  return [...rooms.values()].find(r => r.table.byId(userId));
}

/** Посадить за стол (бай-ин 100 BB с баланса) и подписать на состояние. */
function enter(s: Session, host: TableHost): boolean {
  const u = store.get(s.userId)!;
  if (!host.table.byId(u.id)) {
    const amount = store.buyIn(u, host.table.bb * 100, host.table.bb * 20);
    if (!amount) { checkRefill(u.id); toast(s.ws, brokeText(u.id), false); return false; }
    const seat = host.join(u.id, u.name, amount, 'RING_GOLD', u.equipped.items);
    if (seat < 0) { store.cashOut(u, amount); toast(s.ws, 'За столом нет мест', false); return false; }
    pushProfile(u.id);
  }
  s.unsub();
  s.room = host;
  s.unsub = host.subscribe(u.id, view => send(s.ws, { t: 'STATE', view }));
  return true;
}

function brokeText(id: string) {
  const u = store.get(id);
  const left = u?.brokeAt ? Math.max(1, Math.ceil((u.brokeAt + REFILL.WAIT - Date.now()) / 60_000)) : 0;
  return left ? `Фишки кончились. Через ${left} мин. заведение угостит ${REFILL.AMOUNT.toLocaleString('ru-RU')} фишками — или покрути колесо фортуны` : 'Не хватает фишек для бай-ина — покрути колесо фортуны в меню';
}

function leaveRoom(s: Session) {
  if (!s.room) return;
  s.unsub();
  s.unsub = () => {};
  s.room.leave(s.userId);
  s.room = null;
  send(s.ws, { t: 'HOME' });
}

function seasonToasts(msgs: Map<string, string[]>) {
  for (const [pid, list] of msgs) {
    const s = sessions.get(pid);
    if (s) list.forEach((t, i) => setTimeout(() => toast(s.ws, t, true), 2500 + i * 1800));
  }
}


// ───────────────────────── «Ночь пятницы» ─────────────────────────

const tourney = new Tourney({
  rooms,
  seat(userId, host) {
    // турнир важнее: с обычного стола встаём, фишки возвращаются на баланс
    for (const r of rooms.values()) if (r !== host && !tourney.owns(r) && r.table.byId(userId)) r.leave(userId);
    const s = sessions.get(userId);
    if (!s) return;
    s.unsub();
    s.room = host;
    s.unsub = host.subscribe(userId, view => send(s.ws, { t: 'STATE', view }));
  },
  out(userId, text) {
    const s = sessions.get(userId);
    if (!s) return;
    s.unsub(); s.unsub = () => {}; s.room = null;
    send(s.ws, { t: 'HOME' });
    toast(s.ws, text, true);
    pushProfile(userId);
  },
  toast(userId, text, ok) { const s = sessions.get(userId); if (s) toast(s.ws, text, ok); },
  broadcast() { for (const s of sessions.values()) send(s.ws, { t: 'TOURNEY', info: tourney.info(s.userId) }); },
  announce(text) { stats.event('tourney', text); for (const s of sessions.values()) toast(s.ws, text, true); },
  user(id) { return store.get(id); },
  reward(id, chips, unlock, xp) {
    const u = store.get(id);
    if (!u) return;
    if (chips) { u.balance += chips; stats.add('tourneyPrizes', chips); stats.event('tourney', `${nick(u)}: приз турнира +${fmtN(chips)}`, id); }
    if (unlock) store.unlock(u, unlock);
    const msgs = xp ? store.addXp(u, xp) : [];
    store.save();
    pushProfile(id);
    if (msgs.length) seasonToasts(new Map([[id, msgs]]));
  },
  hand(humans, deltas, pot) {
    seasonToasts(store.recordHand(humans, new Map(), deltas, pot));
    stats.hand(pot, humans.map(pid => deltas.get(pid) ?? 0));
    for (const pid of humans) pushProfile(pid);
  },
  fair: fairHash,
});

// ───────────────────────── фишки кончились ─────────────────────────

function checkRefill(userId: string) {
  const u = store.get(userId);
  if (!u) return;
  const was = u.brokeAt;
  if (store.refill(u)) {
    const s = sessions.get(userId);
    if (s) toast(s.ws, `Заведение угощает: +${REFILL.AMOUNT.toLocaleString('ru-RU')} фишек`, true);
    stats.add('refill', REFILL.AMOUNT);
    stats.event('refill', `${nick(u)} получил ${fmtN(REFILL.AMOUNT)} после перерыва`, u.id);
    pushProfile(userId);
  } else if (u.brokeAt !== was) pushProfile(userId);
}
setInterval(() => { for (const id of sessions.keys()) checkRefill(id); }, 30_000);

// ───────────────────────── HTTP ─────────────────────────

const DIST = path.join(process.cwd(), 'dist');
const SITE = path.join(process.cwd(), 'site');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.mp3': 'audio/mpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  learnOrigin(req);
  const url = (req.url || '/').split('?')[0];
  if (url === '/health') { res.end('ok'); return; }
  if (url.startsWith('/auth/')) { authRoute(req, res, url); return; }
  // сайт клуба: /club — открыт всем, кнопки «Играть» ведут на игру в корне этого же домена
  if (url === '/club') { res.writeHead(301, { Location: '/club/' }); res.end(); return; }
  const isSite = url.startsWith('/club/');
  const root = isSite ? SITE : DIST;
  const rel = isSite ? url.slice('/club'.length) : url;
  let file = path.normalize(path.join(root, decodeURIComponent(rel === '/' ? '/index.html' : rel)));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    if (path.extname(url)) { res.writeHead(404); res.end(); return; }
    file = path.join(root, 'index.html');
  }
  if (!fs.existsSync(file)) { res.writeHead(500); res.end('Сначала соберите клиент: npm run build'); return; }
  const ext = path.extname(file);
  const stat = fs.statSync(file);
  const headers: Record<string, string | number> = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': url.startsWith('/assets/') || ext === '.mp3' ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Accept-Ranges': 'bytes',
  };
  // перемотка/потоковое воспроизведение музыки
  const range = req.headers.range;
  if (range && ext === '.mp3') {
    const [a, b] = range.replace('bytes=', '').split('-');
    const start = Number(a) || 0, end = b ? Number(b) : stat.size - 1;
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  // index.html: конфиг входа вшиваем прямо в страницу — клиенту не нужно ждать отдельный запрос
  if (ext === '.html') {
    const cfg = JSON.stringify({ google: GOOGLE_CLIENT_ID, telegram: LOGIN_REQUIRED ? TELEGRAM_BOT_NAME : '', required: LOGIN_REQUIRED }).replace(/</g, '\\u003c');
    const html = fs.readFileSync(file, 'utf8').replace('</head>', `<script>window.__QWX_CFG=${cfg}</script></head>`);
    res.writeHead(200, { ...headers, 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  fs.createReadStream(file).pipe(res);
});

/** Открытые столы с местами (не приватные) и сколько людей сейчас в клубе. */
function openTables() {
  const tables = [...rooms.values()]
    .map(h => ({ h, l: h.lobby() }))
    .filter(({ l }) => !l.isPrivate && l.players.length < 6)
    .map(({ h, l }) => ({
      id: l.id, sb: h.table.sb, bb: h.table.bb, players: l.players.length,
      humans: l.players.filter(p => !p.isBot).length, started: l.started,
      owner: l.players.find(p => p.id === l.owner)?.name || 'Клуб',
    }))
    .sort((a, b) => b.humans - a.humans)
    .slice(0, 20);
  return { online: sessions.size, tables };
}

// ───────────────────────── вход через Google ─────────────────────────

function cors(req: http.IncomingMessage, res: http.ServerResponse) {
  const origin = String(req.headers.origin || '');
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function authRoute(req: http.IncomingMessage, res: http.ServerResponse, url: string) {
  cors(req, res);
  const json = (code: number, body: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (url === '/auth/config') { json(200, { google: GOOGLE_CLIENT_ID, telegram: LOGIN_REQUIRED ? TELEGRAM_BOT_NAME : '', required: LOGIN_REQUIRED }); return; }
  if (url === '/auth/google' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 8192) req.destroy(); });
    req.on('end', async () => {
      let cred = '';
      try { cred = String(JSON.parse(body).credential || ''); } catch { /* */ }
      const g = await verifyGoogle(cred);
      if (!g) { json(401, { error: 'Не удалось подтвердить вход Google' }); return; }
      const id = 'g_' + crypto.createHash('sha256').update(g.sub).digest('hex').slice(0, 20);
      const u = store.getOrCreate(id, store.get(id)?.name || cleanName(g.name) || 'Игрок', '');
      json(200, { session: issueSession(id), name: u.name });
    });
    return;
  }
  if (url === '/auth/telegram' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 8192) req.destroy(); });
    req.on('end', () => {
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(body) || {}; } catch { /* */ }
      const t = verifyTelegram(data);
      if (!t) { json(401, { error: 'Не удалось подтвердить вход Telegram' }); return; }
      const id = 't_' + crypto.createHash('sha256').update('tg:' + t.id).digest('hex').slice(0, 20);
      const u = store.getOrCreate(id, store.get(id)?.name || cleanName(t.name) || 'Игрок', String(data.username || ''));
      json(200, { session: issueSession(id), name: u.name });
    });
    return;
  }
  // мини-приложение Telegram: вход без кнопок, по подписанным данным от Telegram (тот же аккаунт, что и через виджет)
  if (url === '/auth/tma' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 8192) req.destroy(); });
    req.on('end', () => {
      let initData = '';
      try { initData = String(JSON.parse(body).initData || ''); } catch { /* */ }
      const t = verifyTelegramWebApp(initData);
      if (!t) { json(401, { error: 'Не удалось подтвердить вход Telegram' }); return; }
      const id = 't_' + crypto.createHash('sha256').update('tg:' + t.id).digest('hex').slice(0, 20);
      const u = store.getOrCreate(id, store.get(id)?.name || cleanName(t.name) || 'Игрок', t.username);
      json(200, { session: issueSession(id), name: u.name });
    });
    return;
  }
  json(404, { error: 'not found' });
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws, req) => {
  const q = new URLSearchParams((req.url || '').split('?')[1] || '');
  let u;
  if (LOGIN_REQUIRED) {
    const id = checkSession(q.get('session') || '');
    const known = id ? store.get(id) : undefined;
    if (!known) { send(ws, { t: 'AUTH' }); ws.close(); return; }
    u = known;
  } else if (q.get('session') && store.get(checkSession(q.get('session') || '') || '')) {
    u = store.get(checkSession(q.get('session') || '')!)!;
  } else {
    const user = identify(q.get('token') || '', q.get('name') || '');
    if (!user) { send(ws, { t: 'ERROR', text: 'Не удалось войти' }); ws.close(); return; }
    u = store.getOrCreate(user.id, user.name, '');
  }
  clearTimeout(leaveTimers.get(u.id));
  leaveTimers.delete(u.id);
  {
    const now = Date.now();
    const isNew = !u.lastSeen && u.handsPlayed === 0 && now - u.createdAt < 30 * 60_000;
    if (isNew) stats.event('new', `Новый игрок: ${nick(u)}`, u.id);
    else if (now - (u.lastSeen || 0) > 10 * 60_000) stats.event('join', `${nick(u)} зашёл в игру`, u.id);
    u.lastSeen = now;
    stats.visit(u.id, isNew);
    store.save();
  }

  // один аккаунт — одна активная вкладка: старая получает KICKED и перестаёт переподключаться
  const old = sessions.get(u.id);
  if (old) { old.unsub(); send(old.ws, { t: 'KICKED' }); old.ws.close(); }

  const session: Session = { ws, userId: u.id, room: null, unsub: () => {} };
  sessions.set(u.id, session);
  stats.max('peakOnline', sessions.size);
  checkRefill(u.id);
  send(ws, { t: 'PROFILE', profile: store.profile(u) });
  send(ws, { t: 'TOURNEY', info: tourney.info(u.id) });

  // связь прервалась, а место за столом держится — сразу возвращаем за стол, без лобби
  const want = (q.get('room') || '').toUpperCase();
  const current = roomOf(u.id);
  if (want && !rooms.has(want) && !current) toast(ws, 'Этот стол уже закрыт', false);
  if (current && (!want || rooms.get(want) === current)) enter(session, current);
  else send(ws, { t: 'HOME', resume: current?.table.id, invite: want && rooms.has(want) && rooms.get(want) !== current ? want : undefined });

  let last = 0;
  let bucket = 12;
  ws.on('message', raw => {
    // защита от спама: «ведро» на 12 сообщений, пополняется 15 в секунду (короткие пачки не теряются)
    const now = Date.now();
    bucket = Math.min(12, bucket + (now - last) * 0.015);
    last = now;
    if (bucket < 1) return;
    bucket -= 1;
    let m: ClientMsg;
    try { m = JSON.parse(String(raw)); } catch { return; }
    const host = session.room;
    const isOwner = !!host && host.owner === u.id;

    switch (m.t) {
      case 'CREATE': {
        if (host) leaveRoom(session); else roomOf(u.id)?.leave(u.id);
        const [sb, bb] = BLINDS.find(([s]) => s === m.sb) || BLINDS[0];
        if (u.balance < bb * 20) { checkRefill(u.id); toast(ws, u.brokeAt ? brokeText(u.id) : `Для стола ${sb}/${bb} нужно хотя бы ${bb * 20} фишек`, false); send(ws, { t: 'HOME' }); break; }
        enter(session, createRoom(u.id, sb, bb));
        break;
      }
      case 'QUICK': {
        if (host) leaveRoom(session); else roomOf(u.id)?.leave(u.id);
        const [sb, bb] = BLINDS.find(([s]) => s === m.sb) || BLINDS[0];
        if (u.balance < bb * 20) { checkRefill(u.id); toast(ws, u.brokeAt ? brokeText(u.id) : `Для стола ${sb}/${bb} нужно хотя бы ${bb * 20} фишек`, false); send(ws, { t: 'HOME' }); break; }
        const room = createRoom(u.id, sb, bb);
        if (!enter(session, room)) break;
        for (let i = 0; i < 5; i++) room.addBot();
        room.start();
        break;
      }
      case 'JOIN': {
        const target = rooms.get(String(m.room || '').toUpperCase().trim());
        if (!target) { toast(ws, 'Стол с таким кодом не найден', false); break; }
        if (host && host !== target) leaveRoom(session);
        else if (!host) { const cur = roomOf(u.id); if (cur && cur !== target) cur.leave(u.id); }
        if (!enter(session, target)) send(ws, { t: 'HOME' });
        break;
      }
      case 'ADD_BOT':
        if (!isOwner) { toast(ws, 'Ботов сажает хозяин стола', false); break; }
        if (!host!.addBot()) toast(ws, 'Свободных мест нет', false);
        break;
      case 'REMOVE_BOT':
        if (isOwner) host!.removeBot();
        break;
      case 'START':
        if (!isOwner) break;
        if (!host!.start()) toast(ws, 'Нужно хотя бы два игрока — позови друга или посади бота', false);
        break;
      case 'BONUS':
        toast(ws, store.bonus(u.id), true);
        pushProfile(u.id);
        break;
      case 'TOP':
        send(ws, { t: 'TOP', top: ladder.top().map(e => ({ name: e.name, profit: e.profit })) });
        break;
      case 'RENAME': {
        const n = cleanName(String(m.name || ''));
        if (n) { store.getOrCreate(u.id, n, ''); pushProfile(u.id); }
        break;
      }
      case 'ACTION':
        host?.action(u.id, m.action, Number(m.amount) || 0);
        break;
      case 'REVEAL':
        host?.reveal(u.id, m.which);
        break;
      case 'SHOP': {
        const r = store.shop(u, m.itemId);
        toast(ws, r.text, r.ok);
        if (r.ok) host?.setItems(u.id, u.equipped.items);
        pushProfile(u.id);
        break;
      }
      case 'REBUY': {
        if (!host || tourney.owns(host)) break;
        const p = host.table.byId(u.id);
        if (!p) { enter(session, host); break; }
        if (p.stack > 0) break;
        const amount = store.buyIn(u, host.table.bb * 100, host.table.bb * 20);
        if (!amount) { checkRefill(u.id); toast(ws, brokeText(u.id), false); break; }
        if (!host.rebuy(u.id, amount)) store.cashOut(u, amount);
        pushProfile(u.id);
        break;
      }
      case 'WHEEL': {
        const r = store.spinWheel(u.id);
        if (r.ok && r.prize) { stats.add('wheel', r.prize); stats.event('wheel', `${nick(u)} выиграл на колесе ${fmtN(r.prize)}`, u.id); }
        send(ws, { t: 'WHEEL', ok: r.ok, index: r.index, prize: r.prize, wheelAt: r.wheelAt, text: r.text });
        // баланс обновим после того, как колесо докрутится на экране
        if (r.ok) setTimeout(() => pushProfile(u.id), 5200);
        break;
      }
      case 'TABLES':
        send(ws, { t: 'TABLES', ...openTables() });
        break;
      case 'REF': {
        const r = store.applyRef(u.id, String(m.code || ''));
        if (r.text) toast(ws, r.text, r.ok);
        if (r.ok) {
          stats.event('ref', `${nick(u)} пришёл по ссылке ${nick(store.get(r.inviter || ''))}`, u.id);
          pushProfile(u.id);
          if (r.inviter) { pushProfile(r.inviter); const peer = sessions.get(r.inviter); if (peer) toast(peer.ws, `Ваш друг пришёл по ссылке: +5 000 фишек`, true); }
        }
        break;
      }
      case 'HISTORY':
        send(ws, { t: 'HISTORY', items: store.history(u.id) });
        break;
      case 'TRANSFER': {
        const r = store.transfer(u.id, String(m.to || ''), Math.floor(Number(m.amount) || 0));
        toast(ws, r.text, r.ok);
        pushProfile(u.id);
        if (r.ok && r.to) {
          const amt = Math.floor(Number(m.amount) || 0), fee = Math.floor(amt * 0.05);
          stats.add('transfers', amt); stats.add('fees', fee);
          stats.event('transfer', `${nick(u)} → ${nick(store.get(r.to))}: ${fmtN(amt)} (комиссия ${fmtN(fee)})`, u.id);
          pushProfile(r.to);
          const peer = sessions.get(r.to);
          if (peer) { toast(peer.ws, `Вам перевели фишки: ${u.username ? '@' + u.username : u.name}`, true); send(peer.ws, { t: 'HISTORY', items: store.history(r.to) }); }
        }
        if (r.ok) {
          send(ws, { t: 'HISTORY', items: store.history(u.id) });
        }
        break;
      }
      case 'PING':
        send(ws, { t: 'PONG' });
        break;
      case 'TOURNEY':
        send(ws, { t: 'TOURNEY', info: tourney.info(u.id) });
        break;
      case 'TOURNEY_REG': {
        const text = tourney.register(u.id, !!m.on);
        toast(ws, text, true);
        send(ws, { t: 'TOURNEY', info: tourney.info(u.id) });
        break;
      }
      case 'ADMIN':
        adminOp(session, m);
        break;
      case 'LEAVE':
        if (host) leaveRoom(session); else { roomOf(u.id)?.leave(u.id); send(ws, { t: 'HOME' }); }
        break;
    }
  });

  ws.on('close', () => {
    if (sessions.get(u.id)?.ws !== ws) return;
    session.unsub();
    sessions.delete(u.id);
    const room = session.room;
    if (!room) return;
    // турнир: место держится, пока игрок не вернётся (ходы за него — по таймеру)
    if (tourney.owns(room)) return;
    // три минуты на переподключение, потом встаём из-за стола
    leaveTimers.set(u.id, setTimeout(() => {
      leaveTimers.delete(u.id);
      if (!sessions.has(u.id)) room.leave(u.id);
    }, 180_000));
  });
});

// ───────────────────────── админ-панель ─────────────────────────

const fmtN = (n: number) => Math.round(n).toLocaleString('ru-RU');

function withTable(x: NonNullable<ReturnType<typeof store.get>>) {
  const v = store.adminView(x, sessions.has(x.id));
  const r = roomOf(x.id);
  if (r) v.table = `${r.table.id}${tourney.owns(r) ? ' (турнир)' : ''} · ${r.table.sb}/${r.table.bb}`;
  return v;
}

/** всё, что происходит в клубе: сегодня и за неделю, столы, онлайн, журнал */
function overview(): AdminOverview {
  const users = store.allUsers();
  const tables: AdminTable[] = [...rooms.values()].map(h => {
    const ps = h.table.players();
    return {
      id: h.table.id, blinds: `${fmtN(h.table.sb)}/${fmtN(h.table.bb)}`, players: ps.length,
      humans: ps.filter(p => !p.isBot).map(p => nick(store.get(p.id))), stage: h.table.stage,
      pot: ps.reduce((a, p) => a + p.committed, 0), tourney: tourney.owns(h), hands: h.table.handId,
    };
  }).sort((a, b) => b.humans.length - a.humans.length);
  return {
    online: sessions.size,
    users: users.length,
    chipsTotal: users.reduce((a, u) => a + u.balance + u.tableStack, 0),
    chipsOnTables: users.reduce((a, u) => a + u.tableStack, 0),
    days: stats.recent(7),
    tables,
    events: stats.lastEvents(80),
    onlineUsers: [...sessions.keys()].map(id => store.get(id)).filter(Boolean).map(x => withTable(x!)),
  };
}

function adminOp(s: Session, m: Extract<ClientMsg, { t: 'ADMIN' }>) {
  const me = store.get(s.userId);
  const reply = (ok: boolean, text: string, extra: Partial<Extract<ServerMsg, { t: 'ADMIN' }>> = {}) => send(s.ws, { t: 'ADMIN', ok, text, ...extra });
  if (!me || !isAdmin(me)) { reply(false, 'Нет доступа'); return; }
  const log = (extra: Record<string, unknown>) => store.adminLog({ admin: me.username || me.id, op: m.op, ...extra });
  if (m.op === 'list') {
    const q = String(m.text || '').trim().replace(/^@/, '').toLowerCase();
    const all = store.allUsers();
    const users = all
      .filter(x => !q || x.name.toLowerCase().includes(q) || (x.username || '').toLowerCase().includes(q))
      .sort((a, b) => (sessions.has(b.id) ? 1 : 0) - (sessions.has(a.id) ? 1 : 0) || (b.lastSeen || b.createdAt) - (a.lastSeen || a.createdAt))
      .slice(0, 500).map(withTable);
    reply(true, `Игроков в клубе: ${all.length}, онлайн: ${sessions.size}`, { users });
    return;
  }
  if (m.op === 'overview') { reply(true, '', { overview: overview() }); return; }
  if (m.op === 'events') { reply(true, '', { events: stats.lastEvents(300, m.text || undefined) }); return; }
  if (m.op === 'broadcast') {
    const text = String(m.text || '').replace(/[<>]/g, '').trim().slice(0, 200);
    if (!text) { reply(false, 'Пустое сообщение'); return; }
    for (const x of sessions.values()) toast(x.ws, text, true);
    log({ text });
    reply(true, `Отправлено ${sessions.size} игрокам`);
    return;
  }
  if (m.op === 'tourneyStart') {
    if (tourney.state === 'RUNNING') { reply(false, 'Турнир уже идёт'); return; }
    if (!tourney.info(s.userId).registered) { reply(false, 'В списке турнира никого нет'); return; }
    tourney.start();
    log({});
    reply(true, 'Турнир запущен');
    return;
  }
  const t = store.findAny(String(m.target || ''));
  if (!t) { reply(false, 'Игрок не найден — введите @username или код QWX-…'); return; }
  const amount = Math.trunc(Number(m.amount) || 0);
  const who = t.username ? '@' + t.username : t.name;
  const notify = (text: string) => { const x = sessions.get(t.id); if (x) toast(x.ws, text, true); pushProfile(t.id); };
  switch (m.op) {
    case 'find': reply(true, who, { user: withTable(t), userEvents: stats.lastEvents(2000).filter(e => e.who === t.id).slice(0, 40) }); return;
    case 'give': {
      if (!amount || Math.abs(amount) > 1e9) { reply(false, 'Укажите сумму'); return; }
      t.balance = Math.max(0, t.balance + amount);
      if (t.balance + t.tableStack >= REFILL.BELOW) t.brokeAt = 0;
      store.save();
      if (amount > 0) notify(`Подарок от заведения: +${amount.toLocaleString('ru-RU')} фишек`); else pushProfile(t.id);
      stats.add(amount > 0 ? 'adminGiven' : 'adminTaken', Math.abs(amount));
      stats.event('admin', `${nick(me)}: ${amount > 0 ? 'выдал' : 'забрал у'} ${who} ${fmtN(Math.abs(amount))}`, t.id);
      log({ target: t.id, amount });
      reply(true, `${who}: ${amount > 0 ? '+' : ''}${amount.toLocaleString('ru-RU')}`, { user: withTable(t) });
      return;
    }
    case 'set': {
      if (amount < 0 || amount > 1e9) { reply(false, 'Неверная сумма'); return; }
      const was = t.balance;
      t.balance = amount;
      if (amount > was) stats.add('adminGiven', amount - was); else stats.add('adminTaken', was - amount);
      stats.event('admin', `${nick(me)}: баланс ${who} ${fmtN(was)} → ${fmtN(amount)}`, t.id);
      if (t.balance + t.tableStack >= REFILL.BELOW) t.brokeAt = 0;
      store.save(); checkRefill(t.id); pushProfile(t.id);
      log({ target: t.id, amount });
      reply(true, `${who}: баланс ${amount.toLocaleString('ru-RU')}`, { user: withTable(t) });
      return;
    }
    case 'unlock': case 'lock': {
      const id = String(m.item || '');
      if (!UNLOCK_IDS.has(id)) { reply(false, 'Нет такого предмета'); return; }
      const name = UNLOCKS.find(x => x.id === id)!.name;
      if (m.op === 'unlock') { if (!store.unlock(t, id)) { reply(false, 'Уже есть'); return; } notify(`Подарок от заведения: ${name}`); }
      else { t.unlocks = (t.unlocks || []).filter(x => x !== id); pushProfile(t.id); }
      stats.event('admin', `${nick(me)}: ${m.op === 'unlock' ? 'выдал' : 'забрал у'} ${who} — ${name}`, t.id);
      store.save();
      log({ target: t.id, item: id });
      reply(true, `${who}: ${m.op === 'unlock' ? 'выдано' : 'забрано'} — ${name}`, { user: withTable(t) });
      return;
    }
    case 'xp': {
      if (!amount || amount < 0 || amount > 100000) { reply(false, 'Укажите опыт'); return; }
      const msgs = store.addXp(t, amount);
      store.save(); pushProfile(t.id);
      if (msgs.length) seasonToasts(new Map([[t.id, msgs]]));
      log({ target: t.id, amount });
      reply(true, `${who}: +${amount} опыта`, { user: withTable(t) });
      return;
    }
    case 'resetWheel':
      t.wheelAt = 0; store.save(); notify('Колесо фортуны снова доступно');
      log({ target: t.id });
      reply(true, `${who}: колесо доступно`, { user: withTable(t) });
      return;
  }
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => { store.flush(); stats.flush(); process.exit(0); });
}

server.listen(PORT, () => {
  console.log(`🎩 QWX POKER: ${PUBLIC_URL} (порт ${PORT})`);
});
