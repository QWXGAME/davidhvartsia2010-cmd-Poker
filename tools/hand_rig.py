# Авто-риг кисти: поиск пальцев/суставов по геометрии, кости, веса кожи → бинарный файл для игры.
# Локальные оси кисти: X — поперёк (большой палец у левой руки в +X), Y — тыл кисти, -Z — к кончикам пальцев.
import numpy as np, json, struct, sys
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

d = np.load('/tmp/handsplit.npz')
REAL_LEN = 0.21  # длина кисти от среза запястья до кончика среднего пальца, м

def to_local(name, P):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    if name == 'A':   # левая: тыл → -x
        return np.stack([z, -x, -y], 1)
    return np.stack([-z, x, -y], 1)  # правая: тыл → +x

PID = None  # id вершины по позиции (склейка швов UV)

def components(mask, I):
    # компоненты связности по геометрии (швы текстуры не разрывают поверхность)
    pid = PID
    npid = pid.max() + 1
    pm = np.zeros(npid, bool); pm[pid[mask]] = True
    e = np.concatenate([I[:, [0, 1]], I[:, [1, 2]], I[:, [2, 0]]])
    e = pid[e]
    e = e[pm[e[:, 0]] & pm[e[:, 1]]]
    g = coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(npid, npid))
    n, lab = connected_components(g, directed=False)
    idx = np.where(mask)[0]
    lab_v = lab[pid[idx]]
    # перенумеровать только задействованные компоненты
    u, lab2 = np.unique(lab_v, return_inverse=True)
    return idx, lab2, len(u)

def seg_dist(P, a, b):
    ab = b - a; t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1), t

def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

