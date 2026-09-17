/*
 * Deepnest CAD — Web · UI controller
 *
 * Wiring: SvgParser (import/clean) → part extraction → SvgNest (pure-JS engine,
 * parallel.js web workers) → placement display/export. No Electron, no native addon.
 */
'use strict';

(function () {

	/* ================= state ================= */

	const ENGINE_UPI = 72; // engine units per inch for physically-united SVGs

	const state = {
		parts: [],        // {id,name,els:[{el,poly,area}],area,bbox,qty,enabled,color}
		sheet: { w: 600, h: 400, unit: 'px' },
		cfg: { spacing: 2, rotations: 4, populationSize: 10, mutationRate: 10, curveTolerance: 0.3, useHoles: false, exploreConcave: false },
		mode: 'edit',     // 'edit' | 'nest'
		sheets: [],       // engine placement <svg> elements
		activeSheet: 0,
		best: { util: 0, placed: '0/0', sheets: 0 },
		improvements: 0,
		nesting: false,
		selected: -1
	};

	let uid = 0;
	const $ = (id) => document.getElementById(id);

	const view = { x: 0, y: 0, k: 1 };      // world transform: screen = world*k + (x,y)
	const canvas = $('canvas');
	const world = $('world');
	const content = $('content');
	const overlay = $('overlay');
	const gridG = $('grid');
	const sheetRect = $('sheetRect');

	/* ================= helpers ================= */

	function fmt(n, d) { return Number(n).toFixed(d === undefined ? 1 : d); }

	function unitFactor() {
		return state.sheet.unit === 'in' ? ENGINE_UPI : (state.sheet.unit === 'mm' ? ENGINE_UPI / 25.4 : 1);
	}

	function setStatus(msg) { $('statusMsg').textContent = msg; }

	function setEngine(running) {
		$('statusEngine').className = 'enginedot' + (running ? ' run' : '');
		$('statusEngineText').textContent = running ? 'nesting…' : 'idle';
	}

	function download(name, text) {
		const blob = new Blob([text], { type: 'image/svg+xml' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = name;
		document.body.appendChild(a);
		a.click();
		setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
	}

	function polygonBounds(poly) {
		let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
		for (let i = 0; i < poly.length; i++) {
			if (poly[i].x < minx) minx = poly[i].x;
			if (poly[i].y < miny) miny = poly[i].y;
			if (poly[i].x > maxx) maxx = poly[i].x;
			if (poly[i].y > maxy) maxy = poly[i].y;
		}
		return { x: minx, y: miny, width: maxx - minx, height: maxy - miny };
	}

	/* ================= part extraction ================= */

	function extractPartsFromSvg(svgRoot, filename) {
		const curveTol = state.cfg.curveTolerance;
		const tags = SvgParser.polygonElements.filter(t => t !== 'svg');
		let candidates = [];
		for (const el of Array.from(svgRoot.children)) {
			if (tags.indexOf(el.tagName) < 0) continue;
			let closed = true;
			try { closed = SvgParser.isClosed(el, 2 * curveTol); } catch (e) { closed = true; }
			if (!closed) continue;
			let poly = null;
			try { poly = SvgParser.polygonify(el); } catch (e) { poly = null; }
			if (!poly || poly.length < 3) continue;
			const area = Math.abs(GeometryUtil.polygonArea(poly));
			if (area < curveTol * curveTol) continue;
			candidates.push({ el: el, poly: poly, area: area });
		}

		// assign each polygon to the smallest polygon that contains it (holes/details follow their part)
		candidates.sort((a, b) => a.area - b.area);
		const parent = new Map();
		for (let i = 0; i < candidates.length; i++) {
			// j iterates all candidates (sorted ascending by area) so the first
			// geometric container found is the smallest-area container
			for (let j = 0; j < candidates.length; j++) {
				if (j === i || candidates[j].area < candidates[i].area) continue;
				if (contains(candidates[j].poly, candidates[i].poly)) {
					parent.set(candidates[i], candidates[j]);
					break;
				}
			}
		}

		const base = (filename || 'part').replace(/\.svg$/i, '');
		const roots = candidates.filter(c => !parent.has(c));
		const made = [];
		roots.forEach((c, i) => {
			const members = [c];
			for (const [child, par] of parent) {
				let p = par, guard = 0;
				while (p && guard++ < 50) {
					if (p === c) { members.push(child); break; }
					p = parent.get(p);
				}
			}
			const boundsList = members.map(m => polygonBounds(m.poly));
			const bbox = unionBounds(boundsList);
			const area = members.reduce((s, m) => s + m.area, 0);
			const name = c.el.getAttribute('data-name') || c.el.getAttribute('id') || (base + ' ' + (i + 1));
			made.push({
				id: uid++,
				name: name,
				els: members,
				area: area,
				bbox: bbox,
				qty: 1,
				enabled: true,
				color: 'hsl(' + ((made.length * 47 + 18) % 360) + ' 72% 64%)'
			});
		});
		return made;

		function contains(outer, inner) {
			if (GeometryUtil.pointInPolygon(inner[0], outer) !== true) return false;
			// centroid as second sample
			let cx = 0, cy = 0;
			for (let k = 0; k < inner.length; k++) { cx += inner[k].x; cy += inner[k].y; }
			return GeometryUtil.pointInPolygon({ x: cx / inner.length, y: cy / inner.length }, outer) === true;
		}
	}

	function unionBounds(list) {
		let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
		for (const b of list) {
			minx = Math.min(minx, b.x); miny = Math.min(miny, b.y);
			maxx = Math.max(maxx, b.x + b.width); maxy = Math.max(maxy, b.y + b.height);
		}
		return { x: minx, y: miny, width: maxx - minx, height: maxy - miny };
	}

	/* ================= import ================= */

	function importSvgText(filename, text) {
		try {
			let svg = SvgParser.load(null, text, ENGINE_UPI, null);
			svg = SvgParser.clean(false);
			const parts = extractPartsFromSvg(svg, filename);
			if (parts.length === 0) {
				setStatus('"' + filename + '": no closed shapes found (only open paths?). Nothing imported.');
				return false;
			}
			state.parts.push(...parts);
			renderPartList();
			if (state.mode === 'edit') renderEditView();
			fitView();
			setStatus('Imported ' + parts.length + ' part(s) from "' + filename + '".');
			return true;
		} catch (err) {
			console.error(err);
			setStatus('Import failed for "' + filename + '": ' + err.message);
			return false;
		}
	}

	/* ================= parts panel ================= */

	function renderPartList() {
		const ul = $('partList');
		ul.innerHTML = '';
		$('partCount').textContent = state.parts.length;
		$('partsEmpty').style.display = state.parts.length ? 'none' : 'block';

		state.parts.forEach((p, idx) => {
			const li = document.createElement('li');
			li.dataset.partId = p.id;
			if (idx === state.selected) li.classList.add('selected');
			if (!p.enabled) li.classList.add('off');

			// thumbnail
			const cv = document.createElement('canvas');
			cv.className = 'swatch';
			cv.width = 26 * 2; cv.height = 26 * 2;
			drawThumb(cv, p);

			const meta = document.createElement('div');
			meta.className = 'partmeta';
			meta.innerHTML = '<div class="partname"></div><div class="partsub"></div>';
			meta.querySelector('.partname').textContent = p.name;
			meta.querySelector('.partsub').textContent =
				fmt(p.bbox.width, 0) + '×' + fmt(p.bbox.height, 0) + ' u · ' + (p.area / 1e4).toFixed(1) + 'k u²';

			const qty = document.createElement('div');
			qty.className = 'qty';
			qty.innerHTML = '<button data-a="dec">−</button><b></b><button data-a="inc">+</button>';
			qty.querySelector('b').textContent = p.qty;

			const del = document.createElement('button');
			del.className = 'delbtn';
			del.dataset.a = 'del';
			del.title = 'Delete part';
			del.textContent = '✕';

			li.appendChild(cv);
			li.appendChild(meta);
			li.appendChild(qty);
			li.appendChild(del);
			ul.appendChild(li);
		});
	}

	function drawThumb(cv, p) {
		const ctx = cv.getContext('2d');
		ctx.clearRect(0, 0, cv.width, cv.height);
		if (!p.els.length) return;
		const b = p.bbox;
		const s = Math.min((cv.width - 6) / (b.width || 1), (cv.height - 6) / (b.height || 1));
		ctx.save();
		ctx.translate(cv.width / 2, cv.height / 2);
		ctx.scale(s, -s);
		ctx.translate(-(b.x + b.width / 2), -(b.y + b.height / 2));
		ctx.strokeStyle = p.color;
		ctx.fillStyle = p.color;
		ctx.globalAlpha = 0.85;
		ctx.lineWidth = 1.2 / s;
		for (const m of p.els) {
			ctx.beginPath();
			ctx.moveTo(m.poly[0].x, m.poly[0].y);
			for (let i = 1; i < m.poly.length; i++) ctx.lineTo(m.poly[i].x, m.poly[i].y);
			ctx.closePath();
			ctx.globalAlpha = m === p.els[0] ? 0.25 : 0.55;
			ctx.fill();
			ctx.globalAlpha = 0.9;
			ctx.stroke();
		}
		ctx.restore();
	}

	$('partList').addEventListener('click', (ev) => {
		const li = ev.target.closest('li');
		if (!li) return;
		const idx = state.parts.findIndex(p => p.id === +li.dataset.partId);
		if (idx < 0) return;
		const p = state.parts[idx];
		const act = ev.target.dataset && ev.target.dataset.a;
		if (act === 'inc') p.qty++;
		else if (act === 'dec') p.qty = Math.max(0, p.qty - 1);
		else if (act === 'del') {
			state.parts.splice(idx, 1);
			if (state.selected === idx) state.selected = -1;
			else if (state.selected > idx) state.selected--;
		} else if (ev.target.tagName !== 'CANVAS' || true) {
			state.selected = (state.selected === idx ? -1 : idx);
		}
		if (act !== 'del') togglePartEnabledFromSelection();
		renderPartList();
		if (state.mode === 'edit') renderEditView();
	});

	function togglePartEnabledFromSelection() {
		// selecting a part in the list dims it out of nesting when qty is 0; keep enable logic simple:
		// parts are enabled when qty > 0. Selection is purely visual.
	}

	/* ================= canvas / view ================= */

	function applyView() {
		world.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.k + ')');
		$('zoomLabel').textContent = Math.round(view.k * 100) + '%';
		drawGrid();
	}

	function screenToWorld(sx, sy) {
		const r = canvas.getBoundingClientRect();
		return { x: (sx - r.left - view.x) / view.k, y: (sy - r.top - view.y) / view.k };
	}

	function fitView() {
		const r = canvas.getBoundingClientRect();
		if (r.width < 10) return;
		const boxes = [{ x: 0, y: 0, width: state.sheet.w, height: state.sheet.h }];
		for (const p of state.parts) if (p.enabled && p.qty > 0) boxes.push(p.bbox);
		if (state.mode === 'nest' && state.sheets.length) boxes.push({ x: 0, y: 0, width: state.sheet.w, height: state.sheet.h });
		const b = unionBounds(boxes);
		const k = Math.min(r.width / (b.width || 1), r.height / (b.height || 1)) * 0.88;
		view.k = Math.max(0.005, Math.min(k, 400));
		view.x = r.width / 2 - (b.x + b.width / 2) * view.k;
		view.y = r.height / 2 - (b.y + b.height / 2) * view.k;
		applyView();
	}

	function niceStep(raw) {
		const pow = Math.pow(10, Math.floor(Math.log10(raw)));
		const n = raw / pow;
		return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow;
	}

	function drawGrid() {
		const r = canvas.getBoundingClientRect();
		if (r.width < 10) return;
		const w0 = screenToWorld(0, 0), w1 = screenToWorld(r.width, r.height);
		const step = niceStep((w1.x - w0.x) / 14);
		const major = step * 5;
		let dMinor = '', dMajor = '', dAxis = '';
		const x0 = Math.floor(w0.x / step) * step, x1 = w1.x;
		const y0 = Math.floor(w0.y / step) * step, y1 = w1.y;
		for (let x = x0; x <= x1; x += step) {
			const M = Math.abs(x % major) < step * 0.01 || Math.abs(x % major) > major - step * 0.01;
			const seg = 'M' + x + ' ' + w0.y + 'V' + w1.y;
			if (Math.abs(x) < step * 0.01) dAxis += seg;
			else if (M) dMajor += seg;
			else dMinor += seg;
		}
		for (let y = y0; y <= y1; y += step) {
			const M = Math.abs(y % major) < step * 0.01 || Math.abs(y % major) > major - step * 0.01;
			const seg = 'M' + w0.x + ' ' + y + 'H' + w1.x;
			if (Math.abs(y) < step * 0.01) dAxis += seg;
			else if (M) dMajor += seg;
			else dMinor += seg;
		}
		gridG.innerHTML =
			'<path d="' + dMinor + '" stroke="#1f2126" stroke-width="1"/>' +
			'<path d="' + dMajor + '" stroke="#26292f" stroke-width="1"/>' +
			'<path d="' + dAxis + '" stroke="#3a2c1c" stroke-width="1"/>';
	}

	// ---- pan / zoom / select ----
	let drag = null;

	canvas.addEventListener('mousedown', (ev) => {
		drag = { sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y, moved: false, button: ev.button };
	});

	window.addEventListener('mousemove', (ev) => {
		// crosshair + coords (viewport-relative)
		const r = canvas.getBoundingClientRect();
		const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
		$('crosshairV').classList.toggle('hidden', !inside || state.nesting);
		$('crosshairH').classList.toggle('hidden', !inside || state.nesting);
		if (inside) {
			$('crosshairV').style.left = (ev.clientX - r.left) + 'px';
			$('crosshairH').style.top = (ev.clientY - r.top) + 'px';
			const w = screenToWorld(ev.clientX, ev.clientY);
			$('statusCoords').textContent = 'x ' + fmt(w.x) + '  y ' + fmt(w.y);
		}

		if (!drag) return;
		const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
		if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
		if (drag.moved) {
			view.x = drag.vx + dx;
			view.y = drag.vy + dy;
			applyView();
			canvas.style.cursor = 'grabbing';
		}
	});

	window.addEventListener('mouseup', (ev) => {
		if (!drag) return;
		const wasClick = !drag.moved && drag.button === 0;
		const target = ev.target;
		drag = null;
		canvas.style.cursor = '';
		if (wasClick) {
			const pel = target.closest ? target.closest('[data-part-id]') : null;
			if (pel && state.mode === 'edit') {
				state.selected = state.parts.findIndex(p => p.id === +pel.dataset.partId);
			} else if (state.mode === 'edit') {
				state.selected = -1;
			}
			renderPartList();
			renderEditSelection();
		}
	});

	canvas.addEventListener('wheel', (ev) => {
		ev.preventDefault();
		const r = canvas.getBoundingClientRect();
		const mx = ev.clientX - r.left, my = ev.clientY - r.top;
		const factor = Math.exp(-ev.deltaY * 0.0012);
		const k2 = Math.max(0.005, Math.min(view.k * factor, 400));
		view.x = mx - (mx - view.x) * (k2 / view.k);
		view.y = my - (my - view.y) * (k2 / view.k);
		view.k = k2;
		applyView();
	}, { passive: false });

	window.addEventListener('keydown', (ev) => {
		if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT' || ev.target.tagName === 'TEXTAREA') return;
		if (ev.key === 'f' || ev.key === 'F') fitView();
		else if (ev.key === '+' || ev.key === '=') zoomStep(1.25);
		else if (ev.key === '-' || ev.key === '_') zoomStep(0.8);
		else if (ev.key === 'Escape') { state.selected = -1; renderPartList(); renderEditSelection(); }
		else if ((ev.key === 'Delete' || ev.key === 'Backspace') && state.selected >= 0) {
			state.parts.splice(state.selected, 1);
			state.selected = -1;
			renderPartList();
			renderEditView();
			setStatus('Part deleted.');
		}
	});

	function zoomStep(f) {
		const r = canvas.getBoundingClientRect();
		const mx = r.width / 2, my = r.height / 2;
		const k2 = Math.max(0.005, Math.min(view.k * f, 400));
		view.x = mx - (mx - view.x) * (k2 / view.k);
		view.y = my - (my - view.y) * (k2 / view.k);
		view.k = k2;
		applyView();
	}

	window.addEventListener('resize', () => { applyView(); });

	/* ================= edit view ================= */

	function renderEditView() {
		content.innerHTML = '';
		overlay.innerHTML = '';
		$('sheetTabs').classList.add('hidden');
		$('viewBadge').textContent = 'EDIT';

		// sheet outline
		sheetRect.setAttribute('x', 0);
		sheetRect.setAttribute('y', 0);
		sheetRect.setAttribute('width', state.sheet.w);
		sheetRect.setAttribute('height', state.sheet.h);
		sheetRect.setAttribute('class', 'binrect');
		sheetRect.setAttribute('visibility', 'visible');

		for (const p of state.parts) {
			for (let mi = 0; mi < p.els.length; mi++) {
				const el = p.els[mi].el.cloneNode(true);
				el.setAttribute('data-part-id', p.id);
				el.setAttribute('class', 'part' + (mi > 0 ? ' holepiece' : '') + (p.id === (state.parts[state.selected] || {}).id ? ' selected' : ''));
				el.setAttribute('style', 'color:' + p.color + ';fill:' + p.color + ';stroke:' + p.color + ';');
				content.appendChild(document.importNode(el, true));
			}
		}
		renderEditSelection();
	}

	function renderEditSelection() {
		content.querySelectorAll('[data-part-id]').forEach(el => {
			const sel = +el.dataset.partId === (state.parts[state.selected] || { id: -1 }).id;
			el.classList.toggle('selected', sel);
		});
	}

	/* ================= nesting ================= */

	function buildJobSvgString() {
		const f = unitFactor();
		const W = state.sheet.w * f, H = state.sheet.h * f;
		let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '">';
		s += '<rect id="bin" x="0" y="0" width="' + W + '" height="' + H + '"/>';
		const ser = new XMLSerializer();
		for (const p of state.parts) {
			if (!p.enabled || p.qty < 1) continue;
			for (let q = 0; q < p.qty; q++) {
				for (const m of p.els) s += ser.serializeToString(m.el.cloneNode(true));
			}
		}
		s += '</svg>';
		return { str: s, W: W, H: H };
	}

	function startNesting() {
		if (state.nesting) return;
		const totalQty = state.parts.reduce((s, p) => s + (p.enabled ? p.qty : 0), 0);
		if (totalQty === 0) { setStatus('No parts to nest. Set quantities greater than zero.'); return; }

		// read UI config
		state.sheet.w = parseFloat($('sheetW').value) || 600;
		state.sheet.h = parseFloat($('sheetH').value) || 400;
		state.sheet.unit = $('sheetUnit').value;
		state.cfg = {
			spacing: Math.max(0, parseFloat($('cfgSpacing').value) || 0),
			rotations: parseInt($('cfgRotations').value, 10) || 4,
			populationSize: parseInt($('cfgPopulation').value, 10) || 10,
			mutationRate: parseInt($('cfgMutation').value, 10) || 10,
			curveTolerance: Math.max(0, parseFloat($('cfgCurveTol').value) || 0.3),
			useHoles: $('cfgUseHoles').checked,
			exploreConcave: $('cfgExploreConcave').checked
		};
		updateSheetReadout();

		const job = buildJobSvgString();

		SvgNest.stop();
		SvgNest.config({
			clipperScale: 10000000,
			curveTolerance: state.cfg.curveTolerance,
			spacing: state.cfg.spacing,
			rotations: state.cfg.rotations,
			populationSize: state.cfg.populationSize,
			mutationRate: state.cfg.mutationRate,
			useHoles: state.cfg.useHoles,
			exploreConcave: state.cfg.exploreConcave
		});

		let svgEl;
		try {
			svgEl = SvgNest.parsesvg(job.str);
		} catch (err) {
			console.error(err);
			setStatus('Failed to build nesting job: ' + err.message);
			return;
		}
		const bin = svgEl.querySelector('#bin');
		if (!bin) { setStatus('Internal error: bin element missing after parse.'); return; }
		SvgNest.setbin(bin);

		state.sheets = [];
		state.activeSheet = 0;
		state.best = { util: 0, placed: '0/' + totalQty, sheets: 0 };
		state.improvements = 0;
		state.nesting = true;
		state.mode = 'nest';
		$('viewBadge').textContent = 'NEST — LIVE';
		$('btnEdit').disabled = false;
		$('btnStart').disabled = true;
		$('btnStop').disabled = false;
		$('btnImport').disabled = true;
		$('btnSample').disabled = true;
		setEngine(true);
		setStatus('Nesting started — population ' + state.cfg.populationSize + ', ' + state.cfg.rotations + ' rotations. Improvements appear as they are found.');

		const ok = SvgNest.start(
			// progress callback (NFP generation within a generation cycle)
			function (p) {
				$('progressBar').style.width = Math.round((p || 0) * 100) + '%';
				if (!state.nesting) return;
				if (state.improvements === 0) {
					setStatus('Computing no-fit polygons (NFP geometry) — first generation takes the longest, results stream in after…');
				} else {
					setStatus('Optimizing: generation ' + (state.improvements + 1) + ' — layouts keep improving until you press Stop.');
				}
			},
			// display callback: a better placement was found (engine also calls
			// it with no arguments after non-improving generations - ignore those)
			function (svgList, utilization, placedCount) {
				if (!svgList || !svgList.length) return;
				state.sheets = svgList;
				state.activeSheet = 0;
				state.best.util = utilization || 0;
				state.best.placed = placedCount || '';
				state.best.sheets = state.sheets.length;
				state.improvements++;
				renderNestView();
				updateRunStats();
				$('btnExport').disabled = false;
			}
		);

		if (ok === false) {
			state.nesting = false;
			setEngine(false);
			$('btnStart').disabled = false;
			$('btnStop').disabled = true;
			$('btnImport').disabled = false;
			$('btnSample').disabled = false;
			$('viewBadge').textContent = 'EDIT';
			state.mode = 'edit';
			renderEditView();
			setStatus('Cannot start: parts may not fit the sheet, or sheet geometry is invalid. Try a larger sheet or smaller parts.');
		}
	}

	function stopNesting() {
		if (!state.nesting) return;
		SvgNest.stop();
		state.nesting = false;
		$('viewBadge').textContent = 'NEST — RESULT';
		$('btnStart').disabled = false;
		$('btnStop').disabled = true;
		$('btnImport').disabled = false;
		$('btnSample').disabled = false;
		$('progressBar').style.width = '0%';
		setEngine(false);
		setStatus('Nesting stopped. ' + state.best.sheets + ' sheet(s), best utilization ' + (state.best.util * 100).toFixed(1) + '%. Export or keep iterating.');
	}

	function backToEdit() {
		SvgNest.stop();
		state.nesting = false;
		state.mode = 'edit';
		setEngine(false);
		$('btnStart').disabled = false;
		$('btnStop').disabled = true;
		$('btnImport').disabled = false;
		$('btnSample').disabled = false;
		$('btnExport').disabled = state.sheets.length === 0;
		renderEditView();
		fitView();
		setStatus('Edit view. Parts and sheet are unchanged.');
	}

	function renderNestView() {
		content.innerHTML = '';
		overlay.innerHTML = '';
		sheetRect.setAttribute('visibility', 'visible');
		sheetRect.setAttribute('class', 'nestbin');
		sheetRect.setAttribute('x', 0);
		sheetRect.setAttribute('y', 0);
		sheetRect.setAttribute('width', state.sheet.w * unitFactor());
		sheetRect.setAttribute('height', state.sheet.h * unitFactor());

		// sheet tabs
		const tabs = $('sheetTabs');
		tabs.classList.remove('hidden');
		tabs.innerHTML = '';
		state.sheets.forEach((s, i) => {
			const t = document.createElement('div');
			t.className = 'stab' + (i === state.activeSheet ? ' active' : '');
			t.textContent = 'SHEET ' + (i + 1);
			t.onclick = () => { state.activeSheet = i; renderNestView(); };
			tabs.appendChild(t);
		});

		const svg = state.sheets[state.activeSheet];
		if (svg) {
			for (const child of Array.from(svg.childNodes)) {
				const n = document.importNode(child, true);
				if (n.nodeType === 1) {
					n.classList.add(child.getAttribute('class') === 'bin' ? 'nestbin' : 'nestpart');
					content.appendChild(n);
				}
			}
		}
	}

	function updateRunStats() {
		$('statSheets').textContent = state.best.sheets || '–';
		const u = $('statUtil');
		u.textContent = state.best.sheets ? (state.best.util * 100).toFixed(1) + '%' : '–';
		u.className = state.best.sheets ? 'hot' : '';
		$('statPlaced').textContent = state.best.sheets ? state.best.placed : '–';
		$('statGen').textContent = state.improvements;
	}

	function updateSheetReadout() {
		const f = unitFactor();
		$('sheetReadout').textContent = 'sheet: ' + fmt(state.sheet.w * f) + ' × ' + fmt(state.sheet.h * f) + ' u  (' +
			fmt((state.sheet.w * f) / ENGINE_UPI, 2) + ' × ' + fmt((state.sheet.h * f) / ENGINE_UPI, 2) + ' in)';
		$('statusUnits').textContent = state.sheet.unit === 'px'
			? '1 u = 1 px (import) · 72 u = 1 in'
			: 'units: ' + state.sheet.unit + ' · 72 u = 1 in';
	}

	/* ================= export ================= */

	function exportSvg() {
		if (!state.sheets.length) { setStatus('Nothing to export yet — run the nester first.'); return; }
		const ser = new XMLSerializer();
		const f = unitFactor();
		const W = state.sheet.w * f, H = state.sheet.h * f;
		let out;
		if (state.sheets.length === 1) {
			out = ser.serializeToString(state.sheets[0]);
		} else {
			const gap = 10;
			out = '<svg xmlns="http://www.w3.org/2000/svg" width="' + (state.sheets.length * (W + gap) + gap) + '" height="' + (H + 2 * gap) + '" viewBox="0 ' + (-gap) + ' ' + (state.sheets.length * (W + gap) + gap) + ' ' + (H + 2 * gap) + '">';
			state.sheets.forEach((s, i) => {
				out += '<svg x="' + (gap + i * (W + gap)) + '" y="' + gap + '" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + s.innerHTML + '</svg>';
			});
			out += '</svg>';
		}
		download('deepnest-result-' + state.sheets.length + 'sheets.svg', out);
		setStatus('Exported ' + state.sheets.length + ' sheet(s) as SVG.');
	}

	/* ================= wire up UI ================= */

	$('btnImport').onclick = () => $('fileInput').click();
	$('fileInput').addEventListener('change', (ev) => {
		const files = Array.from(ev.target.files || []);
		(async () => {
			for (const f of files) {
				try { await importSvgText(f.name, await f.text()); }
				catch (e) { setStatus('Could not read "' + f.name + '": ' + e.message); }
			}
		})();
		ev.target.value = '';
	});

	// demo quantities applied to the bundled sample file (matched by name prefix)
	const SAMPLE_QTY = { gear: 4, plate: 4, lbracket: 6, washer: 8, disc: 2, tri: 4, shim: 3 };

	function loadSample() {
		return fetch('sample.svg')
			.then(res => {
				if (!res.ok) throw new Error('sample.svg not found');
				return res.text();
			})
			.then(text => {
				if (!importSvgText('sample.svg', text)) return false;
				for (const p of state.parts) {
					const prefix = p.name.split('-')[0];
					if (SAMPLE_QTY[prefix]) p.qty = SAMPLE_QTY[prefix];
				}
				renderPartList();
				return true;
			})
			.catch(e => setStatus('Could not load sample: ' + e.message));
	}

	$('btnSample').onclick = loadSample;

	$('btnExport').onclick = exportSvg;
	$('btnStart').onclick = startNesting;
	$('btnStop').onclick = stopNesting;
	$('btnEdit').onclick = backToEdit;
	$('btnFit').onclick = fitView;
	$('btnZoomIn').onclick = () => zoomStep(1.25);
	$('btnZoomOut').onclick = () => zoomStep(0.8);

	$('sheetW').addEventListener('input', () => { state.sheet.w = parseFloat($('sheetW').value) || 0; updateSheetReadout(); if (state.mode === 'edit') renderEditView(); });
	$('sheetH').addEventListener('input', () => { state.sheet.h = parseFloat($('sheetH').value) || 0; updateSheetReadout(); if (state.mode === 'edit') renderEditView(); });
	$('sheetUnit').addEventListener('change', () => { state.sheet.unit = $('sheetUnit').value; updateSheetReadout(); if (state.mode === 'edit') renderEditView(); });

	/* ================= init ================= */

	updateSheetReadout();
	applyView();
	renderPartList();
	renderEditView();
	setStatus('Ready. Import SVG parts or load the sample, then press Nest.');

	// auto-load sample (with demo quantities) for an instant start
	loadSample();
})();
