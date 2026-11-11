// Общий интерфейс стола: его реализуют 3D-мир (World, three.js) и 2D-стол (Table2D, DOM).
// Интерфейс (Hud, Menu, main) работает только с ним — поэтому в 2D-режиме three.js вообще не загружается.

import type { TableView } from '../../shared/Table';

export interface ScreenPos { x: number; y: number; visible: boolean }

/** Звуки и эффекты, которые стол вызывает по ходу раздачи. */
export interface TableFx {
  deal(): void;
  chips(n: number): void;
  check(): void;
  fold(): void;
  flip(): void;
  collect(): void;
  paper(): void;
  heartbeat(): void;
  chipTick(): void;
  win(mine: boolean): void;
  allin?(): void;
  shuffle?(): void;
}

export interface TableHost {
  readonly kind: '3d' | '2d';
  apply(v: TableView): void;
  clear(): void;
  highlightCodes(codes: string[]): void;
  setFelt(color: string): void;
  setBack(style: string): void;
  squeezeMode: boolean;
  /** нажата кнопка действия на столе (3D-табличка); 2D — DOM-кнопки интерфейса */
  onPlate?: (i: number) => void;
  itemThumb(model: string): string;
  /** таблички действий в борту (только 3D) */
  plates: {
    visible: boolean;
    set(i: number, main: string, small: string, enabled: boolean): void;
    setLive(v: boolean): void;
    press(i: number): void;
    /** верхний край табличек на экране (телефон) — чтобы панели не закрывали кнопки; null — табличек нет */
    topY(): number | null;
  };
  seatScreen(seat: number, out: ScreenPos): void;
  boardScreen(out: ScreenPos): void;
  onFrame(cb: () => void): void;
  onLowPower(cb: (low: boolean) => void): void;
  /** фоновое движение за лобби */
  setOrbit(v: boolean): void;
  /** «осмотр зала» при входе за стол */
  intro(): void;
  glanceOnTurn(): void;
}
