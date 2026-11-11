// Вход только через Telegram: виджет входа на сайте и автоматический вход в мини-приложении.
// Сервер проверяет подпись Telegram и выдаёт свой сессионный токен (HMAC, 30 дней). Гостей нет.
//
//   TELEGRAM_BOT_TOKEN — токен бота от @BotFather
//   TELEGRAM_BOT_NAME  — логин бота без @ (домен игры задаётся у @BotFather: /setdomain)
//   SESSION_SECRET     — секрет для подписи сессий (если не задан — создаётся в data/secret.key)

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** вход через Google отключён — только Telegram */
export const GOOGLE_CLIENT_ID = '';
//   TELEGRAM_BOT_TOKEN / TELEGRAM_BOT_NAME — бот для входа через Telegram (домен сайта задаётся у @BotFather: /setdomain)
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
export const TELEGRAM_BOT_NAME = (process.env.TELEGRAM_BOT_NAME || '').replace(/^@/, '');
/** вход обязателен, если настроен хотя бы один способ */
export const LOGIN_REQUIRED = !!(TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_NAME);

// папка с балансами и аккаунтами; на хостинге — постоянный диск (DATA_DIR)
const DATA = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA, { recursive: true });
const SECRET = (() => {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA, 'secret.key');
  try { return fs.readFileSync(f, 'utf-8').trim(); } catch { /* создадим */ }
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
})();

// ───────────── ключи Google (кэшируются по Cache-Control) ─────────────

let keys: Record<string, crypto.KeyObject> = {};
let keysUntil = 0;

async function googleKey(kid: string): Promise<crypto.KeyObject | null> {
  if (Date.now() > keysUntil || !keys[kid]) {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    const j = await r.json() as { keys: (crypto.JsonWebKey & { kid: string })[] };
    keys = {};
    for (const k of j.keys) keys[k.kid] = crypto.createPublicKey({ key: k, format: 'jwk' });
    const age = Number(/max-age=(\d+)/.exec(r.headers.get('cache-control') || '')?.[1]) || 3600;
    keysUntil = Date.now() + age * 1000;
  }
  return keys[kid] || null;
}

const b64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export interface GoogleUser { sub: string; name: string; email: string }

/** Проверка ID-токена: подпись RS256, издатель, аудитория (наш Client ID), срок. */
export async function verifyGoogle(idToken: string): Promise<GoogleUser | null> {
  if (!GOOGLE_CLIENT_ID) return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  try {
    const head = JSON.parse(b64(parts[0]).toString()) as { alg: string; kid: string };
    if (head.alg !== 'RS256') return null;
    const key = await googleKey(head.kid);
    if (!key) return null;
    const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, b64(parts[2]));
    if (!ok) return null;
    const p = JSON.parse(b64(parts[1]).toString()) as { iss: string; aud: string; exp: number; sub: string; name?: string; given_name?: string; email?: string; email_verified?: boolean };
    if (p.iss !== 'accounts.google.com' && p.iss !== 'https://accounts.google.com') return null;
    if (p.aud !== GOOGLE_CLIENT_ID) return null;
    if (p.exp * 1000 < Date.now()) return null;
    return { sub: p.sub, name: p.given_name || p.name || 'Игрок', email: p.email || '' };
  } catch {
    return null;
  }
}

// ───────────── Telegram Login Widget ─────────────

export interface TelegramUser { id: string; name: string }

/**
 * Проверка данных виджета: hash = HMAC-SHA256(data_check_string, SHA256(bot_token)),
 * data_check_string — все поля, кроме hash, «ключ=значение», по алфавиту, через \n. Не старше суток.
 */
export function verifyTelegram(data: Record<string, unknown>): TelegramUser | null {
  if (!TELEGRAM_BOT_TOKEN || !data || typeof data.hash !== 'string') return null;
  const fields = Object.keys(data).filter(k => k !== 'hash' && data[k] !== undefined && data[k] !== null).sort();
  const dcs = fields.map(k => `${k}=${data[k]}`).join('\n');
  const secret = crypto.createHash('sha256').update(TELEGRAM_BOT_TOKEN).digest();
  const want = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  const got = String(data.hash);
  if (got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return null;
  if (Date.now() / 1000 - Number(data.auth_date) > 86400) return null;
  const name = String(data.first_name || data.username || 'Игрок');
  return { id: String(data.id), name };
}

/**
 * Вход из мини-приложения Telegram: проверяем подпись initData (секрет = HMAC("WebAppData", токен бота)).
 * Подделать нельзя — подпись знает только Telegram и наш сервер. Данные действительны 7 дней.
 */
export function verifyTelegramWebApp(initData: string): (TelegramUser & { username: string }) | null {
  if (!TELEGRAM_BOT_TOKEN || !initData || initData.length > 4096) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash') || '';
  p.delete('hash');
  const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TELEGRAM_BOT_TOKEN).digest();
  const want = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  if (hash.length !== want.length || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(want))) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 7 * 86400) return null;
  let user: { id?: number; first_name?: string; username?: string } = {};
  try { user = JSON.parse(p.get('user') || '{}'); } catch { return null; }
  if (!user.id) return null;
  return { id: String(user.id), name: String(user.first_name || user.username || 'Игрок'), username: String(user.username || '') };
}

// ───────────── свои сессии: id.срок.подпись ─────────────

const sign = (s: string) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');

export function issueSession(userId: string): string {
  const body = `${userId}.${Date.now() + 30 * 24 * 3600_000}`;
  return `${body}.${sign(body)}`;
}

export function checkSession(token: string): string | null {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const body = token.slice(0, i), sig = token.slice(i + 1);
  const want = sign(body);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  const [id, exp] = body.split('.');
  if (!id || Number(exp) < Date.now()) return null;
  return id;
}
