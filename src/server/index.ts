// Сервер QWX POKER: раздаёт собранный клиент и держит столы по WebSocket.
//
//   PUBLIC_URL — адрес сайта с игрой (для ссылок-приглашений), например https://poker.example.com
//   PORT       — порт (по умолчанию 3000)
//
// Вход: аккаунт Google (GOOGLE_CLIENT_ID задан — гостей нет). Без него — режим разработки:
// браузер хранит секретный токен, сервер узнаёт игрока по его хэшу.

import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { TableHost } from '../shared/TableHost';
import type { ClientMsg, ServerMsg } from '../shared/Catalog';
import { store, ladder } from './db';
import { GOOGLE_CLIENT_ID, TELEGRAM_BOT_NAME, LOGIN_REQUIRED, verifyGoogle, verifyTelegram, issueSession, checkSession } from './auth';

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
      store.recordHand(r.humans, stacks, r.deltas, r.potTotal);
      for (const pid of r.humans) pushProfile(pid);
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
  return host;
}

// пустые столы живут 15 минут
setInterval(() => {
  const now = Date.now();
  for (const [id, host] of rooms) {
    if (host.humans > 0) { emptySince.delete(id); continue; }
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
    if (!amount) { toast(s.ws, 'Не хватает фишек для бай-ина — покрути колесо фортуны в меню', false); return false; }
    const seat = host.join(u.id, u.name, amount, 'RING_GOLD', u.equipped.items);
    if (seat < 0) { store.cashOut(u, amount); toast(s.ws, 'За столом нет мест', false); return false; }
    pushProfile(u.id);
  }
  s.unsub();
  s.room = host;
  s.unsub = host.subscribe(u.id, view => send(s.ws, { t: 'STATE', view }));
  return true;
}

function leaveRoom(s: Session) {
  if (!s.room) return;
  s.unsub();
  s.unsub = () => {};
  s.room.leave(s.userId);
  s.room = null;
  send(s.ws, { t: 'HOME' });
}

// ───────────────────────── HTTP ─────────────────────────

const DIST = path.join(process.cwd(), 'dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.mp3': 'audio/mpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  learnOrigin(req);
  const url = (req.url || '/').split('?')[0];
  if (url === '/health') { res.end('ok'); return; }
  if (url.startsWith('/auth/')) { authRoute(req, res, url); return; }
  let file = path.normalize(path.join(DIST, decodeURIComponent(url === '/' ? '/index.html' : url)));
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    if (path.extname(url)) { res.writeHead(404); res.end(); return; }
    file = path.join(DIST, 'index.html');
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
  } else {
    const user = identify(q.get('token') || '', q.get('name') || '');
    if (!user) { send(ws, { t: 'ERROR', text: 'Не удалось войти' }); ws.close(); return; }
    u = store.getOrCreate(user.id, user.name, '');
  }
  clearTimeout(leaveTimers.get(u.id));
  leaveTimers.delete(u.id);

  // один аккаунт — одна активная вкладка: старая получает KICKED и перестаёт переподключаться
  const old = sessions.get(u.id);
  if (old) { old.unsub(); send(old.ws, { t: 'KICKED' }); old.ws.close(); }

  const session: Session = { ws, userId: u.id, room: null, unsub: () => {} };
  sessions.set(u.id, session);
  send(ws, { t: 'PROFILE', profile: store.profile(u) });

  // всегда сначала лобби; если уже сидит за столом или пришёл по приглашению — там кнопка «вернуться/сесть»
  const want = (q.get('room') || '').toUpperCase();
  const current = roomOf(u.id);
  if (want && !rooms.has(want) && !current) toast(ws, 'Этот стол уже закрыт', false);
  send(ws, { t: 'HOME', resume: current?.table.id, invite: want && rooms.has(want) && rooms.get(want) !== current ? want : undefined });

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
        if (u.balance < bb * 20) { toast(ws, `Для стола ${sb}/${bb} нужно хотя бы ${bb * 20} фишек`, false); send(ws, { t: 'HOME' }); break; }
        enter(session, createRoom(u.id, sb, bb));
        break;
      }
      case 'QUICK': {
        if (host) leaveRoom(session); else roomOf(u.id)?.leave(u.id);
        const [sb, bb] = BLINDS.find(([s]) => s === m.sb) || BLINDS[0];
        if (u.balance < bb * 20) { toast(ws, `Для стола ${sb}/${bb} нужно хотя бы ${bb * 20} фишек`, false); send(ws, { t: 'HOME' }); break; }
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
        if (!host) break;
        const p = host.table.byId(u.id);
        if (!p) { enter(session, host); break; }
        if (p.stack > 0) break;
        const amount = store.buyIn(u, host.table.bb * 100, host.table.bb * 20);
        if (!amount) { toast(ws, 'Не хватает фишек — покрути колесо фортуны в меню', false); break; }
        if (!host.rebuy(u.id, amount)) store.cashOut(u, amount);
        pushProfile(u.id);
        break;
      }
      case 'WHEEL': {
        const r = store.spinWheel(u.id);
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
          pushProfile(r.to);
          const peer = sessions.get(r.to);
          if (peer) { toast(peer.ws, `Вам перевели фишки: ${u.username ? '@' + u.username : u.name}`, true); send(peer.ws, { t: 'HISTORY', items: store.history(r.to) }); }
        }
        if (r.ok) {
          send(ws, { t: 'HISTORY', items: store.history(u.id) });
        }
        break;
      }
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
    // минута на переподключение, потом встаём из-за стола
    leaveTimers.set(u.id, setTimeout(() => {
      leaveTimers.delete(u.id);
      if (!sessions.has(u.id)) room.leave(u.id);
    }, 60_000));
  });
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => { store.flush(); process.exit(0); });
}

server.listen(PORT, () => {
  console.log(`🎩 QWX POKER: ${PUBLIC_URL} (порт ${PORT})`);
});
