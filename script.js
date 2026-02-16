(function () {
	const NS = "http://www.w3.org/2000/svg";

	// --- DOM ELEMENTS ---
	const dropZone = document.getElementById("dropZone"),
		fileInput = document.getElementById("fileInput"),
		canvasArea = document.getElementById("canvasArea"),
		svgEl = document.getElementById("origamiSvg"),
		facesLayer = document.getElementById("facesLayer"),
		highlightLayer = document.getElementById("highlightLayer"),
		layerList = document.getElementById("layerList"),
		tagsCt = document.getElementById("tags"),
		undoBtn = document.getElementById("undoBtn"),
		redoBtn = document.getElementById("redoBtn"),
		quickOrderBtn = document.getElementById("quickOrderBtn");

	// --- APPLICATION STATE ---
	let S = {
		foldData: null,
		fileName: "",
		vFolded: null,
		vFlat: null,
		facesVerts: null,
		flipped: null,
		drawOrder: [],
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
		// Unfold
		morphT: 0,
		isUnfolded: false,
		animating: false,
	};

	let dragSrcEl = null;

	// --- FILE LOADING ---
	document.getElementById("uploadNewBtn").onclick = () => fileInput.click();
	dropZone.onclick = (e) => {
		if (e.target !== fileInput) fileInput.click();
	};
	fileInput.onchange = () => {
		if (fileInput.files.length) loadFile(fileInput.files[0]);
	};

	canvasArea.ondragover = (e) => {
		e.preventDefault();
		dropZone.classList.add("drag-active");
	};
	canvasArea.ondragleave = (e) => {
		if (!canvasArea.contains(e.relatedTarget)) dropZone.classList.remove("drag-active");
	};
	canvasArea.ondrop = (e) => {
		e.preventDefault();
		dropZone.classList.remove("drag-active");
		if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
	};

	function loadFoldData(json, name) {
		S.foldData = json;
		S.fileName = name;
		S.history = [];
		S.redoStack = [];
		S.selectedFace = -1;
		S.view = { x: 0, y: 0, w: 1, h: 1 };
		processModel(S.foldData);
		document.getElementById("historyTools").style.display = "flex";
		document.getElementById("viewControls").style.display = "flex";
		document.getElementById("sidebar").style.display = "flex";
		dropZone.classList.add("compact");
	}

	function loadFile(file) {
		const r = new FileReader();
		r.onload = (e) => {
			try {
				loadFoldData(JSON.parse(e.target.result), file.name);
			} catch (err) {
				alert("Error parsing FOLD file");
			}
		};
		r.readAsText(file);
	}

	document.getElementById("exampleBtn").onclick = () => {
		fetch("media/default.fold")
			.then((r) => r.json())
			.then((data) => loadFoldData(data, "default.fold"))
			.catch(() => alert("Could not load example file"));
	};

	// --- VIEWPORT (ZOOM & PAN) ---
	function updateViewBox() {
		svgEl.setAttribute("viewBox", `${S.view.x} ${S.view.y} ${S.view.w} ${S.view.h}`);
	}

	function changeZoom(factor, mx, my) {
		let oldW = S.view.w,
			oldH = S.view.h;
		S.view.w /= factor;
		S.view.h /= factor;
		let cx = mx !== undefined ? mx : S.view.x + oldW / 2;
		let cy = my !== undefined ? my : S.view.y + oldH / 2;
		S.view.x = cx - (cx - S.view.x) * (S.view.w / oldW);
		S.view.y = cy - (cy - S.view.y) * (S.view.h / oldH);
		updateViewBox();
	}

	svgEl.onwheel = (e) => {
		e.preventDefault();
		if (S.isUnfolded) return;
		const r = svgEl.getBoundingClientRect();
		const mx = S.view.x + (e.clientX - r.left) * (S.view.w / r.width);
		const my = S.view.y + (e.clientY - r.top) * (S.view.h / r.height);
		changeZoom(e.deltaY > 0 ? 0.9 : 1.1, mx, my);
	};

	let didPan = false;
	svgEl.onmousedown = (e) => {
		if (S.isUnfolded) return;
		const onFace = e.target.tagName === "polygon";
		if (e.button === 1 || S.spacePressed || (!onFace && e.button === 0)) {
			S.isPanning = true;
			didPan = false;
			S.lastMouse = { x: e.clientX, y: e.clientY };
			document.body.classList.add("dragging-canvas");
			e.preventDefault();
		}
	};
	svgEl.onclick = (e) => {
		if (e.target === svgEl && !didPan) selectFace(-1);
	};
	window.onmousemove = (e) => {
		if (S.isPanning) {
			let dx = (e.clientX - S.lastMouse.x) * (S.view.w / svgEl.clientWidth);
			let dy = (e.clientY - S.lastMouse.y) * (S.view.h / svgEl.clientHeight);
			if (Math.abs(dx) > 0 || Math.abs(dy) > 0) didPan = true;
			S.view.x -= dx;
			S.view.y -= dy;
			S.lastMouse = { x: e.clientX, y: e.clientY };
			updateViewBox();
		}
	};
	window.onmouseup = () => {
		S.isPanning = false;
		document.body.classList.remove("dragging-canvas");
	};

	// Keyboard shortcuts
	window.onkeydown = (e) => {
		if (e.key === "Escape") document.getElementById("helpOverlay").classList.remove("open");
		if (e.code === "Space") {
			S.spacePressed = true;
			document.body.classList.add("space-panning");
		}
		if ((e.ctrlKey || e.metaKey) && e.key === "z") {
			e.preventDefault();
			e.shiftKey ? redo() : undo();
		}
		if ((e.ctrlKey || e.metaKey) && e.key === "y") {
			e.preventDefault();
			redo();
		}
	};
	window.onkeyup = (e) => {
		if (e.code === "Space") {
			S.spacePressed = false;
			document.body.classList.remove("space-panning");
		}
	};

	document.getElementById("zoomIn").onclick = () => changeZoom(1.2);
	document.getElementById("zoomOut").onclick = () => changeZoom(0.8);
	document.getElementById("zoomReset").onclick = () => {
		S.view = { x: 0, y: 0, w: 1, h: 1 };
		updateViewBox();
	};

	// --- QUICK ORDER TOOL ---
	quickOrderBtn.onclick = () => {
		S.quickOrderActive = !S.quickOrderActive;
		quickOrderBtn.classList.toggle("active", S.quickOrderActive);
		document.body.classList.toggle("quick-order-mode", S.quickOrderActive);
	};

	// --- UNFOLD PREVIEW ---
	function lerp(a, b, t) {
		return a + (b - a) * t;
	}
	function easeInOut(t) {
		return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
	}

	function setMorph(t) {
		S.morphT = t;
		const styles = getComputedStyle(document.documentElement);
		const paper = styles.getPropertyValue("--paper").trim();
		const back = styles.getPropertyValue("--paper-back").trim();

		S.drawOrder.forEach((fi) => {
			const poly = S.polyMap[fi];
			if (!poly) return;

			const pts = S.facesVerts[fi].map((vi) => {
				const f = S.vFolded[vi],
					c = S.vFlat[vi];
				return [lerp(f[0], c[0], t), lerp(f[1], c[1], t)];
			});
			poly.setAttribute("points", pts.map((p) => p.join(",")).join(" "));

			if (S.flipped[fi]) {
				poly.style.fill = `color-mix(in srgb, ${back}, ${paper} ${t * 100}%)`;
			} else {
				poly.setAttribute("fill", paper);
			}
		});
		renderHighlights();
	}

	function animateMorph(from, to, duration = 800) {
		return new Promise((resolve) => {
			S.animating = true;
			const start = performance.now();
			(function frame(now) {
				const raw = Math.min((now - start) / duration, 1);
				setMorph(lerp(from, to, easeInOut(raw)));
				if (raw < 1) requestAnimationFrame(frame);
				else {
					S.animating = false;
					resolve();
				}
			})(performance.now());
		});
	}

	const unfoldBtn = document.getElementById("unfoldBtn");

	function setUnfoldDisabled(disabled) {
		// Disable/enable all interactive elements except unfoldBtn
		document.querySelectorAll("#sidebar button, #historyTools button, #viewControls button:not(#unfoldBtn), #quickOrderBtn").forEach((btn) => {
			btn.disabled = disabled;
		});
		// Disable sidebar drag & layer clicks
		layerList.style.pointerEvents = disabled ? "none" : "";
	}

	async function foldBack() {
		if (S.animating || !S.isUnfolded) return;
		S.isUnfolded = false;
		unfoldBtn.classList.remove("active");
		await animateMorph(S.morphT, 0);
		setUnfoldDisabled(false);
	}

	unfoldBtn.onclick = async () => {
		if (S.animating || !S.foldData) return;
		if (S.isUnfolded) {
			foldBack();
			return;
		}
		// Unfold: reset zoom to 1:1, disable buttons, animate
		S.isUnfolded = true;
		unfoldBtn.classList.add("active");
		S.view = { x: 0, y: 0, w: 1, h: 1 };
		updateViewBox();
		setUnfoldDisabled(true);
		await animateMorph(S.morphT, 1);
	};

	// Any click while unfolded folds back
	svgEl.addEventListener(
		"mousedown",
		(e) => {
			if (S.isUnfolded && !S.animating) {
				e.preventDefault();
				e.stopPropagation();
				foldBack();
			}
		},
		true,
	);

	// --- GEOMETRY & ORDER LOGIC ---
	function saveState() {
		S.history.push(JSON.stringify(S.drawOrder));
		S.redoStack = [];
		updateHistoryButtons();
	}
	function undo() {
		if (S.history.length) {
			S.redoStack.push(JSON.stringify(S.drawOrder));
			S.drawOrder = JSON.parse(S.history.pop());
			refreshUI();
		}
	}
	function redo() {
		if (S.redoStack.length) {
			S.history.push(JSON.stringify(S.drawOrder));
			S.drawOrder = JSON.parse(S.redoStack.pop());
			refreshUI();
		}
	}
	function updateHistoryButtons() {
		undoBtn.disabled = !S.history.length;
		redoBtn.disabled = !S.redoStack.length;
	}

	function refreshUI() {
		render();
		buildList();
		updateHistoryButtons();
		updateViewBox();
	}

	function processModel(data) {
		const res = computeFold(data);
		const vf = res.vFolded;
		const xs = vf.map((v) => v[0]),
			ys = vf.map((v) => v[1]);
		const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1,
			pad = 0.05;
		const sc = (1 - 2 * pad) / span;
		const ox = pad - (Math.min(...xs) - (span - (Math.max(...xs) - Math.min(...xs))) / 2) * sc;
		const oy = pad - (Math.min(...ys) - (span - (Math.max(...ys) - Math.min(...ys))) / 2) * sc;

		S.vFolded = vf.map((v) => [v[0] * sc + ox, v[1] * sc + oy]);
		// Normalize flat (crease pattern) vertices to same coordinate space
		const cp = data.vertices_coords;
		const fxs = cp.map((v) => v[0]),
			fys = cp.map((v) => v[1]);
		const fSpan = Math.max(Math.max(...fxs) - Math.min(...fxs), Math.max(...fys) - Math.min(...fys)) || 1;
		const fSc = (1 - 2 * pad) / fSpan;
		const fOx = pad - (Math.min(...fxs) - (fSpan - (Math.max(...fxs) - Math.min(...fxs))) / 2) * fSc;
		const fOy = pad - (Math.min(...fys) - (fSpan - (Math.max(...fys) - Math.min(...fys))) / 2) * fSc;
		S.vFlat = cp.map((v) => [v[0] * fSc + fOx, v[1] * fSc + fOy]);

		S.facesVerts = data.faces_vertices;
		S.flipped = res.flipped;
		S.drawOrder = res.drawOrder;
		S.morphT = 0;
		S.isUnfolded = false;
		document.getElementById("unfoldBtn").classList.remove("active");

		tagsCt.innerHTML = `<span class="tag">${S.fileName}</span><span class="tag">${S.drawOrder.length} faces</span>`;
		svgEl.style.display = "";
		refreshUI();
	}

	function computeFold(data) {
		const cp = data.vertices_coords,
			fv = data.faces_vertices,
			ev = data.edges_vertices,
			ea = data.edges_assignment;
		const nF = fv.length,
			nV = cp.length,
			v2f = Array.from({ length: nV }, () => []),
			adj = Array.from({ length: nF }, () => []);
		fv.forEach((f, fi) => f.forEach((v) => v2f[v].push(fi)));
		ev.forEach((e, ei) => {
			if (ea[ei] === "B") return;
			const sh = v2f[e[0]].filter((f) => v2f[e[1]].includes(f));
			if (sh.length === 2) {
				adj[sh[0]].push({ f: sh[1], v0: e[0], v1: e[1], flat: ea[ei] === "F" });
				adj[sh[1]].push({ f: sh[0], v0: e[0], v1: e[1], flat: ea[ei] === "F" });
			}
		});
		let T = new Array(nF).fill(null),
			vis = new Array(nF).fill(false);
		T[0] = [1, 0, 0, 1, 0, 0];
		vis[0] = true;
		let q = [0];
		const applyT = (t, p) => [t[0] * p[0] + t[1] * p[1] + t[4], t[2] * p[0] + t[3] * p[1] + t[5]];
		const composeT = (a, b) => [
			a[0] * b[0] + a[1] * b[2],
			a[0] * b[1] + a[1] * b[3],
			a[2] * b[0] + a[3] * b[2],
			a[2] * b[1] + a[3] * b[3],
			a[0] * b[4] + a[1] * b[5] + a[4],
			a[2] * b[4] + a[3] * b[5] + a[5],
		];
		const reflectT = (p0, p1) => {
			let dx = p1[0] - p0[0],
				dy = p1[1] - p0[1],
				l2 = dx * dx + dy * dy;
			let c = (dx * dx - dy * dy) / l2,
				s = (2 * dx * dy) / l2;
			return [c, s, s, -c, p0[0] - c * p0[0] - s * p0[1], p0[1] - s * p0[0] + c * p0[1]];
		};
		while (q.length) {
			let cur = q.shift();
			adj[cur].forEach((nb) => {
				if (vis[nb.f]) return;
				vis[nb.f] = true;
				T[nb.f] = nb.flat ? [...T[cur]] : composeT(reflectT(applyT(T[cur], cp[nb.v0]), applyT(T[cur], cp[nb.v1])), T[cur]);
				q.push(nb.f);
			});
		}
		const flipped = T.map((t) => (t ? t[0] * t[3] - t[1] * t[2] < 0 : false));
		let vFolded = data.vertices_coords_folded ? data.vertices_coords_folded.map((v) => [...v]) : new Array(nV);
		if (!data.vertices_coords_folded)
			fv.forEach((f, fi) => {
				if (T[fi]) f.forEach((v) => (vFolded[v] = applyT(T[fi], cp[v])));
			});
		let order;
		const manual = data["origoto:faceManualOrder"];
		if (manual) {
			order = fv.map((_, i) => i).sort((a, b) => manual[a] - manual[b]);
		} else if (data.faces_layer) {
			order = fv.map((_, i) => i).sort((a, b) => data.faces_layer[a] - data.faces_layer[b]);
		} else if (data.faceOrders && data.faceOrders.length) {
			// Topological sort from faceOrders [faceA, faceB, direction]
			const graph = Array.from({ length: nF }, () => []),
				inDeg = new Array(nF).fill(0);
			data.faceOrders.forEach((o) => {
				const [lo, hi] = o[2] === 1 ? [o[1], o[0]] : [o[0], o[1]];
				graph[lo].push(hi);
				inDeg[hi]++;
			});
			const tq = [];
			order = [];
			for (let i = 0; i < nF; i++) if (inDeg[i] === 0) tq.push(i);
			while (tq.length) {
				const f = tq.shift();
				order.push(f);
				graph[f].forEach((nb) => {
					if (--inDeg[nb] === 0) tq.push(nb);
				});
			}
			for (let i = 0; i < nF; i++) if (!order.includes(i)) order.push(i);
		} else {
			order = fv.map((_, i) => i).sort((a, b) => (flipped[a] ? 0 : 1) - (flipped[b] ? 0 : 1));
		}
		return { vFolded, flipped, drawOrder: order };
	}

	// --- RENDER ---
	function render() {
		facesLayer.innerHTML = "";
		S.polyMap = {};
		S.drawOrder.forEach((fi) => {
			const poly = document.createElementNS(NS, "polygon");
			poly.setAttribute("points", S.facesVerts[fi].map((vi) => S.vFolded[vi].join(",")).join(" "));
			poly.setAttribute("fill", S.flipped[fi] ? "var(--paper-back)" : "var(--paper)");

			// Interaction
			poly.onclick = (e) => {
				if (S.isPanning || S.spacePressed) return;
				e.stopPropagation();
				if (S.quickOrderActive) {
					saveState();
					const idx = S.drawOrder.indexOf(fi);
					if (e.altKey)
						S.drawOrder.push(S.drawOrder.splice(idx, 1)[0]); // To front
					else S.drawOrder.unshift(S.drawOrder.splice(idx, 1)[0]); // To back
					refreshUI();
				} else {
					selectFace(fi);
				}
			};
			poly.oncontextmenu = (e) => {
				e.preventDefault();
				selectFace(fi);
			};
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
		layerList.querySelectorAll(".layer-item").forEach((el) => {
			const isSel = parseInt(el.dataset.fi) === fi;
			el.classList.toggle("selected", isSel);
			if (isSel) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
		});
	}

	function highlightFace(fi) {
		S.hiFace = fi;
		renderHighlights();
		layerList.querySelectorAll(".layer-item").forEach((el) => el.classList.toggle("highlighted", parseInt(el.dataset.fi) === fi));
	}

	function renderHighlights() {
		highlightLayer.innerHTML = "";
		[S.selectedFace, S.hiFace].forEach((fi) => {
			if (fi !== -1 && S.polyMap[fi]) {
				const clone = S.polyMap[fi].cloneNode(true);
				clone.classList.add("hi-clone");
				highlightLayer.appendChild(clone);
			}
		});
	}

	// --- SIDEBAR ---
	function buildList() {
		layerList.innerHTML = "";
		[...S.drawOrder].reverse().forEach((fi) => {
			const item = document.createElement("div");
			item.className = "layer-item";
			item.dataset.fi = fi;
			item.draggable = true;
			if (fi === S.hiFace) item.classList.add("highlighted");
			if (fi === S.selectedFace) item.classList.add("selected");

			item.innerHTML = `
                <div class="drag-handle"><i class="ph-bold ph-dots-six-vertical"></i></div>
                <div class="swatch" style="background:${S.flipped[fi] ? "var(--paper-back)" : "var(--paper)"}"></div>
                <span class="face-id">Face ${fi}</span>
                <div class="controls">
                    <button class="btn-icon" data-act="top" title="To Front"><i class="ph-fill ph-caret-double-up"></i></button>
                    <button class="btn-icon" data-act="up" title="Up"><i class="ph-fill ph-caret-up"></i></button>
                    <button class="btn-icon" data-act="down" title="Down"><i class="ph-fill ph-caret-down"></i></button>
                    <button class="btn-icon" data-act="bot" title="To Back"><i class="ph-fill ph-caret-double-down"></i></button>
                </div>
            `;

			item.onclick = (e) => {
				if (!e.target.closest(".btn-icon")) selectFace(fi);
			};

			const c = item.querySelector(".controls");
			c.querySelector('[data-act="top"]').onclick = () => {
				saveState();
				S.drawOrder.push(S.drawOrder.splice(S.drawOrder.indexOf(fi), 1)[0]);
				refreshUI();
			};
			c.querySelector('[data-act="up"]').onclick = () => {
				let i = S.drawOrder.indexOf(fi);
				if (i < S.drawOrder.length - 1) {
					saveState();
					[S.drawOrder[i], S.drawOrder[i + 1]] = [S.drawOrder[i + 1], S.drawOrder[i]];
					refreshUI();
				}
			};
			c.querySelector('[data-act="down"]').onclick = () => {
				let i = S.drawOrder.indexOf(fi);
				if (i > 0) {
					saveState();
					[S.drawOrder[i], S.drawOrder[i - 1]] = [S.drawOrder[i - 1], S.drawOrder[i]];
					refreshUI();
				}
			};
			c.querySelector('[data-act="bot"]').onclick = () => {
				saveState();
				S.drawOrder.unshift(S.drawOrder.splice(S.drawOrder.indexOf(fi), 1)[0]);
				refreshUI();
			};

			// Drag and Drop
			let dragCounter = 0;
			item.ondragstart = (e) => {
				dragSrcEl = item;
				item.classList.add("dragging");
				e.dataTransfer.effectAllowed = "move";
			};
			item.ondragend = () => {
				item.classList.remove("dragging");
				layerList.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
			};
			item.ondragenter = (e) => {
				e.preventDefault();
				dragCounter++;
				item.classList.add("drag-over");
			};
			item.ondragover = (e) => {
				e.preventDefault();
				e.dataTransfer.dropEffect = "move";
			};
			item.ondragleave = () => {
				dragCounter--;
				if (dragCounter <= 0) {
					dragCounter = 0;
					item.classList.remove("drag-over");
				}
			};
			item.ondrop = (e) => {
				e.preventDefault();
				dragCounter = 0;
				item.classList.remove("drag-over");
				const fromFi = parseInt(dragSrcEl.dataset.fi),
					toFi = parseInt(item.dataset.fi);
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
	document.getElementById("resetBtn").onclick = () => {
		if (S.foldData) {
			saveState();
			processModel(S.foldData);
		}
	};
	document.getElementById("exportBtn").onclick = () => {
		const out = JSON.parse(JSON.stringify(S.foldData));
		out["origoto:faceManualOrder"] = S.drawOrder.reduce((acc, fi, i) => {
			acc[fi] = i;
			return acc;
		}, []);
		const blob = new Blob([JSON.stringify(out)], { type: "application/json" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = S.fileName.replace(".fold", "") + "_layered.fold";
		a.click();
	};
	document.getElementById("exportSvgBtn").onclick = () => {
		const sizeMM = 100; // ~10cm
		const pad = 0.05;
		const styles = getComputedStyle(document.documentElement);
		const paperColor = styles.getPropertyValue("--paper").trim();
		const paperBackColor = styles.getPropertyValue("--paper-back").trim();
		const borderColor = styles.getPropertyValue("--border").trim();

		// Build a clean standalone SVG with only the face polygons
		const svg = document.createElementNS(NS, "svg");
		svg.setAttribute("xmlns", NS);
		svg.setAttribute("viewBox", `${pad} ${pad} ${1 - 2 * pad} ${1 - 2 * pad}`);
		svg.setAttribute("width", `${sizeMM}mm`);
		svg.setAttribute("height", `${sizeMM}mm`);

		// Background
		const bg = document.createElementNS(NS, "rect");
		bg.setAttribute("x", pad);
		bg.setAttribute("y", pad);
		bg.setAttribute("width", 1 - 2 * pad);
		bg.setAttribute("height", 1 - 2 * pad);
		bg.setAttribute("fill", "#C8C3BC");
		svg.appendChild(bg);

		// Faces in draw order with resolved colors
		S.drawOrder.forEach((fi) => {
			const poly = document.createElementNS(NS, "polygon");
			poly.setAttribute("points", S.facesVerts[fi].map((vi) => S.vFolded[vi].join(",")).join(" "));
			poly.setAttribute("fill", S.flipped[fi] ? paperBackColor : paperColor);
			poly.setAttribute("stroke", borderColor);
			poly.setAttribute("stroke-width", "0.003");
			poly.setAttribute("stroke-linejoin", "round");
			svg.appendChild(poly);
		});

		const serializer = new XMLSerializer();
		const svgString = serializer.serializeToString(svg);
		const blob = new Blob([svgString], { type: "image/svg+xml" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = S.fileName.replace(".fold", "") + ".svg";
		a.click();
	};

	undoBtn.onclick = undo;
	redoBtn.onclick = redo;

	// --- HELP LIGHTBOX ---
	const helpOverlay = document.getElementById("helpOverlay");
	document.getElementById("helpBtn").onclick = () => helpOverlay.classList.add("open");
	document.getElementById("helpClose").onclick = () => helpOverlay.classList.remove("open");
	helpOverlay.onclick = (e) => {
		if (e.target === helpOverlay) helpOverlay.classList.remove("open");
	};
})();
