// --- accent color ---
(function() {
  var h = Math.floor(Math.random() * 361);
  var l = (h > 45 && h < 200) ? 40 : 50, s = 100;
  l /= 100; var a = s * Math.min(l, 1 - l) / 100;
  var f = function(n) {
    var k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1))).toString(16).padStart(2, '0');
  };
  document.documentElement.style.setProperty('--accent', '#' + f(0) + f(8) + f(4));
})();

// --- FLAT FOLD ---
// --- 1. FUNZIONE COMPUTE CORRETTA (Senza auto-inversione) ---
function computeFlatFold(data) {
  var cp = data.vertices_coords, fv = data.faces_vertices,
      ev = data.edges_vertices, ea = data.edges_assignment;
  var nF = fv.length, nV = cp.length;

  var v2f = [];
  for (var i = 0; i < nV; i++) v2f[i] = [];
  fv.forEach(function(f, fi) { f.forEach(function(v) { v2f[v].push(fi); }); });

  var adj = [];
  for (var i = 0; i < nF; i++) adj[i] = [];
  ev.forEach(function(e, ei) {
    if (ea[ei] === 'B') return;
    var shared = v2f[e[0]].filter(function(f) { return v2f[e[1]].indexOf(f) !== -1; });
    if (shared.length === 2) {
      adj[shared[0]].push({ face: shared[1], v0: e[0], v1: e[1], flat: ea[ei] === 'F' });
      adj[shared[1]].push({ face: shared[0], v0: e[0], v1: e[1], flat: ea[ei] === 'F' });
    }
  });

  var T = new Array(nF), visited = new Array(nF).fill(false);
  T[0] = [1,0,0,1,0,0]; visited[0] = true;
  var queue = [0];
  while (queue.length) {
    var cur = queue.shift();
    adj[cur].forEach(function(n) {
      if (visited[n.face]) return;
      visited[n.face] = true;
      if (n.flat) {
        T[n.face] = T[cur].slice();
      } else {
        var p0 = applyT(T[cur], cp[n.v0]), p1 = applyT(T[cur], cp[n.v1]);
        T[n.face] = composeT(reflectT(p0, p1), T[cur]);
      }
      queue.push(n.face);
    });
  }

  var flipped = T.map(function(t) {
    return t ? (t[0]*t[3] - t[1]*t[2]) < 0 : false;
  });

  var vFolded;
  if (data.vertices_coords_folded) {
    vFolded = data.vertices_coords_folded.map(function(v) { return v.slice(); });
  } else {
    vFolded = new Array(nV);
    var vSet = new Array(nV).fill(false);
    fv.forEach(function(f, fi) {
      if (!T[fi]) return;
      f.forEach(function(v) {
        if (!vSet[v]) { vFolded[v] = applyT(T[fi], cp[v]); vSet[v] = true; }
      });
    });
    for (var i = 0; i < nV; i++) if (!vSet[i]) vFolded[i] = cp[i].slice();
  }

  var drawOrder;
  if (data.faces_layer) {
    drawOrder = data.faces_layer.map(function(_, i) { return i; });
    var fl = data.faces_layer;
    drawOrder.sort(function(a, b) { return fl[a] - fl[b]; });
  } else if (data.faceOrders && data.faceOrders.length) {
    drawOrder = topoSortFaceOrders(data.faceOrders, nF);
  } else {
    drawOrder = flipped.map(function(_, i) { return i; });
    drawOrder.sort(function(a, b) { return (flipped[a]?0:1) - (flipped[b]?0:1); });
  }

  // RIMOZIONE BLOCCO DI AUTO-INVERSIONE CHE CAUSAVA IL GRIGIO RANDOM
  return { vFolded: vFolded, flipped: flipped, drawOrder: drawOrder };
}


function topoSortFaceOrders(fo, nF) {
  var graph = new Array(nF), inDeg = new Array(nF).fill(0);
  for (var i = 0; i < nF; i++) graph[i] = [];
  fo.forEach(function(o) {
    var lo, hi;
    if (o[2] === 1) { lo = o[1]; hi = o[0]; }
    else             { lo = o[0]; hi = o[1]; }
    graph[lo].push(hi);
    inDeg[hi]++;
  });
  var queue = [], order = [];
  for (var i = 0; i < nF; i++) { if (inDeg[i] === 0) queue.push(i); }
  while (queue.length) {
    var f = queue.shift();
    order.push(f);
    graph[f].forEach(function(nb) { if (--inDeg[nb] === 0) queue.push(nb); });
  }
  if (order.length < nF) {
    for (var i = 0; i < nF; i++) { if (order.indexOf(i) === -1) order.push(i); }
  }
  return order;
}

