// Геометрия стола и раскладка мест. Единицы — метры, стол вытянут вдоль оси Z, игрок сидит в +Z.

import * as THREE from 'three';

export const FELT_R = 0.95;  // радиус закруглений сукна
export const FELT_L = 0.5;   // половина прямого участка — стол короче, соперники ближе, как на фото
/** центр стола сдвинут к игроку так, что ближний край остаётся на месте */
export const TABLE_Z = 0.45;
export const RAIL_W = 0.22;
export const RAIL_H = 0.05;
export const LAMP_Z = 0.2;
export const LAMP_Y = 1.15;

export const END_Z = TABLE_Z + FELT_L + FELT_R; // ближний край сукна (1.9)
export const FAR_Z = TABLE_Z - FELT_L - FELT_R;

export interface SeatGeo {
  edge: THREE.Vector3;  // точка на кромке сукна
  out: THREE.Vector3;   // наружу от стола
  side: THREE.Vector3;  // вправо с точки зрения сидящего
  cards: THREE.Vector3;
  stack: THREE.Vector3;
  bet: THREE.Vector3;
  plate: THREE.Vector3;
  figure: THREE.Vector3;
  label: THREE.Vector3; // якорь HTML-плашки
}

const V = (x: number, z: number) => new THREE.Vector3(x, 0, z);

// визуальный индекс 0 — это всегда «я» (ближний торец), дальше по часовой стрелке (слева от меня)
const RAW: [number, number, number, number][] = [
  [0, END_Z, 0, 1],
  [-FELT_R, TABLE_Z - 0.2, -1, 0],
  [-FELT_R * 0.72, TABLE_Z - FELT_L - FELT_R * 0.69, -0.72, -0.69],
  [0, FAR_Z, 0, -1],
  [FELT_R * 0.72, TABLE_Z - FELT_L - FELT_R * 0.69, 0.72, -0.69],
  [FELT_R, TABLE_Z - 0.2, 1, 0],
];

export const SEATS: SeatGeo[] = RAW.map(([x, z, ox, oz]) => {
  const edge = V(x, z);
  const out = V(ox, oz);
  // «право» для сидящего лицом к центру: out × up
  const side = new THREE.Vector3().crossVectors(out, new THREE.Vector3(0, 1, 0)).negate();
  const at = (d: number, s = 0) => edge.clone().addScaledVector(out, -d).addScaledVector(side, s);
  return {
    edge, out, side,
    cards: at(0.24, -0.02),
    stack: at(0.13, 0.22),
    bet: at(0.44, 0.06),
    plate: edge.clone().addScaledVector(out, RAIL_W * 0.5),
    figure: edge.clone().addScaledVector(out, 0.5),
    label: edge.clone().addScaledVector(out, 0.5).setY(0.66),
  };
});

// мой угол: карты по центру, фишки справа, бокал, пепельница и ствол — как на референсе
// боковые места стоят рядом с доской — их ставки и карты держим ближе к борту
for (const i of [1, 5]) {
  const g = SEATS[i];
  g.bet.copy(g.edge).addScaledVector(g.out, -0.26).addScaledVector(g.side, 0.26);
  g.cards.copy(g.edge).addScaledVector(g.out, -0.17).addScaledVector(g.side, -0.05);
}
SEATS[0].cards.set(0.03, 0, 1.5);
SEATS[0].stack.set(0.42, 0, 1.3);
SEATS[0].bet.set(-0.3, 0, 1.0);

export const POT = V(0, 0.08); // банк за общими картами, как на фото
export const DECK = V(0.48, -0.3);
/** общие карты крупнее карманных — чтобы читались издалека */
export const BOARD_SCALE = 1.5;
export const BOARD_Z = 0.6; // ближе к игроку — карты читаются
export const boardSlot = (i: number) => V((i - 2) * 0.168 * BOARD_SCALE, BOARD_Z);

export const PROPS = {
  ashtray: { x: -0.5, z: 1.22 },
  glass: { x: 0.66, z: 1.36 },
  hands: { right: { x: 0.36, z: 1.5 }, left: { x: -0.12, z: 1.55 } },
};

/** Точки контура «стадиона» (для экструзии бортика и сукна) */
export function stadiumShape(r: number, l: number, segs = 40): THREE.Shape {
  const s = new THREE.Shape();
  // в плоскости XY шейпа: y шейпа = -z мира (после поворота -90° по X)
  s.moveTo(-r, -l);
  s.lineTo(-r, l);
  s.absarc(0, l, r, Math.PI, 0, true);
  s.lineTo(r, -l);
  s.absarc(0, -l, r, 0, -Math.PI, true);
  s.closePath();
  void segs;
  return s;
}
