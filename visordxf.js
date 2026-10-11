/* ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
   PANELL · VISOR DXF · v1.0 (11/10/2026) · apps/comu/visordxf/visordxf.js
   Visor de DXF propi, sense dependències ni internet. El fan servir la Biblioteca Mòbil (miniatures i visor) i el pot fer
   servir qualsevol app del PANELL.
     VisorDXF.llegeix(ArrayBuffer|string)  → model (o llança Error amb un missatge en català)
     VisorDXF.miniatura(model, mida, fosc) → <canvas> amb el dibuix sencer
     VisorDXF.munta(contenidor, model, {fosc}) → visor interactiu (1 dit / ratolí: moure · 2 dits / roda: zoom ·
                                               doble toc: tot) amb botons ⤢ tot · ◐ fons · ☰ capes. Retorna { destrueix() }.
   Llegeix: LINE, LWPOLYLINE i POLYLINE (amb arcs/bulge), CIRCLE, ARC, ELLIPSE, SPLINE, TEXT, MTEXT, ATTRIB, INSERT (blocs
   niats, escales, girs, miralls, matrius), DIMENSION (el bloc de la cota o, si no n'hi ha —els DXF R12 del PANELL—, la cota
   es dibuixa amb l'estil de cota), HATCH (sòlids i tramats), SOLID, TRACE, 3DFACE, POINT, LEADER. Capes amb colors (ACI i
   color real), capes apagades/congelades amagades, tipus de línia discontinus aproximats. Només l'espai model.
   DXF R12 i antics: ANSI 1252; R2007 o més nous: UTF-8. El DXF binari no es llegeix (avís).
   ═══════════════════════════════════════════════════════════════════════════════════════════════════════════ */
