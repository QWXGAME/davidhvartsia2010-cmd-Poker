// Каталог VIP-бутика — общий для сервера (цены, проверка) и клиента (витрина, 3D).

/**
 * Предмет бутика. Купленный предмет лежит на столе у владельца — его видят все игроки.
 * model — ключ 3D-модели в src/client/scene/items.ts.
 */
export interface ShopItem {
  id: string;
  name: string;
  note: string;
  price: number;
  model: string;
}

/** Витрина пуста — предметы добавляются сюда (и их модели — в items.ts). */
// Витрина временно пуста. Готовые позиции (3D-модели уже лежат в src/client/scene/items.ts — phone, tt, keyfob):
//   { id: 'PHONE_PRO', name: 'Смартфон Pro Max · бордо', note: 'Тройная камера, матовый бордо', price: 25000, model: 'phone' },
//   { id: 'PISTOL_TT', name: 'Тульский Токарев', note: 'ТТ образца 1933 года. Воронёная сталь, бакелит', price: 40000, model: 'tt' },
//   { id: 'KEY_SUV', name: 'Ключ от «кубика»', note: 'Хром и чёрный софт-тач', price: 60000, model: 'keyfob' },
export const CATALOG: ShopItem[] = [];

/** сколько вещей можно одновременно положить на стол */
export const MAX_ON_TABLE = 2;

/** включить/выключить вещь на столе; при переполнении убирается самая давняя */
export function toggleEquip(items: string[], id: string): string[] {
  if (items.includes(id)) return items.filter(x => x !== id);
  const next = [...items, id];
  return next.slice(Math.max(0, next.length - MAX_ON_TABLE));
}

export const ITEM = Object.fromEntries(CATALOG.map(i => [i.id, i])) as Record<string, ShopItem>;

/** цвет сукна клуба */
export const FELT_COLOR = '#56172a';

export const DEFAULT_OWNED: string[] = [];

/** что из купленного сейчас лежит на столе */
export interface Equipped { items: string[] }
export const DEFAULT_EQUIPPED: Equipped = { items: [] };

export interface Profile {
  id: string;
  name: string;
  balance: number;
  owned: string[];
  equipped: Equipped;
  /** Telegram @username (без @), если вход через Telegram */
  username?: string;
  /** код аккаунта для переводов, например QWX-7KD2PM */
  code?: string;
  /** статистика и клубные функции */
  stats?: { hands: number; wins: number; biggestPot: number; refs: number };
  refCode?: string;
  /** когда снова можно крутить колесо (ms, 0 — уже можно) */
  wheelAt?: number;
  /** сезонный пропуск: опыт в текущем сезоне и id сезона */
  xp?: number;
  season?: string;
  /** открытые награды: рубашки, сукно (id из UNLOCKS) */
  unlocks?: string[];
  /** владелец клуба — видит админ-панель */
  admin?: boolean;
  /** фишки кончились: когда заведение угостит (ms), 0 — не ждём */
  refillAt?: number;
}

// ───────────────────────── награды, сезон, турнир ─────────────────────────

/** Всё, что открывается наградами: рубашки карт и сукно (оформление — только у себя на экране). */
export const UNLOCKS: { id: string; kind: 'back' | 'felt'; name: string }[] = [
  { id: 'crimson', kind: 'back', name: 'Рубашка «Кармин»' },
  { id: 'jade', kind: 'back', name: 'Рубашка «Нефрит»' },
  { id: 'ivory', kind: 'back', name: 'Рубашка «Слоновая кость»' },
  { id: 'royal', kind: 'back', name: 'Рубашка «Королевская»' },
  { id: 'friday_gold', kind: 'back', name: 'Рубашка «Пятница · Золото»' },
  { id: 'friday_silver', kind: 'back', name: 'Рубашка «Пятница · Серебро»' },
  { id: 'friday_bronze', kind: 'back', name: 'Рубашка «Пятница · Бронза»' },
  { id: 'graphite', kind: 'felt', name: 'Сукно «Графит»' },
  { id: 'tobacco', kind: 'felt', name: 'Сукно «Табак»' },
  { id: 'royalblue', kind: 'felt', name: 'Сукно «Королевский синий»' },
];
export const UNLOCK_IDS = new Set(UNLOCKS.map(u => u.id));