function applyT(t, p) { return [t[0]*p[0]+t[1]*p[1]+t[4], t[2]*p[0]+t[3]*p[1]+t[5]]; }
function reflectT(p0, p1) {
  var dx = p1[0]-p0[0], dy = p1[1]-p0[1], l2 = dx*dx+dy*dy;
  if (l2 < 1e-14) return [1,0,0,1,0,0];
  var c = (dx*dx-dy*dy)/l2, s = 2*dx*dy/l2;
  return [c,s,s,-c, p0[0]-c*p0[0]-s*p0[1], p0[1]-s*p0[0]+c*p0[1]];
}
function composeT(a, b) {
  return [a[0]*b[0]+a[1]*b[2], a[0]*b[1]+a[1]*b[3],
          a[2]*b[0]+a[3]*b[2], a[2]*b[1]+a[3]*b[3],
          a[0]*b[4]+a[1]*b[5]+a[4], a[2]*b[4]+a[3]*b[5]+a[5]];
}

// --- HELPERS ---
var NS = 'http://www.w3.org/2000/svg';
function ptsStr(pts) { return pts.map(function(p) { return p[0].toFixed(5)+','+p[1].toFixed(5); }).join(' '); }
function lerp(a,b,t) { return a+(b-a)*t; }
function easeInOut(t) { return t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2; }
function anim(d, tick, raw) {
  return new Promise(function(res) {
    var s = performance.now();
    (function f(now) {
      var r = Math.min((now-s)/d,1);
      tick(raw ? r : easeInOut(r));
      r < 1 ? requestAnimationFrame(f) : res();
    })(performance.now());
  });
}
function waitTransition(el) {
  return new Promise(function(res) {
    var done = false;
    function h() { if (!done) { done = true; el.removeEventListener('transitionend', h); res(); } }
    el.addEventListener('transitionend', h);
    setTimeout(h, 1200);
  });
}
function delay(ms) { return new Promise(function(r) { setTimeout(r,ms); }); }
function rotatePt(p, angle) {
  var cos = Math.cos(angle), sin = Math.sin(angle);
  var dx = p[0] - 0.5, dy = p[1] - 0.5;
  return [dx*cos - dy*sin + 0.5, dx*sin + dy*cos + 0.5];
}

// --- CONFIG ---
var STAGGER = 0.3;
var SPEED = 0.5;
function dur(base) { return base / (0.4 + SPEED * 1.2); }

// --- ORIGAMI INSTANCE ---
function Origami(cell) {
  this.cell = cell;
  this.inner = cell.querySelector('.crane-inner');
  this.svg = cell.querySelector('.crane-svg');
  this.section = cell.dataset.section;
  this.rotation = parseFloat(cell.dataset.rotation) || 0;
  this.rest = parseFloat(cell.dataset.rest) || 0;
  this.foldSrc = cell.dataset.fold;
  this.scale = parseFloat(cell.dataset.scale) || 0.8;
  this.polyEls = [];
  this.vertFolded = null;
  this.vertFlat = null;
  this.facesVerts = null;
  this.ready = false;
}

Origami.prototype.init = async function() {
  var res = await fetch(this.foldSrc);
  var data = await res.json();
  var result = computeFlatFold(data);

  var vFolded = result.vFolded;
  var bx0=Infinity, by0=Infinity, bx1=-Infinity, by1=-Infinity;
  vFolded.forEach(function(p) {
    if (p[0]<bx0) bx0=p[0]; if (p[0]>bx1) bx1=p[0];
    if (p[1]<by0) by0=p[1]; if (p[1]>by1) by1=p[1];
  });
  var cx = (bx0+bx1)/2, cy = (by0+by1)/2;
  var sc = this.scale / Math.max(bx1-bx0, by1-by0);

  this.vertFolded = vFolded.map(function(p) {
    return [(p[0]-cx)*sc+0.5, (p[1]-cy)*sc+0.5];
  });
  this.vertFlat = data.vertices_coords.map(function(c) { return c.slice(); });
  this.facesVerts = data.faces_vertices;

  this.svg.setAttribute('viewBox', '-0.05 -0.05 1.1 1.1');
  var self = this;
  result.drawOrder.forEach(function(fi) {
    var poly = document.createElementNS(NS, 'polygon');
    
    // LOGICA MODIFICATA:
    // result.flipped[fi] ci dice se la faccia è a testa in giù.
    // Se è true (1), usiamo il colore "back" (il retro della carta).
    // Se è false (0), usiamo il colore "front" (il foglio bianco).
    poly.style.fill = result.flipped[fi] ? 'var(--paper-back)' : 'var(--paper)';
    
    self.svg.appendChild(poly);
    self.polyEls.push({ el: poly, fi: fi, back: result.flipped[fi] });
  });

  this.setMorph(this.rest, this.rotation);
  this.cell.classList.add('floating');
  this.ready = true;
};


