import numpy as np
d=np.load('/tmp/handraw.npz'); V=d['V'];T=d['T'];F=d['F']
cz=V[F[:,:,0]].mean(1)[:,2]
out={}
for name,mask in (('A',cz<0),('B',cz>0)):
    f=F[mask]  # (n,3,3)
    vi=f[:,:,0].reshape(-1); ti=f[:,:,1].reshape(-1)
    P=np.round(V[vi],6); UV=np.round(T[ti],6)
    key=np.concatenate([P,UV],1)
    uniq,inv=np.unique(key,axis=0,return_inverse=True)
    idx=inv.reshape(-1,3)
    out[name]=dict(P=uniq[:,:3],UV=uniq[:,3:5],I=idx)
    p=uniq[:,:3]
    print(name,'verts',len(uniq),'tris',len(idx),'bounds',p.min(0).round(3),p.max(0).round(3))
np.savez('/tmp/handsplit.npz',**{f'{k}_{n}':v[n] for k,v in out.items() for n in ('P','UV','I')})
# зеркальность: A отражённая по z относительно своего центра против B
A=out['A']['P'];B=out['B']['P']
ca=(A.min(0)+A.max(0))/2; cb=(B.min(0)+B.max(0))/2
from scipy.spatial import cKDTree
Am=A-ca; Bm=B-cb
for label,M in (('same',Am),('mirror z',Am*[1,1,-1]),('rot180 y',Am*[-1,1,-1]),('mirror x',Am*[-1,1,1])):
    dd,_=cKDTree(Bm).query(M); print(label, 'mean dist', dd.mean().round(4))
