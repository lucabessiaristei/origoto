(function () {
    const NS = 'http://www.w3.org/2000/svg';
    
    // --- ELEMENTI DOM ---
    const dropZone = document.getElementById('dropZone'),
          fileInput = document.getElementById('fileInput'),
          canvasArea = document.getElementById('canvasArea'),
          svgEl = document.getElementById('origamiSvg'),
          facesLayer = document.getElementById('facesLayer'),
          highlightLayer = document.getElementById('highlightLayer'),
          layerList = document.getElementById('layerList'),
          tagsCt = document.getElementById('tags'),
          undoBtn = document.getElementById('undoBtn'),
          redoBtn = document.getElementById('redoBtn'),
          quickOrderBtn = document.getElementById('quickOrderBtn'),
          panBtn = document.getElementById('panBtn');

    // --- STATO APPLICAZIONE ---
    let S = {
        foldData: null,
        fileName: '',
        vFolded: null,
        facesVerts: null,
        flipped: null,
        drawOrder: [], // L'ordine effettivo delle facce (array di indici)
        polyMap: {},
        hiFace: -1,
        selectedFace: -1,
        history: [],
        redoStack: [],
        // Viewport
        view: { x: 0, y: 0, w: 1, h: 1 },
        isPanning: false,
        spacePressed: false,
        lastMouse: { x: 0, y: 0 },
        quickOrderActive: false,
        panModeActive: false
    };

    let dragSrcEl = null;

    // --- CARICAMENTO FILE ---
    document.getElementById('uploadNewBtn').onclick = () => fileInput.click();
    dropZone.onclick = (e) => { if(e.target !== fileInput) fileInput.click(); };
    fileInput.onchange = () => { if (fileInput.files.length) loadFile(fileInput.files[0]); };

    canvasArea.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('drag-active'); };
    canvasArea.ondragleave = (e) => { if (!canvasArea.contains(e.relatedTarget)) dropZone.classList.remove('drag-active'); };
    canvasArea.ondrop = (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-active');
        if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
    };

    function loadFoldData(json, name) {
        S.foldData = json;
        S.fileName = name;
        S.history = []; S.redoStack = []; S.selectedFace = -1;
        S.view = { x: 0, y: 0, w: 1, h: 1 };
        processModel(S.foldData);
        document.getElementById('historyTools').style.display = 'flex';
        document.getElementById('viewControls').style.display = 'flex';
        document.getElementById('sidebar').style.display = 'flex';
        dropZone.classList.add('compact');
    }

    function loadFile(file) {
        const r = new FileReader();
        r.onload = (e) => {
            try { loadFoldData(JSON.parse(e.target.result), file.name); }
            catch (err) { alert("Errore nel file FOLD"); }
        };
        r.readAsText(file);
    }

    document.getElementById('exampleBtn').onclick = () => {
        fetch('media/default.fold')
            .then(r => r.json())
            .then(data => loadFoldData(data, 'default.fold'))
            .catch(() => alert("Could not load example file"));
    };

    // --- VIEWPORT (ZOOM & PAN) ---
    function updateViewBox() {
        svgEl.setAttribute('viewBox', `${S.view.x} ${S.view.y} ${S.view.w} ${S.view.h}`);
    }

    function changeZoom(factor, mx, my) {
        let oldW = S.view.w, oldH = S.view.h;
        S.view.w /= factor; S.view.h /= factor;
        let cx = mx !== undefined ? mx : S.view.x + oldW / 2;
        let cy = my !== undefined ? my : S.view.y + oldH / 2;
        S.view.x = cx - (cx - S.view.x) * (S.view.w / oldW);
        S.view.y = cy - (cy - S.view.y) * (S.view.h / oldH);
        updateViewBox();
    }

    svgEl.onwheel = (e) => {
        e.preventDefault();
        const r = svgEl.getBoundingClientRect();
        const mx = S.view.x + (e.clientX - r.left) * (S.view.w / r.width);
        const my = S.view.y + (e.clientY - r.top) * (S.view.h / r.height);
        changeZoom(e.deltaY > 0 ? 0.9 : 1.1, mx, my);
    };

    svgEl.onmousedown = (e) => {
        if (e.button === 1 || S.spacePressed || S.panModeActive) {
            S.isPanning = true;
            S.lastMouse = { x: e.clientX, y: e.clientY };
            document.body.classList.add('dragging-canvas');
            e.preventDefault();
        }
    };
    window.onmousemove = (e) => {
        if (S.isPanning) {
            let dx = (e.clientX - S.lastMouse.x) * (S.view.w / svgEl.clientWidth);
            let dy = (e.clientY - S.lastMouse.y) * (S.view.h / svgEl.clientHeight);
            S.view.x -= dx; S.view.y -= dy;
            S.lastMouse = { x: e.clientX, y: e.clientY };
            updateViewBox();
        }
    };
    window.onmouseup = () => { S.isPanning = false; document.body.classList.remove('dragging-canvas'); };

    // Shortcut Tastiera
    window.onkeydown = (e) => {
        if (e.code === 'Space') { S.spacePressed = true; document.body.classList.add('space-panning'); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
    };
    window.onkeyup = (e) => { if (e.code === 'Space') { S.spacePressed = false; document.body.classList.remove('space-panning'); } };

    document.getElementById('zoomIn').onclick = () => changeZoom(1.2);
    document.getElementById('zoomOut').onclick = () => changeZoom(0.8);
    document.getElementById('zoomReset').onclick = () => { S.view = { x: 0, y: 0, w: 1, h: 1 }; updateViewBox(); };

    // --- QUICK ORDER TOOL ---
    quickOrderBtn.onclick = () => {
        S.quickOrderActive = !S.quickOrderActive;
        quickOrderBtn.classList.toggle('active', S.quickOrderActive);
        document.body.classList.toggle('quick-order-mode', S.quickOrderActive);
        if (S.quickOrderActive && S.panModeActive) {
            S.panModeActive = false;
            panBtn.classList.remove('active');
            document.body.classList.remove('pan-mode');
        }
    };

    // --- PAN TOOL ---
    panBtn.onclick = () => {
        S.panModeActive = !S.panModeActive;
        panBtn.classList.toggle('active', S.panModeActive);
        document.body.classList.toggle('pan-mode', S.panModeActive);
        if (S.panModeActive && S.quickOrderActive) {
            S.quickOrderActive = false;
            quickOrderBtn.classList.remove('active');
            document.body.classList.remove('quick-order-mode');
        }
    };

    // --- LOGICA GEOMETRICA & REVISIONE ORDINE ---
    function saveState() { S.history.push(JSON.stringify(S.drawOrder)); S.redoStack = []; updateHistoryButtons(); }
    function undo() { if (S.history.length) { S.redoStack.push(JSON.stringify(S.drawOrder)); S.drawOrder = JSON.parse(S.history.pop()); refreshUI(); } }
    function redo() { if (S.redoStack.length) { S.history.push(JSON.stringify(S.drawOrder)); S.drawOrder = JSON.parse(S.redoStack.pop()); refreshUI(); } }
    function updateHistoryButtons() { undoBtn.disabled = !S.history.length; redoBtn.disabled = !S.redoStack.length; }

    function refreshUI() { render(); buildList(); updateHistoryButtons(); updateViewBox(); }

    function processModel(data) {
        const res = computeFold(data);
        const vf = res.vFolded;
        const xs = vf.map(v => v[0]), ys = vf.map(v => v[1]);
        const span = Math.max(Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys)) || 1, pad = 0.05;
        const sc = (1 - 2 * pad) / span;
        const ox = pad - (Math.min(...xs) - (span - (Math.max(...xs)-Math.min(...xs)))/2) * sc;
        const oy = pad - (Math.min(...ys) - (span - (Math.max(...ys)-Math.min(...ys)))/2) * sc;
        
        S.vFolded = vf.map(v => [v[0] * sc + ox, v[1] * sc + oy]);
        S.facesVerts = data.faces_vertices;
        S.flipped = res.flipped;
        S.drawOrder = res.drawOrder;

        tagsCt.innerHTML = `<span class="tag">${S.fileName}</span><span class="tag">${S.drawOrder.length} faces</span>`;
        svgEl.style.display = '';
        svgEl.onclick = (e) => { if (e.target === svgEl) selectFace(-1); };
        refreshUI();
    }

    function computeFold(data) {
        const cp = data.vertices_coords, fv = data.faces_vertices, ev = data.edges_vertices, ea = data.edges_assignment;
        const nF = fv.length, nV = cp.length, v2f = Array.from({length: nV}, () => []), adj = Array.from({length: nF}, () => []);
        fv.forEach((f, fi) => f.forEach(v => v2f[v].push(fi)));
        ev.forEach((e, ei) => {
            if (ea[ei] === 'B') return;
            const sh = v2f[e[0]].filter(f => v2f[e[1]].includes(f));
            if (sh.length === 2) {
                adj[sh[0]].push({ f: sh[1], v0: e[0], v1: e[1], flat: ea[ei] === 'F' });
                adj[sh[1]].push({ f: sh[0], v0: e[0], v1: e[1], flat: ea[ei] === 'F' });
            }
        });
        let T = new Array(nF).fill(null), vis = new Array(nF).fill(false);
        T[0] = [1, 0, 0, 1, 0, 0]; vis[0] = true; let q = [0];
        const applyT = (t, p) => [t[0]*p[0]+t[1]*p[1]+t[4], t[2]*p[0]+t[3]*p[1]+t[5]];
        const composeT = (a, b) => [a[0]*b[0]+a[1]*b[2], a[0]*b[1]+a[1]*b[3], a[2]*b[0]+a[3]*b[2], a[2]*b[1]+a[3]*b[3], a[0]*b[4]+a[1]*b[5]+a[4], a[2]*b[4]+a[3]*b[5]+a[5]];
        const reflectT = (p0, p1) => {
            let dx = p1[0]-p0[0], dy = p1[1]-p0[1], l2 = dx*dx+dy*dy;
            let c = (dx*dx-dy*dy)/l2, s = 2*dx*dy/l2;
            return [c, s, s, -c, p0[0]-c*p0[0]-s*p0[1], p0[1]-s*p0[0]+c*p0[1]];
        };
        while (q.length) {
            let cur = q.shift();
            adj[cur].forEach(nb => {
                if (vis[nb.f]) return; vis[nb.f] = true;
                T[nb.f] = nb.flat ? [...T[cur]] : composeT(reflectT(applyT(T[cur], cp[nb.v0]), applyT(T[cur], cp[nb.v1])), T[cur]);
                q.push(nb.f);
            });
        }
        const flipped = T.map(t => t ? (t[0]*t[3]-t[1]*t[2]) < 0 : false);
        let vFolded = data.vertices_coords_folded ? data.vertices_coords_folded.map(v => [...v]) : new Array(nV);
        if (!data.vertices_coords_folded) fv.forEach((f, fi) => { if (T[fi]) f.forEach(v => vFolded[v] = applyT(T[fi], cp[v])); });
        const order = data.faces_layer ? fv.map((_, i) => i).sort((a,b) => data.faces_layer[a] - data.faces_layer[b]) : fv.map((_, i) => i).sort((a,b) => (flipped[a]?0:1) - (flipped[b]?0:1));
        return { vFolded, flipped, drawOrder: order };
    }

    // --- RENDERING ---
    function render() {
        facesLayer.innerHTML = ''; S.polyMap = {};
        S.drawOrder.forEach(fi => {
            const poly = document.createElementNS(NS, 'polygon');
            poly.setAttribute('points', S.facesVerts[fi].map(vi => S.vFolded[vi].join(',')).join(' '));
            poly.setAttribute('fill', S.flipped[fi] ? 'var(--paper-back)' : 'var(--paper)');
            
            // Logica di Interazione
            poly.onclick = (e) => {
                if (S.isPanning || S.spacePressed) return;
                e.stopPropagation();
                if (S.quickOrderActive) {
                    saveState();
                    const idx = S.drawOrder.indexOf(fi);
                    if (e.altKey) S.drawOrder.push(S.drawOrder.splice(idx, 1)[0]); // In cima
                    else S.drawOrder.unshift(S.drawOrder.splice(idx, 1)[0]); // In fondo
                    refreshUI();
                } else {
                    selectFace(fi);
                }
            };
            poly.oncontextmenu = (e) => { e.preventDefault(); selectFace(fi); };
            poly.onmouseenter = () => highlightFace(fi);
            poly.onmouseleave = () => highlightFace(-1);
            
            facesLayer.appendChild(poly);
            S.polyMap[fi] = poly;
        });
        renderHighlights();
    }

    function selectFace(fi) {
        S.selectedFace = fi;
        renderHighlights();
        layerList.querySelectorAll('.layer-item').forEach(el => {
            const isSel = parseInt(el.dataset.fi) === fi;
            el.classList.toggle('selected', isSel);
            if (isSel) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    }

    function highlightFace(fi) {
        S.hiFace = fi;
        renderHighlights();
        layerList.querySelectorAll('.layer-item').forEach(el => el.classList.toggle('highlighted', parseInt(el.dataset.fi) === fi));
    }

    function renderHighlights() {
        highlightLayer.innerHTML = '';
        [S.selectedFace, S.hiFace].forEach((fi, i) => {
            if (fi !== -1 && S.polyMap[fi]) {
                const clone = S.polyMap[fi].cloneNode(true);
                clone.classList.add('hi-clone');
                if (i === 0) clone.style.stroke = 'var(--accent)';
                highlightLayer.appendChild(clone);
            }
        });
    }

    // --- SIDEBAR LIST ---
    function buildList() {
        layerList.innerHTML = '';
        [...S.drawOrder].reverse().forEach(fi => {
            const item = document.createElement('div');
            item.className = 'layer-item'; item.dataset.fi = fi; item.draggable = true;
            if (fi === S.hiFace) item.classList.add('highlighted');
            if (fi === S.selectedFace) item.classList.add('selected');
            
            item.innerHTML = `
                <div class="drag-handle"><i class="ph-fill ph-dots-six-vertical"></i></div>
                <div class="swatch" style="background:${S.flipped[fi] ? 'var(--paper-back)' : 'var(--paper)'}"></div>
                <span class="face-id">Faccia ${fi}</span>
                <div class="controls">
                    <button class="btn-icon" data-act="top" title="In Cima"><i class="ph-fill ph-caret-double-up"></i></button>
                    <button class="btn-icon" data-act="up" title="Su"><i class="ph-fill ph-caret-up"></i></button>
                    <button class="btn-icon" data-act="down" title="Giù"><i class="ph-fill ph-caret-down"></i></button>
                    <button class="btn-icon" data-act="bot" title="In Fondo"><i class="ph-fill ph-caret-double-down"></i></button>
                </div>
            `;
            
            item.onclick = (e) => { if (!e.target.closest('.btn-icon')) selectFace(fi); };
            
            const c = item.querySelector('.controls');
            c.querySelector('[data-act="top"]').onclick = () => { saveState(); S.drawOrder.push(S.drawOrder.splice(S.drawOrder.indexOf(fi), 1)[0]); refreshUI(); };
            c.querySelector('[data-act="up"]').onclick = () => { let i = S.drawOrder.indexOf(fi); if (i < S.drawOrder.length - 1) { saveState(); [S.drawOrder[i], S.drawOrder[i+1]] = [S.drawOrder[i+1], S.drawOrder[i]]; refreshUI(); } };
            c.querySelector('[data-act="down"]').onclick = () => { let i = S.drawOrder.indexOf(fi); if (i > 0) { saveState(); [S.drawOrder[i], S.drawOrder[i-1]] = [S.drawOrder[i-1], S.drawOrder[i]]; refreshUI(); } };
            c.querySelector('[data-act="bot"]').onclick = () => { saveState(); S.drawOrder.unshift(S.drawOrder.splice(S.drawOrder.indexOf(fi), 1)[0]); refreshUI(); };

            // Drag and Drop
            item.ondragstart = () => { dragSrcEl = item; item.classList.add('dragging'); };
            item.ondragover = (e) => { e.preventDefault(); item.classList.add('drag-over'); };
            item.ondragleave = () => item.classList.remove('drag-over');
            item.ondrop = (e) => {
                e.preventDefault(); item.classList.remove('drag-over');
                const fromFi = parseInt(dragSrcEl.dataset.fi), toFi = parseInt(item.dataset.fi);
                if (fromFi !== toFi) {
                    saveState();
                    const s = S.drawOrder.splice(S.drawOrder.indexOf(fromFi), 1)[0];
                    S.drawOrder.splice(S.drawOrder.indexOf(toFi), 0, s);
                    refreshUI();
                }
            };
            item.onmouseenter = () => highlightFace(fi);
            item.onmouseleave = () => highlightFace(-1);
            layerList.appendChild(item);
        });
    }

    // --- EXPORT & RESET ---
    document.getElementById('resetBtn').onclick = () => { if (S.foldData) { saveState(); processModel(S.foldData); } };
    document.getElementById('exportBtn').onclick = () => {
        const out = JSON.parse(JSON.stringify(S.foldData));
        out.faces_layer = S.drawOrder.reduce((acc, fi, i) => { acc[fi] = i; return acc; }, []);
        const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = S.fileName.replace('.fold', '') + '_layered.fold';
        a.click();
    };
    document.getElementById('exportSvgBtn').onclick = () => {
        const sizeMM = 100; // ~10cm
        const pad = 0.05;
        const styles = getComputedStyle(document.documentElement);
        const paperColor = styles.getPropertyValue('--paper').trim();
        const paperBackColor = styles.getPropertyValue('--paper-back').trim();

        // Build a clean standalone SVG with only the face polygons
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('xmlns', NS);
        svg.setAttribute('viewBox', `${pad} ${pad} ${1 - 2 * pad} ${1 - 2 * pad}`);
        svg.setAttribute('width', `${sizeMM}mm`);
        svg.setAttribute('height', `${sizeMM}mm`);

        // Background
        const bg = document.createElementNS(NS, 'rect');
        bg.setAttribute('x', pad); bg.setAttribute('y', pad);
        bg.setAttribute('width', 1 - 2 * pad); bg.setAttribute('height', 1 - 2 * pad);
        bg.setAttribute('fill', '#C8C3BC');
        svg.appendChild(bg);

        // Faces in draw order with resolved colors
        S.drawOrder.forEach(fi => {
            const poly = document.createElementNS(NS, 'polygon');
            poly.setAttribute('points', S.facesVerts[fi].map(vi => S.vFolded[vi].join(',')).join(' '));
            poly.setAttribute('fill', S.flipped[fi] ? paperBackColor : paperColor);
            poly.setAttribute('stroke', 'rgba(0,0,0,0.15)');
            poly.setAttribute('stroke-width', '0.002');
            poly.setAttribute('stroke-linejoin', 'round');
            svg.appendChild(poly);
        });

        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(svg);
        const blob = new Blob([svgString], { type: 'image/svg+xml' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = S.fileName.replace('.fold', '') + '.svg';
        a.click();
    };

    undoBtn.onclick = undo;
    redoBtn.onclick = redo;

})();