out = {}
FINGER_LEN = None  # длины пальцев правой руки — анатомический эталон для левой
for name, side in (('B', 'right'), ('A', 'left')):
    P = to_local(name, d[f'{name}_P']); UV = d[f'{name}_UV']; I = d[f'{name}_I']
    _, PID = np.unique(np.round(P, 5), axis=0, return_inverse=True)
    PID = PID.reshape(-1)
    # выбросить мелкие оторванные кусочки сетки (крошки от соседней копии)
    idx_all, lab_all, ncomp = components(np.ones(len(P), bool), I)
    sizes = np.bincount(lab_all)
    keepV = sizes[lab_all] > 500
    if not keepV.all():
        keepF = keepV[I].all(1)
        used = np.zeros(len(P), bool); used[I[keepF].ravel()] = True
        remap = -np.ones(len(P), int); remap[used] = np.arange(used.sum())
        I = remap[I[keepF]]; P = P[used]; UV = UV[used]; PID = PID[used]
        print(name, 'removed fragments:', (~used).sum(), 'verts')
    # срез запястья — в начало координат, масштаб в метры
    zmax = P[:, 2].max(); zmin = P[:, 2].min()
    cx = P[P[:, 2] > zmax - 0.05, 0].mean(); cy = P[P[:, 2] > zmax - 0.05, 1].mean()
    P = P - [cx, cy, zmax]
    s = REAL_LEN / (zmax - zmin); P *= s
    L = REAL_LEN
    thumbSign = 1 if side == 'left' else -1  # большой палец левой — в +X

    # ── большой палец: самая «боковая» компонента
    X = P[:, 0] * thumbSign
    thumb = None
    for xc in np.linspace(X.max() - 0.005, X.min(), 200):
        idx, lab, n = components(X > xc, I)
        # пока компонента одна и она «торчит» (не вся ладонь) — растим
        sizes = np.bincount(lab)
        big = idx[lab == sizes.argmax()]
        span = P[big, 2].max() - P[big, 2].min()
        if span > 0.55 * L: break
        thumb = big
    thumbMask = np.zeros(len(P), bool); thumbMask[thumb] = True

    # ── четыре пальца: срез по Z, где кончики разделены
    # срез, где четыре пальца разделены и самые «ровные» по размеру (каждый палец — своя компонента)
    best = None; bestScore = -1
    for zc in np.linspace(-0.97 * L, -0.35 * L, 200):
        m = (P[:, 2] < zc) & ~thumbMask
        idx, lab, n = components(m, I)
        sizes = np.bincount(lab)
        comps = [idx[lab == k] for k in range(n) if sizes[k] > 60]
        if len(comps) != 4: continue
        # каждый палец должен дотягиваться почти до кончиков: высота компоненты сопоставима с другими
        spans = [P[c, 2].max() - P[c, 2].min() for c in comps]
        score = min(len(c) for c in comps) * (min(spans) / max(spans))
        if score > bestScore: bestScore = score; best = (zc, comps)
    webZ, fingers = best
    # упорядочить от большого пальца к мизинцу
    fingers.sort(key=lambda c: -P[c, 0].mean() * thumbSign)
    print(side, 'webZ', round(webZ, 4), 'finger sizes', [len(c) for c in fingers], 'thumb', len(thumb))

    bones = [{'name': 'wrist', 'parent': -1, 'pos': [0, 0, -0.06 * L / 0.21 * 0.21]}]  # запястный сустав
    bones[0]['pos'] = [0.0, 0.0, -0.045]
    chains = []
    lens = []
    names = ['index', 'middle', 'ring', 'pinky']
    for fi, comp in enumerate(fingers):
        Q = P[comp]
        tip = Q[Q[:, 2].argmin()]
        vis = webZ - tip[2]  # видимая длина от перепонки
        # ось пальца — по центрам срезов
        zs = np.linspace(tip[2] + 0.12 * vis, webZ - 0.02 * vis, 6)
        cen = np.array([Q[np.abs(Q[:, 2] - z) < 0.06 * vis].mean(0) for z in zs])
        cen = cen[~np.isnan(cen).any(1)]
        cc = cen.mean(0); _, _, vt = np.linalg.svd(cen - cc); ax = vt[0]
        if ax[2] > 0: ax = -ax  # к кончику
        tipc = np.array([tip[0], Q[Q[:, 2] < tip[2] + 0.1 * vis, 1].mean(), tip[2] + 0.006])
        if FINGER_LEN is None:
            mcp0 = cc + ax * ((np.array([0, 0, webZ + 0.24 * vis]) - cc)[2] / ax[2])
            Lf = np.linalg.norm(tipc - mcp0)
        else:
            Lf = FINGER_LEN[fi]
        mcp = tipc - ax * Lf
        mcp[1] -= 0.002
        dirv = (tipc - mcp) / np.linalg.norm(tipc - mcp)
        Lf = np.linalg.norm(tipc - mcp)
        lens.append(Lf)
        pip = mcp + dirv * Lf * 0.46
        dip = mcp + dirv * Lf * 0.75
        pts = [mcp, pip, dip, tipc]
        parent = 0
        for j in range(3):
            bones.append({'name': f'{names[fi]}{j}', 'parent': parent, 'pos': pts[j].tolist()})
            parent = len(bones) - 1
        chains.append((pts, len(bones) - 3, comp))
    if FINGER_LEN is None: FINGER_LEN = lens
    print(side, 'finger lengths mm', [round(x * 1000) for x in lens])
    # большой палец: ось по PCA, суставы
    Q = P[thumb]
    c = Q.mean(0); u, sv, vt = np.linalg.svd(Q - c); ax = vt[0]
    if (Q - c) @ ax @ np.ones(len(Q)) and ax[0] * thumbSign < 0: ax = -ax
    proj = (Q - c) @ ax
    tipT = c + ax * proj.max()
    tipT[1] = Q[proj > proj.max() - 0.012, 1].mean()
    baseT = c + ax * proj.min()
    # CMC — глубже в ладонь, к запястью
    cmc = np.array([baseT[0] - thumbSign * 0.018, baseT[1] - 0.004, baseT[2] + 0.012])
    mcpT = baseT + (tipT - baseT) * 0.12
    ipT = baseT + (tipT - baseT) * 0.58
    tpts = [cmc, mcpT, ipT, tipT]
    parent = 0
    for j in range(3):
        bones.append({'name': f'thumb{j}', 'parent': parent, 'pos': tpts[j].tolist()})
        parent = len(bones) - 1
    chains.append((tpts, len(bones) - 3, thumb))
    print(side, 'bones', len(bones))

    # ── веса: по параметру вдоль ближайшей цепочки с мягкими переходами в суставах
    n = len(P)
    W = np.zeros((n, len(bones)))
    dists = []; params = []
    for pts, b0, comp in chains:
        a, tip = pts[0], pts[3]
        dd, t = seg_dist(P, a, tip)
        dists.append(dd)
        Lc = np.linalg.norm(tip - a)
        params.append((t * Lc, Lc, [np.linalg.norm(pts[k] - a) for k in range(4)]))
    dists = np.array(dists)  # (5, n)
    nearest = dists.argmin(0)
    for ci, (pts, b0, comp) in enumerate(chains):
        sc, Lc, js = params[ci]
        sel = nearest == ci
        # вершины перед основанием пальца: проекция до начала → ладонь
        a = pts[0]; dirv = (pts[3] - a) / Lc
        sraw = (P - a) @ dirv
        r = 0.012 if ci < 4 else 0.016
        blend = 0.006
        lateral = dists[ci]
        inFinger = sel & (lateral < r * 2.2)
        wRoot = 1 - smooth(-0.012, 0.006, sraw)
        w1 = smooth(js[1] - blend, js[1] + blend, sraw)
        w2 = smooth(js[2] - blend, js[2] + blend, sraw)
        b_0 = (1 - wRoot) * (1 - w1)
        b_1 = (1 - wRoot) * w1 * (1 - w2)
        b_2 = (1 - wRoot) * w1 * w2
        for v_ in np.where(inFinger)[0]:
            W[v_, 0] += wRoot[v_]; W[v_, b0] += b_0[v_]; W[v_, b0 + 1] += b_1[v_]; W[v_, b0 + 2] += b_2[v_]
    # всё, что не досталось пальцам — запястье/ладонь
    empty = W.sum(1) < 1e-6
    W[empty, 0] = 1
    # компоненты пальцев целиком принадлежат своим цепочкам (без «утечек» в соседний)
    W /= W.sum(1, keepdims=True)
    # топ-4 влияния
    order = np.argsort(-W, 1)[:, :4]
    wt = np.take_along_axis(W, order, 1)
    wt /= wt.sum(1, keepdims=True)
    # нормали
    N = np.zeros_like(P)
    tri = P[I]; fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    for k in range(3): np.add.at(N, I[:, k], fn)
    N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
    # проверка обхода: нормали тыла должны смотреть в +Y
    back = P[:, 1] > np.percentile(P[:, 1], 90)
    if N[back, 1].mean() < 0:
        I = I[:, [0, 2, 1]]; N = -N
        print(side, 'winding flipped')
    out[side] = dict(P=P.astype(np.float32), N=N.astype(np.float32), UV=UV.astype(np.float32),
                     I=I.astype(np.uint16 if n < 65536 else np.uint32),
                     SI=order.astype(np.uint8), SW=(wt * 255).round().astype(np.uint8), bones=bones)

# ── запись: [u32 len][json][буферы по порядку], всё выровнено по 4
blobs = []; header = {'hands': {}}
off = 0
def add(arr):
    global off
    b = arr.tobytes(); pad = (-len(b)) % 4
    blobs.append(b + b'\0' * pad)
    o = off; off += len(b) + pad; return o
for side, h in out.items():
    header['hands'][side] = {
        'count': len(h['P']), 'index': len(h['I']) * 3, 'indexType': str(h['I'].dtype),
        'bones': h['bones'],
        'offsets': {k: add(h[k]) for k in ('P', 'N', 'UV', 'I', 'SI', 'SW')},
    }
js = json.dumps(header).encode(); js += b' ' * ((-len(js)) % 4)
with open(sys.argv[1], 'wb') as f:
    f.write(struct.pack('<I', len(js))); f.write(js)
    for b in blobs: f.write(b)
print('written', sys.argv[1], round((4 + len(js) + off) / 1024), 'KB')
