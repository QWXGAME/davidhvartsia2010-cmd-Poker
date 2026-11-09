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
  /** статистика и клубные функции */
  stats?: { hands: number; wins: number; biggestPot: number; refs: number };
  refCode?: string;
  /** когда снова можно крутить колесо (ms, 0 — уже можно) */
  wheelAt?: number;
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
  | { t: 'REF'; code: string };

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
  | { t: 'TOP'; top: { name: string; profit: number }[] };