/** Сезонный пропуск: месяц по Москве, опыт за руки и победы, награды на уровнях. */
export const SEASON = {
  XP_HAND: 10, XP_WIN: 15, XP_TOURNEY: 100, PER_LEVEL: 200, LEVELS: 20,
  REWARDS: {
    2: { unlock: 'crimson' }, 4: { unlock: 'graphite' }, 6: { chips: 5000 }, 8: { unlock: 'jade' }, 10: { unlock: 'tobacco' },
    12: { chips: 10000 }, 14: { unlock: 'ivory' }, 16: { unlock: 'royalblue' }, 18: { chips: 20000 }, 20: { unlock: 'royal' },
  } as Record<number, { unlock?: string; chips?: number }>,
};
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export function seasonId(now = Date.now()) {
  const d = new Date(now + 3 * 3600_000);   // Москва
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function seasonName(id: string) { return `Сезон «${MONTHS[Number(id.slice(5, 7)) - 1] || ''}»`; }
export function seasonEnds(now = Date.now()) {
  const d = new Date(now + 3 * 3600_000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 3 * 3600_000;
}
export const levelOf = (xp: number) => Math.min(SEASON.LEVELS, Math.floor(xp / SEASON.PER_LEVEL) + 1);

/** Фишки кончились: перерыв, потом заведение угощает. */
export const REFILL = { AMOUNT: 1000, WAIT: 30 * 60_000, BELOW: 1000 };

/** Турнир «Ночь пятницы» */
export const TOURNEY = {
  NAME: 'Ночь пятницы', MAX: 18, STACK: 5000, LEVEL_MS: 5 * 60_000, TURN_MS: 20000,
  BLINDS: [[25, 50], [50, 100], [75, 150], [100, 200], [150, 300], [200, 400], [300, 600], [400, 800], [600, 1200], [800, 1600], [1000, 2000], [1500, 3000], [2000, 4000]] as [number, number][],
  PRIZES: [{ unlock: 'friday_gold', chips: 50000 }, { unlock: 'friday_silver', chips: 25000 }, { unlock: 'friday_bronze', chips: 10000 }],
};
export interface TourneyInfo {
  state: 'REG' | 'RUNNING' | 'DONE';
  startsAt: number;
  registered: number;
  me: boolean;
  /** я за турнирным столом прямо сейчас */
  playing?: boolean;
  left?: number;
  level?: number;
  blinds?: [number, number];
  results?: { place: number; name: string; bot?: boolean }[];
}
export interface AdminUser { id: string; name: string; username: string; balance: number; tableStack: number; hands: number; wins: number; xp: number; unlocks: string[]; createdAt: number; online: boolean; lastSeen?: number; code?: string; table?: string }

/** итоги дня по Москве (для админ-панели) */
export interface DayStats {
  day: string;
  hands: number; turnover: number; won: number; lost: number; biggestPot: number;
  players: number; newPlayers: number; peakOnline: number; tables: number;
  wheel: number; refill: number; transfers: number; fees: number;
  adminGiven: number; adminTaken: number; tourneyPrizes: number;
}
export interface ClubEvent { at: number; kind: 'join' | 'new' | 'table' | 'win' | 'wheel' | 'transfer' | 'refill' | 'tourney' | 'admin' | 'ref'; text: string; who?: string }
export interface AdminTable { id: string; blinds: string; players: number; humans: string[]; stage: string; pot: number; tourney: boolean; hands: number }
export interface AdminOverview {
  online: number; users: number; chipsTotal: number; chipsOnTables: number;
  days: DayStats[]; tables: AdminTable[]; events: ClubEvent[]; onlineUsers: AdminUser[];
}

/** Колесо фортуны: секторы по кругу и их «вес» (шанс). Общие для сервера и клиента. */
export const WHEEL: { v: number; w: number }[] = [
  { v: 500, w: 22 }, { v: 2500, w: 12 }, { v: 1000, w: 18 }, { v: 10000, w: 3 },
  { v: 500, w: 22 }, { v: 5000, w: 6 }, { v: 1000, w: 18 }, { v: 25000, w: 1 },
  { v: 500, w: 22 }, { v: 2500, w: 12 }, { v: 1000, w: 18 }, { v: 5000, w: 6 },
];
export const WHEEL_COOLDOWN = 24 * 3600_000;
export const REF_BONUS = 5000;

export interface OpenTable { id: string; sb: number; bb: number; players: number; humans: number; started: boolean; owner: string }

// Протокол клиент ↔ сервер
export type ClientMsg =
  | { t: 'ACTION'; action: 'FOLD' | 'CHECK' | 'CALL' | 'RAISE' | 'ALLIN'; amount?: number }
  | { t: 'REVEAL'; which: 'NONE' | 'ONE' | 'BOTH' }
  | { t: 'SHOP'; itemId: string }
  | { t: 'REBUY' }
  | { t: 'LEAVE' }
  // лобби
  | { t: 'CREATE'; sb: number; bb: number }
  /** сразу за стол с ботами: создать, посадить 5 ботов и начать */
  | { t: 'QUICK'; sb: number }
  | { t: 'JOIN'; room: string }
  | { t: 'ADD_BOT' }
  | { t: 'REMOVE_BOT' }
  | { t: 'START' }
  | { t: 'BONUS' }
  | { t: 'TOP' }
  | { t: 'RENAME'; name: string }
  /** перевод фишек игроку по Telegram @username */
  | { t: 'TRANSFER'; to: string; amount: number }
  | { t: 'HISTORY' }
  /** крутить колесо фортуны */
  | { t: 'WHEEL' }
  /** список открытых столов и счётчик игроков */
  | { t: 'TABLES' }
  /** пришёл по реферальной ссылке */
  | { t: 'REF'; code: string }
  /** проверка связи */
  | { t: 'PING' }
  /** турнир: узнать состояние / записаться (on=true) или отписаться */
  | { t: 'TOURNEY' }
  | { t: 'TOURNEY_REG'; on: boolean }
  /** админ-панель владельца клуба */
  | { t: 'ADMIN'; op: 'find' | 'give' | 'set' | 'unlock' | 'lock' | 'xp' | 'list' | 'broadcast' | 'tourneyStart' | 'resetWheel' | 'overview' | 'events'; target?: string; amount?: number; item?: string; text?: string };

export interface TransferRecord { at: number; from: string; to: string; amount: number; fee: number; dir: 'in' | 'out' }

export type ServerMsg =
  | { t: 'STATE'; view: import('./Table').TableView }
  | { t: 'PROFILE'; profile: Profile }
  | { t: 'TOAST'; text: string; ok?: boolean }
  | { t: 'ERROR'; text: string }
  /** не за столом — показываем главный экран лобби */
  | { t: 'HOME'; resume?: string; invite?: string }
  /** нужен вход через Google */
  | { t: 'AUTH' }
  /** этот аккаунт открыли на другом устройстве/вкладке — здесь игра останавливается */
  | { t: 'KICKED' }
  | { t: 'WHEEL'; ok: boolean; index?: number; prize?: number; wheelAt?: number; text?: string }
  | { t: 'TABLES'; online: number; tables: OpenTable[] }
  | { t: 'HISTORY'; items: TransferRecord[] }
  | { t: 'TOP'; top: { name: string; profit: number }[] }
  | { t: 'PONG' }
  | { t: 'TOURNEY'; info: TourneyInfo }
  | { t: 'ADMIN'; ok: boolean; text?: string; user?: AdminUser; users?: AdminUser[]; overview?: AdminOverview; events?: ClubEvent[]; userEvents?: ClubEvent[] };

/** ближайшая пятница 21:00 по Москве (UTC+3) */
export function nextFriday(now = Date.now()): number {
  const msk = new Date(now + 3 * 3600_000);
  const d = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate(), 21, 0, 0));
  let add = (5 - d.getUTCDay() + 7) % 7;
  let t = d.getTime() + add * 86400_000 - 3 * 3600_000;
  if (t <= now) { add = 7; t += 7 * 86400_000; }
  return t;
}

