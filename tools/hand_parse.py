# Разбор OBJ: индексированная сетка одной кисти + анализ сторон
import numpy as np, sys, json
src = sys.argv[1]
V=[];T=[];N=[];F=[]
for l in open(src):
    if l.startswith('v '): V.append(list(map(float,l.split()[1:4])))
    elif l.startswith('vt '): T.append(list(map(float,l.split()[1:3])))
    elif l.startswith('vn '): N.append(list(map(float,l.split()[1:4])))
    elif l.startswith('f '):
        F.append([tuple(int(x)-1 if x else -1 for x in (p.split('/')+['',''])[:3]) for p in l.split()[1:4]])
V=np.array(V);T=np.array(T);N=np.array(N) if N else None
print('v',len(V),'vt',len(T),'vn',0 if N is None else len(N),'f',len(F))
F=np.array(F)  # (nf,3,3)
# какая копия: по z центроида
cz=V[F[:,:,0]].mean(1)[:,2]
print('faces z<0',(cz<0).sum(),'z>0',(cz>0).sum())
np.savez('/tmp/handraw.npz',V=V,T=T,N=N if N is not None else np.zeros((0,3)),F=F)