Origami.prototype.setMorph = function(t, angleDeg) {
  var angle = (angleDeg !== undefined ? angleDeg : 0) * Math.PI / 180;
  var vf = this.vertFolded, vc = this.vertFlat;
  
  var interp = vf.map(function(f, i) {
    return rotatePt(
      [lerp(f[0], vc[i][0], t), lerp(f[1], vc[i][1], t)],
      angle
    );
  });
  
  var fv = this.facesVerts;

  // soglia: quando consideriamo l'origami "chiuso"
  var foldedThreshold = 0.15; 

  this.polyEls.forEach(function(item) {

    item.el.setAttribute(
      'points',
      ptsStr(fv[item.fi].map(function(vi) { return interp[vi]; }))
    );

    // SOLO quando quasi completamente piegato
    if (t < foldedThreshold && item.back) {
      item.el.style.fill = 'var(--paper-back)';
    } else {
      item.el.style.fill = 'var(--paper)';
    }

    item.el.style.fillOpacity = "1";
    item.el.style.strokeOpacity = "1";
  });

};


Origami.prototype.stopFloat = function() {
  var inner = this.inner;
  var ct = getComputedStyle(inner).transform;
  this.cell.classList.remove('floating');
  inner.style.transform = ct;
  inner.offsetHeight;
  inner.style.transition = 'transform 0.35s ease-out';
  inner.style.transform = '';
  return delay(350).then(function() { inner.style.transition = ''; });
};

// --- APP STATE ---
var overlay = document.getElementById('overlay');
var overlayScroll = document.getElementById('overlay-scroll');
var siteTitle = document.querySelector('.site-title');
var animating = false;
var activeOrigami = null;

var cranes = [];
document.querySelectorAll('.crane-cell').forEach(function(cell) {
  var o = new Origami(cell);
  cranes.push(o);
  cell.addEventListener('click', function() {
    if (animating) return;
    openSection(o);
  });
});
Promise.all(cranes.map(function(o) { return o.init(); }));

// --- OPEN / CLOSE ---
async function openSection(o) {
  if (animating || !o.ready) return;
  animating = true;
  activeOrigami = o;
  siteTitle.classList.add('hidden');

  await o.stopFloat();
  cranes.forEach(function(c) { if (c !== o) c.cell.classList.add('dimmed'); });
  o.cell.classList.add('centered');
  await waitTransition(o.cell);

  var rot = o.rotation, rest = o.rest;
  await anim(dur(1800), function(r) {
    var rotT = easeInOut(r);
    var morphR = Math.max(0, (r - STAGGER) / (1 - STAGGER));
    var morphT = easeInOut(morphR);
    o.setMorph(lerp(rest, 1, morphT), lerp(rot, 0, rotT));
  }, true);

  await delay(dur(200));
  loadContent(o.section);
  overlay.classList.add('open');
  animating = false;
}

async function closeSection() {
  if (animating || !activeOrigami) return;
  animating = true;
  var o = activeOrigami;
  overlay.classList.remove('open');
  await delay(dur(500));

  var rot = o.rotation, rest = o.rest;
  await anim(dur(1600), function(r) {
    var morphT = easeInOut(r);
    var rotR = Math.max(0, (r - STAGGER) / (1 - STAGGER));
    var rotT = easeInOut(rotR);
    o.setMorph(lerp(1, rest, morphT), lerp(0, rot, rotT));
  }, true);

  o.polyEls.forEach(function(item) {
    item.el.style.fill = item.back ? 'var(--paper-back)' : 'var(--paper)';
  });

  o.cell.classList.remove('centered');
  cranes.forEach(function(c) { c.cell.classList.remove('dimmed'); });
  await waitTransition(o.cell);

  o.cell.classList.add('floating');
  siteTitle.classList.remove('hidden');
  activeOrigami = null;
  animating = false;
  overlayScroll.innerHTML = '';
}

document.getElementById('overlay-close').addEventListener('click', closeSection);
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeSection();
});

// --- CONTENT ---
function loadContent(section) {
  var tpl = document.querySelector('template[data-section="' + section + '"]');
  overlayScroll.innerHTML = '';
  if (tpl) overlayScroll.appendChild(tpl.content.cloneNode(true));
  overlayScroll.scrollLeft = 0;
}