(function(G){
'use strict';
/* ── colors ACI (AutoCAD) ── */
const ACI=(()=>{ const T=new Array(256).fill('#ffffff');
  const base={1:'#ff0000',2:'#ffff00',3:'#00ff00',4:'#00ffff',5:'#0000ff',6:'#ff00ff',7:'#ffffff',8:'#808080',9:'#c0c0c0'}; Object.assign(T,base);
  const hx=v=>('0'+Math.round(v).toString(16)).slice(-2), V=[255,165,127,76,38];
  for(let i=10;i<250;i++){ const h=((i-10)/10|0)*15, j=(i-10)%10, v=V[j>>1], s=(j&1)?0.5:1;
    const f=n=>{ const k=(n+h/60)%6; return v-v*s*Math.max(0,Math.min(k,4-k,1)); }; T[i]='#'+hx(f(5))+hx(f(3))+hx(f(1)); }
  ['#333333','#505050','#696969','#828282','#bebebe','#ffffff'].forEach((c,k)=>T[250+k]=c); T[0]='#ffffff'; return T; })();
const rgbInt=n=>'#'+('00000'+(n&0xffffff).toString(16)).slice(-6);

/* ── text: codis especials ── */
function netejaText(s){ return String(s||'').replace(/%%[cC]/g,'Ø').replace(/%%[dD]/g,'°').replace(/%%[pP]/g,'±').replace(/%%%/g,'%').replace(/%%[uUoOkK]/g,'')
  .replace(/\\U\+([0-9a-fA-F]{4})/g,(m,h)=>String.fromCharCode(parseInt(h,16))).replace(/\\M\+[0-9a-fA-F]{5}/g,'?'); }
function netejaMText(s){ s=String(s||'');
  s=s.replace(/\\P/g,'\n').replace(/\\~/g,' ').replace(/\\S([^;]*?)[\^#\/]([^;]*?);/g,'$1/$2')
     .replace(/\\[ACcFfHhQqTtWwp][^;]*;/g,'').replace(/\\[LlOoKkNX]/g,'').replace(/\\\\/g,'\u0001').replace(/[{}]/g,'').replace(/\u0001/g,'\\');
  return netejaText(s); }

/* ── geometria ── */
const I=[1,0,0,1,0,0];
const mul=(A,B)=>[A[0]*B[0]+A[2]*B[1], A[1]*B[0]+A[3]*B[1], A[0]*B[2]+A[2]*B[3], A[1]*B[2]+A[3]*B[3], A[0]*B[4]+A[2]*B[5]+A[4], A[1]*B[4]+A[3]*B[5]+A[5]];
const tr=(x,y)=>[1,0,0,1,x,y], rot=a=>[Math.cos(a),Math.sin(a),-Math.sin(a),Math.cos(a),0,0], esc=(sx,sy)=>[sx,0,0,sy,0,0], MIR=[-1,0,0,1,0,0];
const ap=(M,x,y)=>[M[0]*x+M[2]*y+M[4], M[1]*x+M[3]*y+M[5]];
function arcPts(cx,cy,r,a0,a1,out){ /* radians, antihorari de a0 a a1 */ let sw=a1-a0; while(sw<=0) sw+=Math.PI*2; if(sw>Math.PI*2+1e-9) sw=Math.PI*2;
  const n=Math.max(4,Math.min(144,Math.ceil(sw/(Math.PI*2)*96))); for(let i=0;i<=n;i++){ const a=a0+sw*i/n; out.push(cx+r*Math.cos(a), cy+r*Math.sin(a)); } return out; }
function bulgePts(x1,y1,x2,y2,b,out){ /* afegeix els punts interiors i el final */
  if(!b || Math.abs(b)<1e-9){ out.push(x2,y2); return; }
  const th=4*Math.atan(b), dx=x2-x1, dy=y2-y1, c=Math.hypot(dx,dy); if(c<1e-12){ out.push(x2,y2); return; }
  const r=c/(2*Math.sin(th/2)), mx=(x1+x2)/2, my=(y1+y2)/2, h=r*Math.cos(th/2), nx=-dy/c, ny=dx/c, cx=mx+nx*h, cy=my+ny*h;
  const a0=Math.atan2(y1-cy,x1-cx), n=Math.max(2,Math.min(96,Math.ceil(Math.abs(th)/(Math.PI*2)*96)));
  for(let i=1;i<=n;i++){ const a=a0+th*i/n; out.push(cx+Math.abs(r)*Math.cos(a), cy+Math.abs(r)*Math.sin(a)); } }
function splinePts(deg,K,P,W){ /* de Boor; P=[[x,y]…] */
  const n=P.length; if(n<2) return []; if(!K || K.length!==n+deg+1){ const o=[]; P.forEach(p=>o.push(p[0],p[1])); return o; }
  const t0=K[deg], t1=K[n], N=Math.max(24,n*10), out=[];
  for(let s=0;s<=N;s++){ let t=t0+(t1-t0)*s/N; if(s===N) t=t1-1e-10;
    let k=deg; while(k<n-1 && t>=K[k+1]) k++;
    const d=[]; for(let j=0;j<=deg;j++){ const p=P[k-deg+j], w=W?W[k-deg+j]:1; d.push([p[0]*w,p[1]*w,w]); }
    for(let r=1;r<=deg;r++) for(let j=deg;j>=r;j--){ const i=k-deg+j, den=K[i+deg-r+1]-K[i], al=den?(t-K[i])/den:0; for(let q=0;q<3;q++) d[j][q]=(1-al)*d[j-1][q]+al*d[j][q]; }
    out.push(d[deg][0]/d[deg][2], d[deg][1]/d[deg][2]); }
  return out; }

/* ── lectura de parells codi/valor ── */
function textDe(ent){
  if(typeof ent==='string') return ent;
  const u=new Uint8Array(ent);
  if(u.length>20 && String.fromCharCode.apply(null,u.subarray(0,18))==='AutoCAD Binary DXF') throw new Error('És un DXF binari: aquest visor només llegeix DXF de text (desa\'l com a DXF ASCII).');
  const cap=new TextDecoder('latin1').decode(u.subarray(0,Math.min(u.length,4000))), m=/\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*AC(\d{4})/.exec(cap);
  const ver=m?+m[1]:1009; try{ return new TextDecoder(ver>=1021?'utf-8':'windows-1252').decode(u); }catch(e){ return new TextDecoder('latin1').decode(u); } }
function parells(txt){ const L=txt.split(/\r\n|\r|\n/), P=[]; for(let i=0;i+1<L.length;i+=2){ const c=parseInt(L[i],10); if(isNaN(c)) { i--; continue; } P.push([c, L[i+1]]); } return P; }

/* ── model ── */
function llegeix(ent){
  const P=parells(textDe(ent)); if(P.length<4) throw new Error('El fitxer no sembla un DXF.');
  const capes={}, estils={}, blocs={}, ents=[], hdr={}; let i=0;
  const seccio=()=>{ while(i<P.length && !(P[i][0]===0 && P[i][1].trim()==='SECTION')) i++; i++; return (i<P.length && P[i][0]===2) ? P[i++][1].trim() : null; };
  const llegeixEnts=(fi)=>{ /* fins a ENDSEC / ENDBLK; retorna entitats [{t, g:[[c,v]…]}] */
    const out=[]; while(i<P.length){ const [c,v]=P[i]; if(c!==0){ i++; continue; } const t=v.trim(); if(t==='ENDSEC'||t===fi) break;
      i++; const g=[]; while(i<P.length && P[i][0]!==0){ g.push(P[i]); i++; } out.push({ t, g }); } return out; };
  let s; while(i<P.length && (s=seccio())){
    if(s==='HEADER'){ while(i<P.length && !(P[i][0]===0 && P[i][1].trim()==='ENDSEC')){ if(P[i][0]===9){ const k=P[i][1].trim(); i++; if(i<P.length && P[i][0]!==9 && P[i][0]!==0) hdr[k]=P[i][1].trim(); } i++; } }
    else if(s==='TABLES'){ const E=llegeixEnts('ENDSEC_'); E.forEach(e=>{ const gv=c=>{ const x=e.g.find(p=>p[0]===c); return x?x[1].trim():null; };
        if(e.t==='LAYER'){ const n=gv(2); if(n==null) return; const col=+(gv(62)||7), fl=+(gv(70)||0), tc=gv(420); capes[n]={ col:Math.abs(col)||7, tc:tc!=null?rgbInt(+tc):null, on:col>=0 && !(fl&1), lt:(gv(6)||'').toUpperCase() }; }
        if(e.t==='DIMSTYLE'){ const n=gv(2); if(n==null) return; const num=(c,d)=>{ const v=gv(c); return v==null||v===''?d:+v; };
          estils[n]={ asz:num(41,2.5), exo:num(42,0.625), exe:num(44,1.25), txt:num(140,2.5), gap:num(147,0.625), lfac:num(144,1), dec:num(271,4), zin:num(78,0), tad:num(77,0), sc:num(40,1)||1 }; } }); }
    else if(s==='BLOCKS'){ while(i<P.length){ const [c,v]=P[i]; if(c===0 && v.trim()==='ENDSEC') break; if(c===0 && v.trim()==='BLOCK'){ i++; const g=[]; while(i<P.length && P[i][0]!==0){ g.push(P[i]); i++; }
          const nm=(g.find(p=>p[0]===2)||g.find(p=>p[0]===3)||[0,''])[1].trim(), bx=+((g.find(p=>p[0]===10)||[0,0])[1]), by=+((g.find(p=>p[0]===20)||[0,0])[1]);
          const E=llegeixEnts('ENDBLK'); blocs[nm]={ x:bx, y:by, E }; } else i++; } }
    else if(s==='ENTITIES'){ llegeixEnts('ENDSEC_').forEach(e=>ents.push(e)); }
    while(i<P.length && !(P[i][0]===0 && P[i][1].trim()==='ENDSEC')) i++; }
  const M={ capes, estils, blocs, hdr, ver:(hdr.$ACADVER||'AC1009'), unitats:+(hdr.$INSUNITS||0), linies:[], omplerts:[], textos:[], n:0, avisos:new Set() };
  converteix(M, agrupa(ents), I, null, null, 0);
  /* límits */
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity; const bb=(x,y)=>{ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; };
  M.linies.forEach(l=>{ const p=l.p; for(let k=0;k<p.length;k+=2) bb(p[k],p[k+1]); }); M.omplerts.forEach(l=>{ const p=l.p; for(let k=0;k<p.length;k+=2) bb(p[k],p[k+1]); });
  M.textos.forEach(t=>bb(t.x,t.y));
  if(!isFinite(x0)) throw new Error('El DXF no té res dibuixat a l\'espai model.');
  M.caixa=[x0,y0,x1,y1];
  /* capes usades (amb entitats) */
  const us={}; [M.linies,M.omplerts,M.textos].forEach(A=>A.forEach(e=>{ us[e.cap]=(us[e.cap]||0)+1; })); M.usades=us;
  M.visibles=new Set(Object.keys(us).filter(n=>!capes[n] || capes[n].on));
  M.grups=null; return M; }

/* agrupa POLYLINE+VERTEX+SEQEND i INSERT+ATTRIB+SEQEND */
function agrupa(E){ const out=[]; for(let k=0;k<E.length;k++){ const e=E[k];
  if(e.t==='POLYLINE'){ e.v=[]; while(k+1<E.length && E[k+1].t==='VERTEX'){ e.v.push(E[++k]); } if(k+1<E.length && E[k+1].t==='SEQEND') k++; out.push(e); }
  else if(e.t==='INSERT'){ e.at=[]; const te=e.g.find(p=>p[0]===66); if(te && +te[1]===1){ while(k+1<E.length && E[k+1].t==='ATTRIB') e.at.push(E[++k]); if(k+1<E.length && E[k+1].t==='SEQEND') k++; } out.push(e); }
  else if(e.t==='VERTEX'||e.t==='SEQEND'||e.t==='ATTDEF') continue;
  else out.push(e); } return out; }

function converteix(M, E, T, capPare, colPare, prof){
  if(prof>12) return;
  for(const e of E){ try{ entitat(M, e, T, capPare, colPare, prof); }catch(err){ M.avisos.add(e.t); } } }

function entitat(M, e, T, capPare, colPare, prof){
  const g=e.g, v1=(c,d)=>{ for(const p of g) if(p[0]===c) return p[1]; return d; }, n1=(c,d)=>{ const x=v1(c,null); if(x==null||x.trim()==='') return d; const f=parseFloat(x); return isNaN(f)?d:f; };
  if(n1(67,0)===1) return;                                     /* espai paper */
  let cap=(v1(8,'0')||'0').trim(); if(cap==='0' && capPare!=null) cap=capPare;
  /* color: 256/absent = per capa · 0 = per bloc · 420 = color real */
  let col; const tc=v1(420,null), ci=n1(62,256);
  if(tc!=null) col=rgbInt(+tc); else if(ci===0) col=colPare||'#ffffff'; else if(ci===256||ci<0){ const L=M.capes[cap]; col=L?(L.tc||ACI[L.col]||'#ffffff'):'#ffffff'; } else col=ACI[ci]||'#ffffff';
  const ltN=(v1(6,'')||'').toUpperCase(), lt=(ltN && ltN!=='BYLAYER' && ltN!=='BYBLOCK')?ltN:((M.capes[cap]||{}).lt||''), dash=/DASH|HIDDEN|TRAZ|DISCONT|PHANTOM|BORDER/.test(lt)?1:/CENTER|EJE|DOT|DIVIDE|PUNT/.test(lt)?2:0;
  const ocsMir=n1(230,1)<0, TO=ocsMir?mul(T,MIR):T;             /* extrusió (0,0,-1): mirall en X */
  const linia=(pts,M2,tancat)=>{ const o=new Array(pts.length); for(let k=0;k<pts.length;k+=2){ const q=ap(M2,pts[k],pts[k+1]); o[k]=q[0]; o[k+1]=q[1]; } if(tancat && o.length>=4) o.push(o[0],o[1]); if(o.length>=4){ M.linies.push({ p:o, col, cap, dash }); M.n++; } };
  const omple=(pts,M2,alfa)=>{ const o=[]; for(let k=0;k<pts.length;k+=2){ const q=ap(M2,pts[k],pts[k+1]); o.push(q[0],q[1]); } if(o.length>=6){ M.omplerts.push({ p:o, col, cap, a:alfa||1 }); M.n++; } };
  const text=(x,y,h,ang,s,ha,va,wf,M2,linies)=>{ if(!s || !h) return; const q=ap(M2,x,y), d=ap(M2,x+Math.cos(ang),y+Math.sin(ang)), u=ap(M2,x-Math.sin(ang),y+Math.cos(ang));
    const a=Math.atan2(d[1]-q[1],d[0]-q[0]), hs=Math.hypot(u[0]-q[0],u[1]-q[1])*h; M.textos.push({ x:q[0], y:q[1], h:hs, a, s, ha, va, wf:wf||1, col, cap, ml:!!linies }); M.n++; };
  switch(e.t){
    case 'LINE': linia([n1(10,0),n1(20,0),n1(11,0),n1(21,0)], T); break;
    case 'POINT': { const q=ap(T,n1(10,0),n1(20,0)); M.linies.push({ p:[q[0],q[1],q[0],q[1]], col, cap, dash:0, punt:1 }); M.n++; break; }
    case 'CIRCLE': linia(arcPts(n1(10,0),n1(20,0),n1(40,0),0,Math.PI*2,[]), TO); break;
    case 'ARC': linia(arcPts(n1(10,0),n1(20,0),n1(40,0),n1(50,0)*Math.PI/180,n1(51,360)*Math.PI/180,[]), TO); break;
    case 'ELLIPSE': { const cx=n1(10,0), cy=n1(20,0), mx=n1(11,1), my=n1(21,0), r=n1(40,1); let t0=n1(41,0), t1=n1(42,Math.PI*2); while(t1<=t0) t1+=Math.PI*2;
      const nx=ocsMir?my:-my, ny=ocsMir?-mx:mx, nn=Math.max(8,Math.min(144,Math.ceil((t1-t0)/(Math.PI*2)*96))), o=[];
      for(let k=0;k<=nn;k++){ const t=t0+(t1-t0)*k/nn; o.push(cx+mx*Math.cos(t)+r*nx*Math.sin(t), cy+my*Math.cos(t)+r*ny*Math.sin(t)); } linia(o, T); break; }
    case 'LWPOLYLINE': { const V=[]; let cur=null; for(const [c,v] of g){ if(c===10){ cur=[+v,0,0]; V.push(cur); } else if(c===20 && cur) cur[1]=+v; else if(c===42 && cur) cur[2]=+v; }
      const tancat=(n1(70,0)&1)===1; if(V.length<2) break; const o=[V[0][0],V[0][1]];
      for(let k=0;k<V.length-1;k++) bulgePts(V[k][0],V[k][1],V[k+1][0],V[k+1][1],V[k][2],o);
      if(tancat) bulgePts(V[V.length-1][0],V[V.length-1][1],V[0][0],V[0][1],V[V.length-1][2],o);
      linia(o, TO); break; }
    case 'POLYLINE': { const fl=n1(70,0); if(fl&64){ M.avisos.add('POLYFACE'); }
      const V=(e.v||[]).filter(x=>{ const f=+(((x.g.find(p=>p[0]===70)||[0,0])[1])); return !(f&128) || (f&64); }).map(x=>{ const gv=c=>{ const q=x.g.find(p=>p[0]===c); return q?+q[1]:0; }; return [gv(10),gv(20),gv(42)]; });
      if(fl&64) break; if(V.length<2) break; const o=[V[0][0],V[0][1]];
      for(let k=0;k<V.length-1;k++) bulgePts(V[k][0],V[k][1],V[k+1][0],V[k+1][1],V[k][2],o);
      if(fl&1) bulgePts(V[V.length-1][0],V[V.length-1][1],V[0][0],V[0][1],V[V.length-1][2],o);
      linia(o, (fl&8)?T:TO); break; }
    case 'SPLINE': { const deg=n1(71,3), K=[], C=[], W=[], F=[]; let cc=null, fc=null;
      for(const [c,v] of g){ if(c===40) K.push(+v); else if(c===41) W.push(+v); else if(c===10){ cc=[+v,0]; C.push(cc); } else if(c===20 && cc) cc[1]=+v; else if(c===11){ fc=[+v,0]; F.push(fc); } else if(c===21 && fc) fc[1]=+v; }
      let o=C.length>=2 ? splinePts(deg,K,C,W.length===C.length?W:null) : []; if(!o.length && F.length>=2){ F.forEach(p=>o.push(p[0],p[1])); }
      linia(o, T, (n1(70,0)&1)===1 && false); break; }
    case 'SOLID': case 'TRACE': case '3DFACE': { const p=[n1(10,0),n1(20,0),n1(11,0),n1(21,0),n1(12,0),n1(22,0),n1(13,n1(12,0)),n1(23,n1(22,0))];
      const M2=e.t==='3DFACE'?T:TO; if(e.t==='3DFACE') linia([p[0],p[1],p[2],p[3],p[4],p[5],p[6],p[7]], M2, true); else omple([p[0],p[1],p[2],p[3],p[6],p[7],p[4],p[5]], M2, 1); break; }
    case 'TEXT': case 'ATTRIB': { if(e.t==='ATTRIB' && (n1(70,0)&1)) break;
      const s=netejaText(v1(1,'')), h=n1(40,1), a=n1(50,0)*Math.PI/180, H=n1(72,0), Vv=n1(e.t==='ATTRIB'?74:73,0), al=(H||Vv)&&H!==3&&H!==5;
      const x=al?n1(11,n1(10,0)):n1(10,0), y=al?n1(21,n1(20,0)):n1(20,0);
      text(x,y,h,a,s, H===1||H===4?'center':H===2?'right':'left', H===4?'middle':Vv===3?'top':Vv===2?'middle':Vv===1?'bottom':'alphabetic', n1(41,1), TO); break; }
    case 'MTEXT': { let s=''; for(const [c,v] of g){ if(c===3) s+=v; } s+=v1(1,''); s=netejaMText(s);
      const at=n1(71,1), h=n1(40,1); let a=n1(50,null); if(a==null){ const dx=n1(11,1), dy=n1(21,0); a=Math.atan2(dy,dx); } else a=a*Math.PI/180;
      const col3=(at-1)%3, fil=((at-1)/3)|0; text(n1(10,0),n1(20,0),h,a,s, col3===0?'left':col3===1?'center':'right', fil===0?'top':fil===1?'middle':'bottom', 1, T, true); break; }
    case 'INSERT': { const nm=(v1(2,'')||'').trim(), B=M.blocs[nm]; const bx=n1(10,0), by=n1(20,0), sx=n1(41,1), sy=n1(42,1), r=n1(50,0)*Math.PI/180;
      const nc=Math.max(1,n1(70,1)|0), nr=Math.max(1,n1(71,1)|0), dc=n1(44,0), dr=n1(45,0);
      if(B){ for(let a=0;a<nr;a++) for(let b=0;b<nc;b++){ const Mi=mul(TO, mul(tr(bx,by), mul(rot(r), mul(tr(b*dc,a*dr), mul(esc(sx,sy), tr(-B.x,-B.y))))));
          if(!B.g) B.g=agrupa(B.E); converteix(M, B.g, Mi, cap, col, prof+1); } }
      (e.at||[]).forEach(at=>entitat(M, at, T, capPare, colPare, prof)); break; }
    case 'DIMENSION': { const nm=(v1(2,'')||'').trim(), B=M.blocs[nm];
      if(B && B.E && B.E.length){ if(!B.g) B.g=agrupa(B.E); converteix(M, B.g, mul(T, tr(-0,-0)), cap, col, prof+1); break; }
      cota(M, e, v1, n1, T, cap, col); break; }
    case 'LEADER': { const o=[]; let x=null; for(const [c,v] of g){ if(c===10) x=+v; else if(c===20 && x!=null){ o.push(x,+v); x=null; } } linia(o, T); break; }
    case 'HATCH': hatch(M, g, TO, cap, col); break;
    default: if(!/^(VIEWPORT|IMAGE|WIPEOUT|XLINE|RAY|MLINE|OLE2FRAME|REGION|3DSOLID|BODY|SURFACE|MESH|ACAD_PROXY_ENTITY|ACAD_TABLE|MULTILEADER|LIGHT|SUN|HELIX)$/.test(e.t)) M.avisos.add(e.t);
      else if(e.t!=='VIEWPORT') M.avisos.add(e.t);
  } }

/* cota sense bloc (DXF R12 del PANELL): es dibuixa amb l'estil */
function cota(M, e, v1, n1, T, cap, col){
  const S=M.estils[(v1(3,'')||'').trim()]||M.estils.STANDARD||{ asz:2.5, exo:0.625, exe:1.25, txt:2.5, gap:0.625, lfac:1, dec:4, zin:0 };
  const tipus=n1(70,0)&7, p10=[n1(10,0),n1(20,0)], p11=[n1(11,NaN),n1(21,NaN)], p13=[n1(13,0),n1(23,0)], p14=[n1(14,0),n1(24,0)], p15=[n1(15,0),n1(25,0)];
  const L=(a,b)=>{ M.linies.push({ p:[...ap(T,a[0],a[1]),...ap(T,b[0],b[1])], col, cap, dash:0 }); M.n++; };
  const fletxa=(pt,dx,dy)=>{ const a=S.asz*(S.sc||1); if(!a) return; const nx=-dy, ny=dx, b=[pt[0]+dx*a+nx*a/6, pt[1]+dy*a+ny*a/6], c=[pt[0]+dx*a-nx*a/6, pt[1]+dy*a-ny*a/6];
    M.omplerts.push({ p:[...ap(T,pt[0],pt[1]),...ap(T,b[0],b[1]),...ap(T,c[0],c[1])], col, cap, a:1 }); };
  const fmt=val=>{ let s=(val*(S.lfac||1)).toFixed(Math.max(0,Math.min(8,S.dec|0))); if((S.zin&8) && s.indexOf('.')>=0) s=s.replace(/\.?0+$/,''); return s; };
  const txtCota=(val,pre)=>{ const o=v1(1,''); const m=pre+fmt(val); if(o==null||o===''||o==='<>') return m; return netejaMText(o.replace('<>',m)); };
  const posaText=(s,pt,ang)=>{ let a=ang; while(a>Math.PI/2+1e-6) a-=Math.PI; while(a<=-Math.PI/2+1e-6) a+=Math.PI;
    const q=ap(T,pt[0],pt[1]), d=ap(T,pt[0]+Math.cos(a),pt[1]+Math.sin(a)); M.textos.push({ x:q[0], y:q[1], h:S.txt*(S.sc||1), a:Math.atan2(d[1]-q[1],d[0]-q[0]), s, ha:'center', va:'middle', wf:1, col, cap, ml:true }); M.n++; };
  if(tipus===0 || tipus===1){
    let d; if(tipus===0){ const a=n1(50,0)*Math.PI/180; d=[Math.cos(a),Math.sin(a)]; } else { const dx=p14[0]-p13[0], dy=p14[1]-p13[1], l=Math.hypot(dx,dy)||1; d=[dx/l,dy/l]; }
    const pr=p=>{ const t=(p[0]-p10[0])*d[0]+(p[1]-p10[1])*d[1]; return [p10[0]+d[0]*t, p10[1]+d[1]*t]; };
    const q1=pr(p13), q2=pr(p14), len=Math.hypot(q2[0]-q1[0],q2[1]-q1[1]);
    [[p13,q1],[p14,q2]].forEach(([p,q])=>{ const vx=q[0]-p[0], vy=q[1]-p[1], l=Math.hypot(vx,vy); if(l<1e-9) return; const ux=vx/l, uy=vy/l, e0=Math.min(S.exo*(S.sc||1),l);
      L([p[0]+ux*e0,p[1]+uy*e0],[q[0]+ux*S.exe*(S.sc||1),q[1]+uy*S.exe*(S.sc||1)]); });
    L(q1,q2); if(len>1e-9){ const ux=(q2[0]-q1[0])/len, uy=(q2[1]-q1[1])/len; fletxa(q1,ux,uy); fletxa(q2,-ux,-uy); }
    let tp=isFinite(p11[0])?p11:[(q1[0]+q2[0])/2,(q1[1]+q2[1])/2]; posaText(txtCota(len,''), tp, Math.atan2(d[1],d[0])); return; }
  if(tipus===3 || tipus===4){ const r=Math.hypot(p15[0]-p10[0],p15[1]-p10[1]); L(p10,p15); const tp=isFinite(p11[0])?p11:p15; posaText(txtCota(tipus===3?r:r, tipus===3?'Ø':'R'), tp, 0); return; }
  if(tipus===6){ L(p13,p14); posaText(txtCota(0,''), isFinite(p11[0])?p11:p14, 0); return; }
  if(isFinite(p11[0])){ const o=v1(1,''); if(o && o!=='<>') posaText(netejaMText(o), p11, 0); }
}

/* HATCH: contorns (polilínia o arestes); sòlid → omplert; tramat → omplert suau */
function hatch(M, g, T, cap, col){
  let k=0; const n=()=>g[k]; const solid=+(((g.find(p=>p[0]===70)||[0,0])[1]))===1;
  while(k<g.length && g[k][0]!==91) k++; if(k>=g.length) return; const np=+g[k][1]; k++;
  const camins=[];
  const num=c=>{ while(k<g.length && g[k][0]!==c) k++; return k<g.length ? +g[k++][1] : 0; };
  for(let pth=0; pth<np && k<g.length; pth++){
    const fl=num(92), o=[];
    if(fl&2){ const hb=num(72), tanc=num(73), nv=num(93), V=[]; for(let j=0;j<nv;j++){ const x=num(10), y=num(20); let b=0; if(hb && k<g.length && g[k][0]===42){ b=+g[k][1]; k++; } V.push([x,y,b]); }
      if(V.length){ o.push(V[0][0],V[0][1]); for(let j=0;j<V.length;j++){ const a=V[j], b=V[(j+1)%V.length]; if(j===V.length-1 && !tanc && false) break; bulgePts(a[0],a[1],b[0],b[1],a[2],o); } } }
    else { const ne=num(93); for(let j=0;j<ne;j++){ const et=num(72);
        if(et===1){ const x1=num(10),y1=num(20),x2=num(11),y2=num(21); if(!o.length) o.push(x1,y1); else o.push(x1,y1); o.push(x2,y2); }
        else if(et===2){ const cx=num(10),cy=num(20),r=num(40); let a0=num(50)*Math.PI/180, a1=num(51)*Math.PI/180; const ccw=num(73);
          const t=[]; if(ccw) arcPts(cx,cy,r,a0,a1,t); else { arcPts(cx,cy,r,-a0,-a1,[]); const tmp=[]; arcPts(cx,cy,r,-a1,-a0,tmp); for(let q=tmp.length-2;q>=0;q-=2) t.push(tmp[q],tmp[q+1]); } for(let q=0;q<t.length;q++) o.push(t[q]); }
        else if(et===3){ const cx=num(10),cy=num(20),mx=num(11),my=num(21),r=num(40); let a0=num(50)*Math.PI/180, a1=num(51)*Math.PI/180; const ccw=num(73);
          if(!ccw){ const t0=-a1, t1=-a0; a0=t0; a1=t1; } while(a1<=a0) a1+=Math.PI*2; const pts=[]; for(let q=0;q<=48;q++){ const t=a0+(a1-a0)*q/48; pts.push(cx+mx*Math.cos(t)-r*my*Math.sin(t), cy+my*Math.cos(t)+r*mx*Math.sin(t)); }
          if(!ccw){ for(let q=pts.length-2;q>=0;q-=2) o.push(pts[q],pts[q+1]); } else pts.forEach(v=>o.push(v)); }
        else if(et===4){ const deg=num(94); num(73); num(74); const nk=num(95), nc=num(96), K=[], C=[]; for(let q=0;q<nk;q++) K.push(num(40)); for(let q=0;q<nc;q++){ C.push([num(10),num(20)]); if(k<g.length && g[k][0]===42) k++; }
          splinePts(deg,K,C,null).forEach(v=>o.push(v)); }
      } }
    while(k<g.length && g[k][0]!==97 && g[k][0]!==92 && g[k][0]!==75) k++; if(k<g.length && g[k][0]===97){ const ns=+g[k][1]; k++; for(let q=0;q<ns && k<g.length && g[k][0]===330;q++) k++; }
    if(o.length>=6) camins.push(o); }
  if(!camins.length) return;
  const tot=[]; camins.forEach(c=>{ const q=[]; for(let j=0;j<c.length;j+=2){ const p=ap(T,c[j],c[j+1]); q.push(p[0],p[1]); } tot.push(q); });
  M.omplerts.push({ p:tot[0], forats:tot.slice(1), col, cap, a:solid?1:0.22 }); M.n++; }

/* ── dibuix ── */
function lum(h){ const r=parseInt(h.slice(1,3),16)/255, g=parseInt(h.slice(3,5),16)/255, b=parseInt(h.slice(5,7),16)/255; return 0.2126*r+0.7152*g+0.0722*b; }
function adapta(h, fosc){ const l=lum(h); if(!fosc && l>0.72){ const f=l>0.95?0:0.5; return '#'+[1,3,5].map(i=>('0'+Math.round(parseInt(h.slice(i,i+2),16)*f).toString(16)).slice(-2)).join(''); }
  if(fosc && l<0.3){ const f=0.55; return '#'+[1,3,5].map(i=>('0'+Math.round(parseInt(h.slice(i,i+2),16)*(1-f)+255*f).toString(16)).slice(-2)).join(''); } return h; }
function grups(M){ if(M.grups) return M.grups; const G={};
  M.linies.forEach(l=>{ const k='L|'+l.cap+'|'+l.col+'|'+l.dash; (G[k]||(G[k]={ t:'L', cap:l.cap, col:l.col, dash:l.dash, P:new Path2D(), punts:[] })); const P=G[k].P, p=l.p;
    if(l.punt){ G[k].punts.push(p[0],p[1]); return; } P.moveTo(p[0],p[1]); for(let j=2;j<p.length;j+=2) P.lineTo(p[j],p[j+1]); });
  M.omplerts.forEach(f=>{ const k='F|'+f.cap+'|'+f.col+'|'+f.a; (G[k]||(G[k]={ t:'F', cap:f.cap, col:f.col, a:f.a, P:new Path2D() })); const P=G[k].P;
    [f.p].concat(f.forats||[]).forEach(p=>{ P.moveTo(p[0],p[1]); for(let j=2;j<p.length;j+=2) P.lineTo(p[j],p[j+1]); P.closePath(); }); });
  M.grups=Object.values(G); return M.grups; }
function dibuixa(ctx, W, H, dpr, V, M, fosc){
  ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle=fosc?'#1e2228':'#ffffff'; ctx.fillRect(0,0,W*dpr,H*dpr);
  const s=V.s; ctx.setTransform(dpr*s,0,0,-dpr*s, dpr*(W/2-V.cx*s), dpr*(H/2+V.cy*s));
  const GG=grups(M), lw=1/s;
  GG.forEach(g=>{ if(!M.visibles.has(g.cap)) return; const c=adapta(g.col,fosc);
    if(g.t==='F'){ ctx.globalAlpha=g.a; ctx.fillStyle=c; ctx.fill(g.P,'evenodd'); ctx.globalAlpha=1; return; }
    ctx.strokeStyle=c; ctx.lineWidth=lw; ctx.setLineDash(g.dash===1?[6*lw,4*lw]:g.dash===2?[14*lw,3*lw,2*lw,3*lw]:[]); ctx.stroke(g.P);
    if(g.punts.length){ ctx.fillStyle=c; for(let j=0;j<g.punts.length;j+=2) ctx.fillRect(g.punts[j]-1.5*lw,g.punts[j+1]-1.5*lw,3*lw,3*lw); } });
  ctx.setLineDash([]);
  /* textos en coordenades de pantalla (mida mínima: no es dibuixen si fan menys de 2 px) */
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.textAlign='left';
  for(const t of M.textos){ if(!M.visibles.has(t.cap)) continue; const hp=t.h*s; if(hp<2) continue;
    const sx=(t.x-V.cx)*s+W/2, sy=H/2-(t.y-V.cy)*s; if(sx<-W || sx>2*W || sy<-H || sy>2*H) continue;
    ctx.save(); ctx.translate(sx,sy); ctx.rotate(-t.a); if(t.wf!==1) ctx.scale(t.wf,1);
    ctx.fillStyle=adapta(t.col,fosc); ctx.font=hp.toFixed(1)+'px Arial, Helvetica, sans-serif'; ctx.textAlign=t.ha;
    const L=t.ml?t.s.split('\n'):[t.s], lh=hp*1.6, tot=(L.length-1)*lh;
    let y0; if(t.va==='top'){ ctx.textBaseline='top'; y0=0; } else if(t.va==='middle'){ ctx.textBaseline='middle'; y0=-tot/2; } else if(t.va==='bottom'){ ctx.textBaseline='bottom'; y0=-tot; } else { ctx.textBaseline='alphabetic'; y0=-tot; }
    L.forEach((ln,k)=>ctx.fillText(ln,0,y0+k*lh)); ctx.restore(); } }
function ajusta(M, W, H, marge){ const b=M.caixa, w=Math.max(b[2]-b[0],1e-6), h=Math.max(b[3]-b[1],1e-6); return { s:Math.min((W-2*marge)/w,(H-2*marge)/h), cx:(b[0]+b[2])/2, cy:(b[1]+b[3])/2 }; }
function caixaVisible(M){ /* sense les capes amagades */ let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  const bb=(x,y)=>{ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; };
  M.linies.forEach(l=>{ if(M.visibles.has(l.cap)) for(let k=0;k<l.p.length;k+=2) bb(l.p[k],l.p[k+1]); }); M.omplerts.forEach(l=>{ if(M.visibles.has(l.cap)) for(let k=0;k<l.p.length;k+=2) bb(l.p[k],l.p[k+1]); });
  M.textos.forEach(t=>{ if(M.visibles.has(t.cap)) bb(t.x,t.y); }); return isFinite(x0)?[x0,y0,x1,y1]:M.caixa; }

function miniatura(M, mida, fosc){ const c=document.createElement('canvas'), W=mida||260, H=mida||260; c.width=W; c.height=H;
  const b=M.caixa, r=(b[3]-b[1])/Math.max(b[2]-b[0],1e-6); if(r<1) c.height=Math.max(60,Math.round(W*Math.max(r,0.25))); else c.width=Math.max(60,Math.round(H/Math.min(r,4)));
  const V=ajusta(M, c.width, c.height, 6); dibuixa(c.getContext('2d'), c.width, c.height, 1, V, M, !!fosc); return c; }

const CSS=`.vdxf{position:absolute;inset:0;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}
.vdxf canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.vdxf .bt{position:absolute;right:10px;bottom:10px;display:flex;gap:6px;z-index:2}
.vdxf .bt button{background:#fff;color:#1f3a5f;border:0;border-radius:999px;min-width:42px;height:42px;padding:0 12px;font-size:17px;box-shadow:0 2px 8px rgba(0,0,0,.3)}
.vdxf .info{position:absolute;left:10px;bottom:16px;background:rgba(0,0,0,.55);color:#fff;font:12px -apple-system,Segoe UI,Arial;padding:5px 9px;border-radius:999px;z-index:2;pointer-events:none}
.vdxf .capes{position:absolute;right:10px;bottom:62px;max-height:60%;width:min(280px,80%);overflow:auto;background:#fff;color:#222;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.35);z-index:3;font:14px -apple-system,Segoe UI,Arial;display:none}
.vdxf .capes.obert{display:block} .vdxf .capes .cap{display:flex;gap:6px;padding:8px 10px;position:sticky;top:0;background:#f4f3ee;border-bottom:1px solid #ddd}
.vdxf .capes .cap button{flex:1;border:1px solid #ccd;border-radius:8px;background:#fff;padding:6px;font-size:13px}
.vdxf .capes label{display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid #eee}
.vdxf .capes label i{width:12px;height:12px;border-radius:3px;flex:none;border:1px solid rgba(0,0,0,.25)} .vdxf .capes label span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} .vdxf .capes label small{color:#888}`;
function munta(cont, M, opc){
  opc=opc||{}; if(!document.getElementById('vdxfCSS')){ const st=document.createElement('style'); st.id='vdxfCSS'; st.textContent=CSS; document.head.appendChild(st); }
  const R=document.createElement('div'); R.className='vdxf'; R.innerHTML='<canvas></canvas><div class="info"></div><div class="capes"></div><div class="bt"><button class="tot" title="Veure-ho tot">⤢</button><button class="fons" title="Fons clar / fosc">◐</button><button class="bcap" title="Capes">☰</button></div>';
  cont.appendChild(R); const cv=R.querySelector('canvas'), ctx=cv.getContext('2d'); let fosc=!!opc.fosc, W=0, H=0, dpr=1, V=null, pend=false;
  const pinta=()=>{ if(pend) return; pend=true; requestAnimationFrame(()=>{ pend=false; if(W&&H) dibuixa(ctx,W,H,dpr,V,M,fosc); }); };
  const mida=()=>{ const r=R.getBoundingClientRect(); dpr=Math.min(window.devicePixelRatio||1,2.5); const nw=Math.round(r.width), nh=Math.round(r.height); if(!nw||!nh) return;
    const prim=!W; W=nw; H=nh; cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr); if(prim||!V) V=ajusta(M,W,H,16); pinta(); };
  const tot=()=>{ const b=caixaVisible(M), w=Math.max(b[2]-b[0],1e-6), h=Math.max(b[3]-b[1],1e-6); V={ s:Math.min((W-32)/w,(H-32)/h), cx:(b[0]+b[2])/2, cy:(b[1]+b[3])/2 }; pinta(); };
  const zoomA=(f,px,py)=>{ const wx=V.cx+(px-W/2)/V.s, wy=V.cy-(py-H/2)/V.s; V.s=Math.max(1e-9,Math.min(1e9,V.s*f)); V.cx=wx-(px-W/2)/V.s; V.cy=wy+(py-H/2)/V.s; pinta(); };
  const ro=new ResizeObserver(mida); ro.observe(R); mida();
  /* punter: 1 = moure, 2 = pessic */
  const PT=new Map(); let ult=null, tapT=0, tapP=null;
  const loc=e=>{ const r=cv.getBoundingClientRect(); return [e.clientX-r.left, e.clientY-r.top]; };
  cv.addEventListener('pointerdown',e=>{ cv.setPointerCapture(e.pointerId); PT.set(e.pointerId,loc(e)); ult=null;
    if(PT.size===1){ const t=Date.now(), p=loc(e); if(t-tapT<320 && tapP && Math.hypot(p[0]-tapP[0],p[1]-tapP[1])<30){ tot(); tapT=0; } else { tapT=t; tapP=p; } } });
  cv.addEventListener('pointermove',e=>{ if(!PT.has(e.pointerId)) return; const p=loc(e), q=PT.get(e.pointerId); PT.set(e.pointerId,p);
    if(PT.size===1){ V.cx-=(p[0]-q[0])/V.s; V.cy+=(p[1]-q[1])/V.s; pinta(); }
    else if(PT.size===2){ const [a,b]=[...PT.values()], d=Math.hypot(a[0]-b[0],a[1]-b[1]), m=[(a[0]+b[0])/2,(a[1]+b[1])/2];
      if(ult){ V.cx-=(m[0]-ult.m[0])/V.s; V.cy+=(m[1]-ult.m[1])/V.s; if(ult.d>0) zoomA(d/ult.d, m[0], m[1]); } ult={ d, m }; pinta(); } });
  const fi=e=>{ PT.delete(e.pointerId); ult=null; }; cv.addEventListener('pointerup',fi); cv.addEventListener('pointercancel',fi);
  cv.addEventListener('wheel',e=>{ e.preventDefault(); const p=loc(e); zoomA(Math.pow(1.0015,-e.deltaY), p[0], p[1]); },{ passive:false });
  cv.addEventListener('dblclick',e=>{ e.preventDefault(); tot(); });
  R.querySelector('.tot').onclick=tot; R.querySelector('.fons').onclick=()=>{ fosc=!fosc; if(opc.enCanviFons) opc.enCanviFons(fosc); pinta(); };
  /* capes */
  const PC=R.querySelector('.capes'), noms=Object.keys(M.usades).sort((a,b)=>a.localeCompare(b,'ca',{numeric:true}));
  const capesHTML=()=>{ PC.innerHTML='<div class="cap"><button data-a="1">Totes</button><button data-a="0">Cap</button></div>'+noms.map(n=>{ const L=M.capes[n], c=L?(L.tc||ACI[L.col]):'#888';
      return '<label><input type="checkbox" data-c="'+encodeURIComponent(n)+'"'+(M.visibles.has(n)?' checked':'')+'><i style="background:'+c+'"></i><span>'+n.replace(/[<&]/g,x=>x==='<'?'&lt;':'&amp;')+'</span><small>'+M.usades[n]+'</small></label>'; }).join('');
    PC.querySelectorAll('input').forEach(ch=>ch.onchange=()=>{ const n=decodeURIComponent(ch.dataset.c); if(ch.checked) M.visibles.add(n); else M.visibles.delete(n); pinta(); });
    PC.querySelectorAll('.cap button').forEach(b=>b.onclick=()=>{ if(b.dataset.a==='1') noms.forEach(n=>M.visibles.add(n)); else M.visibles.clear(); capesHTML(); pinta(); }); };
  capesHTML(); R.querySelector('.bcap').onclick=()=>PC.classList.toggle('obert');
  ['pointerdown','touchstart','wheel'].forEach(t=>PC.addEventListener(t,e=>e.stopPropagation(),{ passive:true }));
  const U={0:'',1:'polzades',2:'peus',4:'mm',5:'cm',6:'m'}[M.unitats]||''; R.querySelector('.info').textContent=noms.length+' capes · '+M.n+' elements'+(U?' · '+U:'');
  return { destrueix(){ ro.disconnect(); R.remove(); }, tot, model:M }; }

G.VisorDXF={ llegeix, miniatura, munta, versio:'1.0' };
})(window);
