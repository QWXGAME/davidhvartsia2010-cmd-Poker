"""Упрощённые версии модели рук (LOD): hands.bin -> hands_lodN.bin того же формата.
Упрощение — fast-simplification (quadric), атрибуты (UV, нормали, кости) переносятся с ближайшей
вершины оригинала.  Запуск:  python3 tools/hand_lod.py public/models/hands.bin public/models/hands_lo.bin 0.12
"""
import json, struct, sys
import numpy as np
import fast_simplification

src, dst, keep = sys.argv[1], sys.argv[2], float(sys.argv[3])
raw = open(src, 'rb').read()
n = struct.unpack('<I', raw[:4])[0]
head = json.loads(raw[4:4 + n]); base = 4 + n

def arr(h, key, dtype, comps):
    o = h['offsets'][key]
    cnt = h['count'] * comps if key != 'I' else h['index']
    return np.frombuffer(raw, dtype=dtype, count=cnt, offset=base + o).reshape(-1, comps if key != 'I' else 3)

out = {}
for side, h in head['hands'].items():
    P = arr(h, 'P', np.float32, 3); N = arr(h, 'N', np.float32, 3); UV = arr(h, 'UV', np.float32, 2)
    I = arr(h, 'I', np.dtype(h['indexType']), 3).astype(np.int64)
    SI = arr(h, 'SI', np.uint8, 4); SW = arr(h, 'SW', np.uint8, 4)
    P2, F2 = fast_simplification.simplify(P, I, target_reduction=1 - keep)
    # ближайшая исходная вершина (порциями, чтобы не съесть память)
    near = np.empty(len(P2), np.int64)
    for s in range(0, len(P2), 2048):
        d = ((P2[s:s + 2048, None, :] - P[None, :, :]) ** 2).sum(-1)
        near[s:s + 2048] = d.argmin(1)
    N2 = np.zeros_like(P2)
    tri = P2[F2]; fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    for k in range(3): np.add.at(N2, F2[:, k], fn)
    N2 /= np.linalg.norm(N2, axis=1, keepdims=True) + 1e-12
    # обход как у оригинала
    if (N2 * N[near]).sum(1).mean() < 0: F2 = F2[:, [0, 2, 1]]; N2 = -N2
    out[side] = dict(P=P2.astype(np.float32), N=N2.astype(np.float32), UV=UV[near].astype(np.float32),
                     I=F2.astype(np.uint16 if len(P2) < 65536 else np.uint32), SI=SI[near], SW=SW[near], bones=h['bones'])
    print(side, len(I), '->', len(F2), 'tris')

blobs = []; header = {'hands': {}}; off = 0
def add(a):
    global off
    b = np.ascontiguousarray(a).tobytes(); pad = (-len(b)) % 4
    blobs.append(b + b'\0' * pad); o = off; off += len(b) + pad; return o
for side, h in out.items():
    header['hands'][side] = {'count': len(h['P']), 'index': len(h['I']) * 3, 'indexType': str(h['I'].dtype),
                             'bones': h['bones'], 'offsets': {k: add(h[k]) for k in ('P', 'N', 'UV', 'I', 'SI', 'SW')}}
js = json.dumps(header).encode(); js += b' ' * ((-len(js)) % 4)
with open(dst, 'wb') as f:
    f.write(struct.pack('<I', len(js))); f.write(js)
    for b in blobs: f.write(b)
print('written', dst, round((4 + len(js) + off) / 1024), 'KB')
