// Тесты движка: npm test
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { evaluateHand, fastScore, shuffledDeck } from './Cards';
import { Table } from './Table';
import { decide } from './Bots';

const ev = (s: string) => evaluateHand(s.split(' '));
let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log('✓', name); };

t('категории', () => {
  assert.equal(ev('As Ks Qs Js Ts 2d 3c').name, 'Роял-флеш');
  assert.equal(ev('5s 4s 3s 2s As Kd Kc').name, 'Стрит-флеш');
  assert.equal(ev('9h 9d 9s 9c 2d 3c 4h').name, 'Каре');
  assert.equal(ev('9h 9d 9s 2c 2d 3c 4h').name, 'Фулл-хаус');
  assert.equal(ev('Ah 9h 7h 4h 2h Kd Qc').name, 'Флеш');
  assert.equal(ev('Ah 2d 3c 4s 5h Kd 9c').name, 'Стрит');
  assert.equal(ev('7h 7d 7s Kc 2d 3c 9h').name, 'Сет');
  assert.equal(ev('7h 7d 3s 3c Ad Jc 9h').name, 'Две пары');
  assert.equal(ev('7h 7d 3s 4c Ad Jc 9h').name, 'Пара');
  assert.equal(ev('7h 8d 3s 4c Ad Jc Kh').name, 'Старшая карта');
});

t('кикеры и порядок групп', () => {
  // две пары 8-8-3-3-A сильнее 8-8-5-5-2? Нет: пары 5 старше троек
  assert.ok(ev('8h 8d 5s 5c 2d').score > ev('8s 8c 3h 3d Ad').score);
  assert.ok(ev('Kh Kd As 7c 2d').score > ev('Ks Kc Qs Jc 9d').score);
  assert.ok(ev('2h 2d 2s Ac Ad').score > ev('Kh Kd Ks Qc Qd').score === false);
  assert.ok(ev('3h 3d 3s 2c 2d').score > ev('2h 2s 2c Ac Ad').score);
  assert.ok(ev('6h 2d 3c 4s 5h').score > ev('Ah 2d 3c 4s 5h').score, 'колесо младше 6-стрита');
  assert.equal(ev('Ah Kd 7c 4s 2h').score, ev('As Kc 7d 4h 2c').score);
});

t('быстрая оценка совпадает с полной (20 000 рук)', () => {
  for (let i = 0; i < 20000; i++) {
    const d = shuffledDeck(n => randomInt(0, n));
    const k = 5 + (i % 3);
    const h = d.slice(0, k);
    assert.equal(fastScore(h), evaluateHand(h).score, h.join(' '));
  }
});

function mk() {
  let i = 0;
  const table = new Table('t', 25, 50, n => (i++ * 7919) % n);
  return table;
}

t('сайд-поты: короткий олл-ин', () => {
  const table = mk();
  table.sit({ id: 'a', name: 'A', seat: 0, stack: 1000, isBot: false });
  table.sit({ id: 'b', name: 'B', seat: 1, stack: 300, isBot: false });
  table.sit({ id: 'c', name: 'C', seat: 2, stack: 1000, isBot: false });
  table.startHand();
  // подменяем карты: B — лучшая рука, A — вторая
  table.seats[0]!.cards = ['Kh', 'Kd'];
  table.seats[1]!.cards = ['Ah', 'Ad'];
  table.seats[2]!.cards = ['7c', '2d'];
  // pop() берёт с конца: бёрн, флоп Qs Th 4c, бёрн, тёрн 9s, бёрн, ривер 3d
  table.deck = ['3d', '8c', '9s', '6c', '4c', 'Th', 'Qs', '5h'];
  let guard = 0;
  while (table.stage !== 'HAND_OVER' && guard++ < 50) {
    if (table.pendingAdvance) { table.advance(); continue; }
    const s = table.activeSeat;
    if (table.stage === 'PREFLOP' && s === 0) table.act(s, 'RAISE', 1000);
    else table.act(s, 'CALL');
  }
  const total = table.players().reduce((s, p) => s + p.stack, 0);
  assert.equal(total, 2300, 'фишки сохраняются');
  const b = table.seats[1]!;
  assert.equal(b.stack, 900, 'B выигрывает главный банк 3×300');
  const a = table.seats[0]!;
  assert.equal(a.stack, 1400, 'A забирает сайд-пот 2×700');
});

t('все фолдят — банк без вскрытия, show/muck', () => {
  const table = mk();
  table.sit({ id: 'a', name: 'A', seat: 0, stack: 1000, isBot: false });
  table.sit({ id: 'b', name: 'B', seat: 3, stack: 1000, isBot: false });
  table.startHand(); // heads-up: баттон = SB ходит первым
  const first = table.activeSeat;
  table.act(first, 'RAISE', 150);
  table.act(table.activeSeat, 'FOLD');
  assert.equal(table.stage, 'HAND_OVER');
  assert.equal(table.showdown, false);
  const v = table.view(table.seats[first]!.id);
  assert.equal(v.canReveal, true);
  assert.equal(table.seats[first]!.stack, 1050);
  assert.ok(table.reveal(first, 'ONE'));
  const other = table.view(table.seats[(first + 3) % 6]!.id);
  assert.ok(other.seats[first]!.cards[0] !== null && other.seats[first]!.cards[1] === null);
});

t('опция большого блайнда', () => {
  const table = mk();
  for (let s = 0; s < 3; s++) table.sit({ id: 'p' + s, name: 'P', seat: s, stack: 1000, isBot: false });
  table.startHand();
  const bbSeat = table.players().find(p => p.lastAction?.type === 'BB')!.seat;
  while (table.activeSeat !== bbSeat) table.act(table.activeSeat, 'CALL');
  assert.equal(table.pendingAdvance, false, 'BB получает право хода');
  table.act(bbSeat, 'CHECK');
  assert.equal(table.pendingAdvance, true);
});

t('1000 случайных раздач ботами — фишки не теряются', () => {
  const table = new Table('fuzz', 25, 50, n => randomInt(0, n));
  const names = ['a','b','c','d','e','f'];
  const ps = ['ROCK','SHARK','BLUFFER','TOURIST','SHARK','BLUFFER'] as const;
  names.forEach((id, i) => table.sit({ id, name: id, seat: i, stack: 2000 + i * 500, isBot: true, personality: ps[i] }));
  const start = table.players().reduce((s, p) => s + p.stack, 0);
  for (let h = 0; h < 1000; h++) {
    for (const p of table.players()) if (p.stack === 0) p.stack = 0;
    if (!table.startHand()) {
      // все проиграли одному — раздаём заново
      for (const p of table.players()) p.stack = start / 6;
      continue;
    }
    let guard = 0;
    while (table.stage !== 'HAND_OVER' && guard++ < 300) {
      if (table.pendingAdvance) { table.advance(); continue; }
      const d = decide(table, table.activeSeat);
      assert.ok(table.act(table.activeSeat, d.type, d.amount));
    }
    assert.equal(table.stage, 'HAND_OVER');
    const sum = table.players().reduce((s, p) => s + p.stack, 0);
    if (sum !== start) {
      // разрешено только после принудительного «обнуления» выше
      assert.equal(sum, start, `раздача ${h}: ${sum} ≠ ${start}`);
    }
  }
});

console.log(`\nВсе тесты пройдены: ${n}`);
