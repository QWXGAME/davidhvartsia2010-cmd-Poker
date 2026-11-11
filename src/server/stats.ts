// Статистика клуба для админ-панели: дневные итоги (по Москве) и журнал событий сервера.
// Хранится в DATA_DIR: daily.json (последние 90 дней), events.json (последние 2000 событий).

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DayStats, ClubEvent } from '../shared/Catalog';

const DATA = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const read = <T>(f: string, d: T): T => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')) as T; } catch { return d; } };
const write = (f: string, v: unknown) => { try { const p = path.join(DATA, f); fs.writeFileSync(p + '.tmp', JSON.stringify(v)); fs.renameSync(p + '.tmp', p); } catch { /* */ } };

/** дата по Москве YYYY-MM-DD */
export const mskDay = (t = Date.now()) => new Date(t + 3 * 3600_000).toISOString().slice(0, 10);

const blank = (day: string): DayStats => ({
  day, hands: 0, turnover: 0, won: 0, lost: 0, biggestPot: 0, players: 0, newPlayers: 0, peakOnline: 0,
  wheel: 0, refill: 0, transfers: 0, fees: 0, adminGiven: 0, adminTaken: 0, tourneyPrizes: 0, tables: 0,
});

class Stats {
  private days: Record<string, DayStats> = read('daily.json', {});
  private seen: Record<string, string[]> = read('daily_players.json', {});
  private events: ClubEvent[] = read('events.json', []);
  private dirty = false;

  constructor() {
    setInterval(() => this.flush(), 15_000);
  }

  today(): DayStats { return this.day(mskDay()); }
  private day(d: string): DayStats {
    let s = this.days[d];
    if (!s) {
      s = this.days[d] = blank(d);
      // храним 90 дней
      const keys = Object.keys(this.days).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - 90))) { delete this.days[k]; delete this.seen[k]; }
    }
    return s;
  }
  /** последние n дней, от сегодняшнего назад (пустые дни — нулями) */
  recent(n: number): DayStats[] {
    const out: DayStats[] = [];
    for (let i = 0; i < n; i++) { const d = mskDay(Date.now() - i * 86400_000); out.push(this.days[d] ? { ...this.days[d] } : blank(d)); }
    return out;
  }

  add(field: keyof Omit<DayStats, 'day'>, n = 1) { (this.today()[field] as number) += n; this.dirty = true; }
  max(field: 'biggestPot' | 'peakOnline', n: number) { const t = this.today(); if (n > t[field]) { t[field] = n; this.dirty = true; } }

  /** игрок зашёл: считаем уникальных за день */
  visit(id: string, isNew: boolean) {
    const d = mskDay();
    const list = (this.seen[d] ||= []);
    if (!list.includes(id)) { list.push(id); this.today().players = list.length; }
    if (isNew) this.add('newPlayers');
    this.dirty = true;
  }

  /** сыграна раздача с людьми */
  hand(pot: number, deltas: number[]) {
    const t = this.today();
    t.hands++;
    t.turnover += pot;
    for (const d of deltas) { if (d > 0) t.won += d; else t.lost -= d; }
    if (pot > t.biggestPot) t.biggestPot = pot;
    this.dirty = true;
  }

  event(kind: ClubEvent['kind'], text: string, who?: string) {
    this.events.push({ at: Date.now(), kind, text, who });
    if (this.events.length > 2000) this.events.splice(0, this.events.length - 2000);
    this.dirty = true;
  }
  lastEvents(n: number, kind?: string): ClubEvent[] {
    const src = kind ? this.events.filter(e => e.kind === kind) : this.events;
    return src.slice(-n).reverse();
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    write('daily.json', this.days);
    write('daily_players.json', this.seen);
    write('events.json', this.events);
  }
}

export const stats = new Stats();
