/*
 * Deepnest CAD — Web · UI controller
 *
 * CAD-style editing (select/move/rotate/resize/flip, marquee, measure, draw,
 * multi-sheet stock manager, undo) on top of the Deepnest/SVGnest nesting
 * engine (pure JS, parallel.js web workers). SVG + DXF import, SVG export,
 * improvement history and laser cut-path simulation.
 */
'use strict';

(function () {

	/* ================= state ================= */

	const ENGINE_UPI = 72; // engine units per inch for physically-united SVGs / mm-in conversions
	const GRID = 10;       // snap grid in engine units

	const state = {
		parts: [],        // {id,name,els:[{el,poly,area}],qty,enabled,deleted,color,xf:{dx,dy,rot,s,fx,fy},c0:{x,y},bounds,rotLock,priority}
		sheets: [],       // {id,name,w,h,unit}
		activeSheetId: null,
		cfg: { spacing: 2, rotations: 4, populationSize: 10, mutationRate: 10, curveTolerance: 0.3, useHoles: false, exploreConcave: false },
		material: { name: 'Mild steel', thickness: 3, density: 7.85, priceSheet: 60, machineRate: 0.9, cutSpeed: 2500 },
		remnants: [],     // per-sheet remnant estimate from the last nest
		mode: 'edit',     // 'edit' | 'nest'
		tool: 'select',   // 'select' | 'measure' | 'rect' | 'circle' | 'poly'
		snap: true,
		selection: [],    // part ids, last = primary
		running: false,
		history: [],      // improvement snapshots {sheets:[svg], util, placed}
		histIndex: -1,
		live: true
	};

	let uidPart = 0, uidSheet = 0, uidName = 0;
	const $ = (id) => document.getElementById(id);

	const canvas = $('canvas');
	const world = $('world');
	const content = $('content');
	const overlay = $('overlay');
	const gridG = $('grid');
	const sheetRect = $('sheetRect');
	const viewport = $('viewport');
	const rulerTop = $('rulerTop');
	const rulerLeft = $('rulerLeft');

	const view = { x: 0, y: 0, k: 1 };

	/* ================= helpers ================= */

	function fmt(n, d) { return Number(n).toFixed(d === undefined ? 1 : d); }
	function setStatus(m) { $('statusMsg').textContent = m; }
	function setEngine(run) {
		$('statusEngine').className = 'enginedot' + (run ? ' run' : '');
		$('statusEngineText').textContent = run ? 'nesting…' : 'idle';
	}
	function unitFactor(sheet) {
		const u = (sheet || activeSheet()).unit;
		return u === 'in' ? ENGINE_UPI : (u === 'mm' ? ENGINE_UPI / 25.4 : 1);
	}
	function activeSheet() {
		return state.sheets.find(s => s.id === state.activeSheetId) || state.sheets[0];
	}
	function liveParts() { return state.parts.filter(p => !p.deleted); }
	function selParts() {
		return state.selection.map(id => state.parts.find(p => p.id === id)).filter(p => p && !p.deleted);
	}
	function nextColor(n) { return 'hsl(' + ((n * 47 + 18) % 360) + ' 72% 64%)'; }
	function download(name, text) {
		const blob = new Blob([text], { type: 'image/svg+xml' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = name;
		document.body.appendChild(a);
		a.click();
		setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
	}
	function snapv(v) { return state.snap ? Math.round(v / GRID) * GRID : v; }

	function polygonBoundsOf(poly) {
		let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
		for (const pt of poly) {
			if (pt.x < minx) minx = pt.x;
			if (pt.y < miny) miny = pt.y;
			if (pt.x > maxx) maxx = pt.x;
			if (pt.y > maxy) maxy = pt.y;
		}
		return { x: minx, y: miny, width: maxx - minx, height: maxy - miny };
	}
	function unionBounds(list) {
		if (!list.length) return { x: 0, y: 0, width: 0, height: 0 };
		let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
		for (const b of list) {
			minx = Math.min(minx, b.x); miny = Math.min(miny, b.y);
			maxx = Math.max(maxx, b.x + b.width); maxy = Math.max(maxy, b.y + b.height);
		}
		return { x: minx, y: miny, width: maxx - minx, height: maxy - miny };
	}
	function polyArea(a) {
		let s = 0;
		for (let i = 0; i < a.length; i++) {
			const j = (i + 1) % a.length;
			s += a[i].x * a[j].y - a[j].x * a[i].y;
		}
		return s / 2;
	}

	/* ================= part transforms ================= */
	/* xf = {dx,dy, rot(deg), s(uniform scale), fx,fy(±1)} applied about the
	 * original bbox center c0: translate → rotate → flip/scale, matching the
	 * SVG transform string "translate(dx dy) rotate(r cx cy) translate(cx cy)
	 * scale(s*fx s*fy) translate(-cx -cy)" which the engine bakes on import. */

	function xfString(p) {
		const c = p.c0, f = p.xf;
		return 'translate(' + f.dx + ' ' + f.dy + ')' +
			(f.rot ? ' rotate(' + f.rot + ' ' + c.x + ' ' + c.y + ')' : '') +
			(f.s !== 1 || f.fx < 0 || f.fy < 0
				? ' translate(' + c.x + ' ' + c.y + ') scale(' + (f.s * f.fx) + ' ' + (f.s * f.fy) + ') translate(' + (-c.x) + ' ' + (-c.y) + ')'
				: '');
	}

	function xfPoint(p, pt) {
		const c = p.c0, f = p.xf;
		let x = pt.x, y = pt.y;
		if (f.fx < 0) x = 2 * c.x - x;
		if (f.fy < 0) y = 2 * c.y - y;
		x = c.x + (x - c.x) * f.s;
		y = c.y + (y - c.y) * f.s;
		if (f.rot) {
			const r = f.rot * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
			const ax = x - c.x, ay = y - c.y;
			x = c.x + ax * cs - ay * sn;
			y = c.y + ax * sn + ay * cs;
		}
		return { x: x + f.dx, y: y + f.dy };
	}

	function refreshPartGeom(p) {
		const outer = p.els[0];
		const tp = outer.poly.map(pt => xfPoint(p, pt));
		p.tpoly = tp;
		p.bounds = polygonBoundsOf(tp);
		p.tArea = p.els.reduce((s, m) => s + Math.abs(polyArea(m.poly.map(pt => xfPoint(p, pt)))), 0);
		p.tOuterArea = Math.abs(polyArea(tp));
	}

	/* ================= import ================= */

	function extractPartsFromSvg(svgRoot, filename) {
		const curveTol = state.cfg.curveTolerance;
		const tags = SvgParser.polygonElements.filter(t => t !== 'svg');
		const candidates = [];
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

		// assign each polygon to the smallest polygon that contains it (holes follow their part)
		candidates.sort((a, b) => a.area - b.area);
		const parent = new Map();
		for (let i = 0; i < candidates.length; i++) {
			for (let j = 0; j < candidates.length; j++) {
				if (j === i || candidates[j].area < candidates[i].area) continue;
				if (contains(candidates[j].poly, candidates[i].poly)) {
					parent.set(candidates[i], candidates[j]);
					break;
				}
			}
		}

		const base = (filename || 'part').replace(/\.(svg|dxf)$/i, '');
		const roots = candidates.filter(c => !parent.has(c));
		const made = [];
		roots.forEach((c) => {
			const members = [c];
			for (const [child, par] of parent) {
				let p = par, guard = 0;
				while (p && guard++ < 50) {
					if (p === c) { members.push(child); break; }
					p = parent.get(p);
				}
			}
			const name = c.el.getAttribute('data-name') || c.el.getAttribute('id') || (base + ' ' + (made.length + 1));
			const part = makePart(name, members);
			made.push(part);
		});
		return made;

		function contains(outer, inner) {
			if (GeometryUtil.pointInPolygon(inner[0], outer) !== true) return false;
			let cx = 0, cy = 0;
			for (const pt of inner) { cx += pt.x; cy += pt.y; }
			return GeometryUtil.pointInPolygon({ x: cx / inner.length, y: cy / inner.length }, outer) === true;
		}
	}

	function makePart(name, members) {
		const p = {
			id: uidPart++,
			name: name,
			els: members,
			qty: 1,
			deleted: false,
			rotLock: false,
			priority: 0,
			color: nextColor(uidPart),
			xf: { dx: 0, dy: 0, rot: 0, s: 1, fx: 1, fy: 1 }
		};
		const b = polygonBoundsOf(members[0].poly);
		p.c0 = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
		refreshPartGeom(p);
		return p;
	}

	function importSvgText(filename, text) {
		try {
			let svg = SvgParser.load(null, text, ENGINE_UPI, null);
			svg = SvgParser.clean(false);
			const parts = extractPartsFromSvg(svg, filename);
			if (parts.length === 0) {
				setStatus('"' + filename + '": no closed shapes found — nothing imported.');
				return false;
			}
			state.parts.push(...parts);
			clearSelection();
			renderPartList();
			if (state.mode === 'edit') renderEditView();
			fitView();
			updateJobStats();
			setStatus('Imported ' + parts.length + ' part(s) from "' + filename + '".');
			return true;
		} catch (err) {
			console.error(err);
			setStatus('Import failed for "' + filename + '": ' + err.message);
			return false;
		}
	}

	/* ---- minimal DXF parser: LINE, LWPOLYLINE, POLYLINE/VERTEX, CIRCLE, ARC ---- */

	function dxfToSvgText(text, unit) {
		const lines = text.split(/\r\n|\r|\n/);
		const ents = [];
		let cur = null, val = null, inEntities = false;
		const plines = []; // finished polylines {pts:[], closed}
		let curPL = null;

		function flushPL() { if (curPL && curPL.pts.length > 1) plines.push(curPL); curPL = null; }

		for (let i = 0; i < lines.length; i++) {
			const code = lines[i].trim();
			i++;
			if (i >= lines.length) break;
			const value = lines[i].trim();
			if (code === '0') {
				// entity boundary
				if (cur === 'SEQEND') { flushPL(); }
				if (cur === 'POLYLINE' && value !== 'VERTEX' && value !== 'SEQEND') { flushPL(); }
				if (cur === 'VERTEX' && value !== 'VERTEX' && value !== 'SEQEND') { flushPL(); }
				if (cur === 'LWPOLYLINE' && value !== 'LWPOLYLINE') { flushPL(); }
				if (value === 'SECTION') { cur = 'SECTION'; val = null; continue; }
				if (value === 'ENDSEC') { inEntities = false; cur = null; continue; }
				cur = value; val = null;
				if (!inEntities) continue;
				if (cur === 'LINE') ents.push({ t: 'line' });
				else if (cur === 'CIRCLE') ents.push({ t: 'circle' });
				else if (cur === 'ARC') ents.push({ t: 'arc' });
				else if (cur === 'LWPOLYLINE') { flushPL(); curPL = { pts: [], closed: false, entRef: ents.length }; ents.push({ t: 'pl' }); }
				else if (cur === 'POLYLINE') { flushPL(); curPL = { pts: [], closed: false, entRef: ents.length }; ents.push({ t: 'pl' }); }
				continue;
			}
			if (code === '2' && value === 'ENTITIES') { inEntities = true; continue; }
			if (!inEntities) continue;
			const num = parseFloat(value);
			const e = ents[ents.length - 1];
			if (!e && !(curPL && curPL.entRef === ents.length)) continue;
			switch (code) {
				case '10': if (curPL && curPL.entRef === ents.length - 1) curPL._x = num; else if (e) e.x1 = num; break;
				case '20': if (curPL && curPL.entRef === ents.length - 1) { if (curPL._x !== undefined) curPL.pts.push({ x: curPL._x, y: num }); curPL._x = undefined; } else if (e) e.y1 = num; break;
				case '11': if (e) e.x2 = num; break;
				case '21': if (e) e.y2 = num; break;
				case '40': if (e) e.r = num; break;
				case '50': if (e) e.a1 = num; break;
				case '51': if (e) e.a2 = num; break;
				case '70': if (curPL && curPL.entRef === ents.length - 1) curPL.closed = (num & 1) === 1; else if (e) e.closed = (num & 1) === 1; break;
			}
		}
		flushPL();
		// move polyline pts into their entities
		for (const pl of plines) { if (ents[pl.entRef]) ents[pl.entRef].pts = pl.pts, ents[pl.entRef].closed = pl.closed; }

		const shapes = [];
		for (const e of ents) {
			if (e.t === 'line' && e.x1 !== undefined) {
				shapes.push('<line x1="' + e.x1 + '" y1="' + e.y1 + '" x2="' + e.x2 + '" y2="' + e.y2 + '"/>');
			} else if (e.t === 'circle' && e.r) {
				shapes.push('<circle cx="' + e.x1 + '" cy="' + e.y1 + '" r="' + e.r + '"/>');
			} else if (e.t === 'arc' && e.r) {
				shapes.push('<polygon points="' + arcPts(e.x1, e.y1, e.r, e.a1 || 0, e.a2 || 360).map(p => p.x.toFixed(3) + ',' + p.y.toFixed(3)).join(' ') + '"/>');
			} else if (e.t === 'pl' && e.pts && e.pts.length > 2) {
				shapes.push('<polygon points="' + e.pts.map(p => p.x.toFixed(3) + ',' + p.y.toFixed(3)).join(' ') + '"/>');
			}
		}
		if (!shapes.length) return null;

		// bounding box for viewBox + physical width (so the parser converts units → 72/in)
		let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
		const allPts = [];
		for (const s of shapes) {
			const nums = s.match(/-?\d+\.?\d*(e-?\d+)?/g);
			if (!nums) continue;
			for (let i = 0; i + 1 < nums.length; i += 2) {
				const x = parseFloat(nums[i]), y = parseFloat(nums[i + 1]);
				if (isFinite(x) && isFinite(y)) allPts.push({ x, y });
			}
		}
		for (const p of allPts) {
			minx = Math.min(minx, p.x); miny = Math.min(miny, p.y);
			maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y);
		}
		const w = Math.max(1, maxx - minx), h = Math.max(1, maxy - miny);
		const physW = unit === 'in' ? w + 'in' : w + 'mm';
		// DXF y-axis points up — flip y via transform on a wrapper group
		return '<svg xmlns="http://www.w3.org/2000/svg" width="' + physW + '" viewBox="0 0 ' + w + ' ' + h + '">' +
			'<g transform="translate(' + (-minx) + ',' + maxy + ') scale(1,-1)">' + shapes.join('') + '</g></svg>';

		function arcPts(cx, cy, r, a1, a2) {
			let s = a1, eA = a2;
			while (eA < s) eA += 360;
			const n = Math.max(8, Math.ceil((eA - s) / 10));
			const pts = [];
			for (let i = 0; i <= n; i++) {
				const a = (s + (eA - s) * i / n) * Math.PI / 180;
				pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
			}
			return pts;
		}
	}

	function importDxfText(filename, text) {
		const unit = $('dxfUnit').value;
		const svgText = dxfToSvgText(text, unit);
		if (!svgText) { setStatus('"' + filename + '": no supported DXF entities (LINE/LWPOLYLINE/POLYLINE/CIRCLE/ARC) found.'); return false; }
		return importSvgText(filename, svgText);
	}

	/* ================= parts panel ================= */

	function renderPartList() {
		const ul = $('partList');
		ul.innerHTML = '';
		const parts = liveParts();
		$('partCount').textContent = parts.length;
		$('partsEmpty').style.display = parts.length ? 'none' : 'block';

		parts.forEach((p) => {
			const li = document.createElement('li');
			li.dataset.partId = p.id;
			if (state.selection.indexOf(p.id) >= 0) li.classList.add('selected');

			const cv = document.createElement('canvas');
			cv.className = 'swatch';
			cv.width = 52; cv.height = 52;
			drawThumb(cv, p);

			const meta = document.createElement('div');
			meta.className = 'partmeta';
			meta.innerHTML = '<div class="partname"></div><div class="partsub"></div>';
			meta.querySelector('.partname').textContent = p.name;
			meta.querySelector('.partsub').textContent =
				fmt(p.bounds.width, 0) + '×' + fmt(p.bounds.height, 0) + ' u · qty ' + p.qty;

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
		const b = p.bounds;
		const s = Math.min((cv.width - 6) / (b.width || 1), (cv.height - 6) / (b.height || 1));
		ctx.save();
		ctx.translate(cv.width / 2, cv.height / 2);
		ctx.scale(s, -s);
		ctx.translate(-(b.x + b.width / 2), -(b.y + b.height / 2));
		ctx.strokeStyle = p.color;
		ctx.fillStyle = p.color;
		ctx.lineWidth = 1.2 / s;
		for (let mi = 0; mi < p.els.length; mi++) {
			const poly = p.els[mi].poly.map(pt => xfPoint(p, pt));
			ctx.beginPath();
			ctx.moveTo(poly[0].x, poly[0].y);
			for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
			ctx.closePath();
			ctx.globalAlpha = mi === 0 ? 0.25 : 0.55;
			ctx.fill();
			ctx.globalAlpha = 0.9;
			ctx.stroke();
		}
		ctx.restore();
	}

	$('partList').addEventListener('click', (ev) => {
		const li = ev.target.closest('li');
		if (!li) return;
		const p = state.parts.find(q => q.id === +li.dataset.partId);
		if (!p) return;
		const act = ev.target.dataset && ev.target.dataset.a;
		if (act === 'inc') { pushUndo(); p.qty++; }
		else if (act === 'dec') { if (p.qty > 0) { pushUndo(); p.qty = Math.max(0, p.qty - 1); } }
		else if (act === 'del') { pushUndo(); p.deleted = true; removeFromSelection(p.id); }
		else {
			const idx = state.selection.indexOf(p.id);
			if (ev.shiftKey) { if (idx >= 0) state.selection.splice(idx, 1); else state.selection.push(p.id); }
			else state.selection = idx >= 0 ? [] : [p.id];
		}
		renderPartList();
		if (state.mode === 'edit') { renderEditView(); renderOverlay(); }
		syncSelectionPanel();
	});

	/* ================= view: pan / zoom / rulers / grid ================= */

	function applyView() {
		world.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.k + ')');
		$('zoomLabel').textContent = Math.round(view.k * 100) + '%';
		drawGrid();
		drawRulers();
	}

	function screenToWorld(sx, sy) {
		const r = canvas.getBoundingClientRect();
		return { x: (sx - r.left - view.x) / view.k, y: (sy - r.top - view.y) / view.k };
	}

	let fitRetries = 0;
	function fitView() {
		const r = canvas.getBoundingClientRect();
		if (r.width < 10 || r.height < 10) {
			// layout not ready yet (mobile drawers, orientation change) — retry briefly
			if (fitRetries++ < 90) requestAnimationFrame(fitView);
			return;
		}
		fitRetries = 0;
		const sh = activeSheet(), f = unitFactor();
		const boxes = [{ x: 0, y: 0, width: sh.w * f, height: sh.h * f }];
		if (state.mode === 'edit') for (const p of liveParts()) boxes.push(p.bounds);
		const b = unionBounds(boxes);
		const k = Math.min(r.width / (b.width || 1), r.height / (b.height || 1)) * 0.86;
		view.k = Math.max(0.005, Math.min(k, 400));
		view.x = r.width / 2 - (b.x + b.width / 2) * view.k;
		view.y = r.height / 2 - (b.y + b.height / 2) * view.k;
		applyView();
	}

	function zoomAt(mx, my, factor) {
		const k2 = Math.max(0.005, Math.min(view.k * factor, 400));
		view.x = mx - (mx - view.x) * (k2 / view.k);
		view.y = my - (my - view.y) * (k2 / view.k);
		view.k = k2;
		applyView();
	}
	function zoomStep(f) {
		const r = canvas.getBoundingClientRect();
		zoomAt(r.width / 2, r.height / 2, f);
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
		const x0 = Math.floor(w0.x / step) * step, y0 = Math.floor(w0.y / step) * step;
		for (let x = x0; x <= w1.x; x += step) {
			const M = Math.abs(x / major - Math.round(x / major)) < 0.01;
			const seg = 'M' + x + ' ' + w0.y + 'V' + w1.y;
			if (Math.abs(x) < step * 0.01) dAxis += seg;
			else if (M) dMajor += seg;
			else dMinor += seg;
		}
		for (let y = y0; y <= w1.y; y += step) {
			const M = Math.abs(y / major - Math.round(y / major)) < 0.01;
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

	function drawRulers() {
		const wr = canvas.getBoundingClientRect();
		if (wr.width < 10) return;
		const w0 = screenToWorld(wr.left, wr.top), w1 = screenToWorld(wr.right, wr.bottom);
		const step = niceStep((w1.x - w0.x) / Math.max(6, wr.width / 90));
		const sub = step / 5;
		const NS = 'http://www.w3.org/2000/svg';
		let t = '', l = '';
		for (let x = Math.floor(w0.x / sub) * sub; x <= w1.x; x += sub) {
			const sx = (x - w0.x) * view.k;
			const isMajor = Math.abs(x / step - Math.round(x / step)) < 0.01;
			t += '<line x1="' + sx + '" y1="' + (isMajor ? 8 : 15) + '" x2="' + sx + '" y2="22" stroke="#4a4f58" stroke-width="1"/>';
			if (isMajor) t += '<text x="' + (sx + 3) + '" y="9" fill="#79808a" font-size="9" font-family="Consolas,monospace">' + Math.round(x) + '</text>';
		}
		for (let y = Math.floor(w0.y / sub) * sub; y <= w1.y; y += sub) {
			const sy = (y - w0.y) * view.k;
			const isMajor = Math.abs(y / step - Math.round(y / step)) < 0.01;
			l += '<line x1="' + (isMajor ? 8 : 15) + '" y1="' + sy + '" x2="22" y2="' + sy + '" stroke="#4a4f58" stroke-width="1"/>';
			if (isMajor) l += '<text x="2" y="' + (sy - 3) + '" fill="#79808a" font-size="9" font-family="Consolas,monospace" transform="rotate(-90 8 ' + sy + ')">' + Math.round(y) + '</text>';
		}
		rulerTop.setAttribute('viewBox', '0 0 ' + wr.width + ' 22');
		rulerTop.innerHTML = '<rect x="0" y="0" width="' + wr.width + '" height="22" fill="#1b1d21"/>' + t;
		rulerLeft.setAttribute('viewBox', '0 0 22 ' + wr.height);
		rulerLeft.innerHTML = '<rect x="0" y="0" width="22" height="' + wr.height + '" fill="#1b1d21"/>' + l;
	}

	/* ================= edit view ================= */

	function renderEditView() {
		content.innerHTML = '';
		overlay.innerHTML = '';
		$('sheetTabs').classList.add('hidden');
		$('simbar').classList.add('hidden');
		$('viewBadge').textContent = 'EDIT';

		const sh = activeSheet(), f = unitFactor();
		sheetRect.setAttribute('x', 0);
		sheetRect.setAttribute('y', 0);
		sheetRect.setAttribute('width', sh.w * f);
		sheetRect.setAttribute('height', sh.h * f);
		sheetRect.setAttribute('class', 'binrect');
		sheetRect.setAttribute('visibility', 'visible');

		for (const p of liveParts()) {
			const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
			g.setAttribute('class', 'partgroup' + (state.selection.indexOf(p.id) >= 0 ? ' selected' : ''));
			g.dataset.partId = p.id;
			g.setAttribute('transform', xfString(p));
			g.setAttribute('style', 'color:' + p.color);
			for (let mi = 0; mi < p.els.length; mi++) {
				const el = document.importNode(p.els[mi].el.cloneNode(true), true);
				el.setAttribute('class', 'part' + (mi > 0 ? ' holepiece' : ''));
				el.removeAttribute('id');
				el.removeAttribute('transform');
				g.appendChild(el);
			}
			content.appendChild(g);
		}
		renderOverlay();
	}

	function refreshPartDisplay(p) {
		const g = content.querySelector('.partgroup[data-part-id="' + p.id + '"]');
		if (g) g.setAttribute('transform', xfString(p));
	}

	/* ================= selection & overlay ================= */

	function clearSelection() { state.selection = []; }
	function removeFromSelection(id) {
		const i = state.selection.indexOf(id);
		if (i >= 0) state.selection.splice(i, 1);
	}

	function renderOverlay() {
		overlay.innerHTML = '';
		if (state.mode !== 'edit' || state.tool !== 'select') { return; }
		const sel = selParts();
		// outlines for all selected
		for (const p of sel) {
			const b = p.bounds;
			overlay.innerHTML += '<rect class="selbox" x="' + b.x + '" y="' + b.y + '" width="' + b.width + '" height="' + b.height + '"/>';
		}
		// handles on primary
		const P = sel[sel.length - 1];
		if (P) {
			const b = P.bounds, hs = 7 / view.k;
			const corners = [
				[b.x, b.y], [b.x + b.width, b.y],
				[b.x + b.width, b.y + b.height], [b.x, b.y + b.height]
			];
			corners.forEach(c => {
				overlay.innerHTML += '<rect class="selhandle" data-h="scale" data-cx="' + c[0] + '" data-cy="' + c[1] +
					'" x="' + (c[0] - hs / 2) + '" y="' + (c[1] - hs / 2) + '" width="' + hs + '" height="' + hs + '"/>';
			});
			const rx = b.x + b.width / 2, ry = b.y - 22 / view.k;
			overlay.innerHTML += '<line class="selbox" x1="' + rx + '" y1="' + b.y + '" x2="' + rx + '" y2="' + ry + '"/>' +
				'<circle class="selhandle rot" data-h="rot" cx="' + rx + '" cy="' + ry + '" r="' + (5 / view.k) + '"/>';
		}
	}

	function setSelection(ids) { state.selection = ids; renderPartList(); renderEditSelection(); renderOverlay(); syncSelectionPanel(); }

	function renderEditSelection() {
		content.querySelectorAll('.partgroup').forEach(g => {
			g.classList.toggle('selected', state.selection.indexOf(+g.dataset.partId) >= 0);
		});
	}

	/* ================= properties panel ================= */

	function syncSelectionPanel() {
		const sel = selParts();
		const panel = $('selPanel');
		if (!sel.length || state.mode !== 'edit') { panel.style.display = 'none'; return; }
		panel.style.display = 'block';
		const P = sel[sel.length - 1];
		$('selName').value = sel.length > 1 ? sel.length + ' parts selected' : P.name;
		$('selQty').textContent = P.qty;
		$('selRot').value = Math.round(P.xf.rot * 10) / 10;
		$('selW').value = Math.round(P.bounds.width * 10) / 10;
		$('selH').value = Math.round(P.bounds.height * 10) / 10;
		$('selLockRot').checked = !!P.rotLock;
		$('selPriority').value = String(P.priority || 0);
		$('selLockRot').disabled = sel.length > 1;
		$('selPriority').disabled = sel.length > 1;
		$('selInfo').textContent = 'area ' + fmt(P.tArea / 1e4, 2) + 'k u² · pos ' + fmt(P.bounds.x) + ',' + fmt(P.bounds.y) +
			(sel.length > 1 ? ' · editing primary of ' + sel.length : '');
	}

	$('selQtyInc').onclick = () => { const P = selParts().pop(); if (P) { pushUndo(); P.qty++; afterEdit(); } };
	$('selQtyDec').onclick = () => { const P = selParts().pop(); if (P && P.qty > 0) { pushUndo(); P.qty--; afterEdit(); } };
	$('selRot').addEventListener('change', () => {
		const P = selParts().pop(); if (!P) return;
		pushUndo(); P.xf.rot = parseFloat($('selRot').value) || 0; refreshPartGeom(P); afterEdit();
	});
	$('selW').addEventListener('change', () => scaleTo('w'));
	$('selH').addEventListener('change', () => scaleTo('h'));
	$('selName').addEventListener('change', () => {
		const P = selParts().pop();
		if (P && selParts().length <= 1) { P.name = $('selName').value || P.name; renderPartList(); }
	});
	function scaleTo(dim) {
		const P = selParts().pop(); if (!P) return;
		const v = parseFloat($(dim === 'w' ? 'selW' : 'selH').value);
		const orig = dim === 'w'
			? polygonBoundsOf(P.els[0].poly).width
			: polygonBoundsOf(P.els[0].poly).height;
		if (!v || !orig) return;
		pushUndo();
		P.xf.s = Math.max(0.01, v / orig);
		refreshPartGeom(P); afterEdit();
		setStatus('Resized to ' + fmt(P.bounds.width) + ' × ' + fmt(P.bounds.height) + ' u (scale ' + fmt(P.xf.s, 2) + '×).');
	}
	function flipSel(axis) {
		const sel = selParts(); if (!sel.length) return;
		pushUndo();
		for (const P of sel) { if (axis === 'h') P.xf.fx *= -1; else P.xf.fy *= -1; refreshPartGeom(P); }
		afterEdit();
	}
	function rotSel(deg) {
		const sel = selParts(); if (!sel.length) return;
		pushUndo();
		for (const P of sel) { P.xf.rot = (P.xf.rot + deg) % 360; refreshPartGeom(P); }
		afterEdit();
	}
	function dupSel() {
		const sel = selParts(); if (!sel.length) return;
		pushUndo();
		const newIds = [];
		for (const P of sel) {
			const c = makePart(P.name + ' copy', P.els);
			c.qty = P.qty;
			c.xf = Object.assign({}, P.xf, { dx: P.xf.dx + snapv(20), dy: P.xf.dy + snapv(20) });
			refreshPartGeom(c);
			state.parts.push(c);
			newIds.push(c.id);
		}
		setSelection(newIds);
		afterEdit();
		setStatus('Duplicated ' + newIds.length + ' part(s).');
	}
	function delSel() {
		const sel = selParts(); if (!sel.length) return;
		pushUndo();
		for (const P of sel) P.deleted = true;
		clearSelection();
		afterEdit();
		setStatus('Deleted ' + sel.length + ' part(s). Ctrl+Z to undo.');
	}
	function afterEdit() {
		renderPartList();
		if (state.mode === 'edit') {
			renderEditView();
			syncSelectionPanel();
			fitSelectionIfOffscreen();
		}
		updateJobStats();
	}
	function fitSelectionIfOffscreen() {
		// keep overlay accurate; no forced camera move
		renderOverlay();
	}

	$('selFlipH').onclick = () => flipSel('h');
	$('selFlipV').onclick = () => flipSel('v');
	$('selDup').onclick = dupSel;
	$('selDel').onclick = delSel;
	$('selLockRot').addEventListener('change', () => {
		const sel = selParts(); if (!sel.length) return;
		pushUndo();
		for (const P of sel) P.rotLock = $('selLockRot').checked;
		setStatus(sel.length > 1
			? sel.length + ' parts: rotation ' + ($('selLockRot').checked ? 'LOCKED (0° only during nesting)' : 'free (follows global rotations).')
			: '"' + sel[0].name + '": rotation ' + ($('selLockRot').checked ? 'LOCKED (0° only during nesting)' : 'free (follows global rotations).'));
	});
	$('selPriority').addEventListener('change', () => {
		const sel = selParts(); if (!sel.length) return;
		pushUndo();
		for (const P of sel) P.priority = parseInt($('selPriority').value, 10) || 0;
		setStatus('Nest priority updated — high-priority parts are placed first.');
	});
	$('railFlipH').onclick = () => flipSel('h');
	$('railFlipV').onclick = () => flipSel('v');
	$('railRotL').onclick = () => rotSel(-90);
	$('railRotR').onclick = () => rotSel(90);
	$('railDup').onclick = dupSel;
	$('railDel').onclick = delSel;

	/* ================= undo / redo ================= */

	const undoStack = [], redoStack = [];
	function snapshot() {
		return liveParts().map(p => ({ id: p.id, name: p.name, qty: p.qty, deleted: p.deleted, xf: Object.assign({}, p.xf) }));
	}
	function pushUndo() {
		undoStack.push(snapshot());
		if (undoStack.length > 60) undoStack.shift();
		redoStack.length = 0;
		$('btnUndo').disabled = false;
		$('btnRedo').disabled = true;
	}
	function applySnap(snap) {
		clearSelection();
		const ids = new Set(snap.map(s => s.id));
		for (const s of snap) {
			const p = state.parts.find(q => q.id === s.id);
			if (!p) continue;
			p.name = s.name; p.qty = s.qty; p.deleted = s.deleted; p.xf = Object.assign({}, s.xf);
			refreshPartGeom(p);
		}
		// parts created after the snapshot didn't exist then — remove them
		for (const p of state.parts) {
			if (!ids.has(p.id) && !p.deleted) { p.deleted = true; }
		}
		renderPartList();
		if (state.mode === 'edit') { renderEditView(); syncSelectionPanel(); }
	}
	function undo() {
		if (!undoStack.length) return;
		redoStack.push(snapshot());
		applySnap(undoStack.pop());
		$('btnRedo').disabled = false;
		$('btnUndo').disabled = undoStack.length === 0;
		setStatus('Undo.');
	}
	function redo() {
		if (!redoStack.length) return;
		undoStack.push(snapshot());
		applySnap(redoStack.pop());
		$('btnUndo').disabled = false;
		$('btnRedo').disabled = redoStack.length === 0;
		setStatus('Redo.');
	}
	$('btnUndo').onclick = undo;
	$('btnRedo').onclick = redo;

	/* ================= tools & pointer interaction ================= */

	let drag = null;   // interaction state
	let measurePts = [];

	function setTool(t) {
		state.tool = t;
		document.querySelectorAll('.railbtn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
		viewport.className = 'tool-' + t;
		$('statusTool').textContent = 'TOOL: ' + t.toUpperCase();
		measurePts = [];
		cancelPolygon();
		$('polyBar').classList.toggle('hidden', t !== 'poly');
		if (state.mode === 'edit') renderOverlay();
	}

	/* ---- polygon draw tool: click vertices, close via double-click/Enter/first point ---- */

	let polyPts = [];

	function polyPreview(cursorW) {
		overlay.querySelectorAll('.polyprev').forEach(e => e.remove());
		if (!polyPts.length || state.tool !== 'poly') return;
		const pts = polyPts.map(p => p.x + ',' + p.y);
		if (cursorW) pts.push(cursorW.x + ',' + cursorW.y);
		overlay.appendChild(mk('polyline', { class: 'polyprev measureline', points: pts.join(' ') }));
		for (const pt of polyPts) {
			overlay.appendChild(mk('circle', { class: 'polyprev measureline', cx: pt.x, cy: pt.y, r: 3 / view.k, fill: '#4dd0e1' }));
		}
	}

	function finishPolygon() {
		if (polyPts.length < 3) { setStatus('Polygon needs at least 3 vertices — click to place points.'); return; }
		const el = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
		el.setAttribute('points', polyPts.map(p => p.x.toFixed(2) + ',' + p.y.toFixed(2)).join(' '));
		let poly;
		try { poly = SvgParser.polygonify(el); } catch (e) { polyPts = []; polyPreview(); return; }
		const p = makePart('Polygon ' + (++uidName), [{ el: el, poly: poly, area: Math.abs(polyArea(poly)) }]);
		state.parts.push(p);
		polyPts = [];
		polyPreview();
		setSelection([p.id]);
		renderPartList(); renderEditView(); syncSelectionPanel();
		setTool('select');
		fitView();
		setStatus('Created part "' + p.name + '" (' + poly.length + ' vertices).');
	}

	function cancelPolygon() {
		if (!polyPts.length) return;
		polyPts = [];
		polyPreview();
	}
	document.querySelectorAll('.railbtn[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));

	function onDown(ev) {
		if (ev.pointerType === 'mouse' && ev.button !== 0 && ev.button !== 1) return;
		if (ev.button === 1 || ev.buttons === 4 || spaceHeld) { drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y }; return; }
		if (ev.button !== 0) return;
		const w = screenToWorld(ev.clientX, ev.clientY);

		if (state.mode === 'nest') { drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y }; return; }

		const handle = ev.target.closest ? ev.target.closest('.selhandle') : null;
		if (state.tool === 'select' && handle) {
			const sel = selParts();
			const P = sel[sel.length - 1];
			if (!P) return;
			pushUndo();
			if (handle.dataset.h === 'rot') {
				drag = { kind: 'rotate', P, c: { x: P.bounds.x + P.bounds.width / 2, y: P.bounds.y + P.bounds.height / 2 }, a0: Math.atan2(w.y - P.c0.y - P.xf.dy - (P.bounds.y + P.bounds.height / 2 - P.c0.y - P.xf.dy), w.x - P.c0.x - P.xf.dx - (P.bounds.x + P.bounds.width / 2 - P.c0.x - P.xf.dx)), r0: P.xf.rot };
				drag.a0 = Math.atan2(w.y - drag.c.y, w.x - drag.c.x);
			} else {
				drag = { kind: 'scale', P, cx: +handle.dataset.cx, cy: +handle.dataset.cy, s0: P.xf.s, d0: Math.max(1e-6, Math.hypot(w.x - (+handle.dataset.cx), w.y - (+handle.dataset.cy))) };
			}
			return;
		}

		if (state.tool === 'measure') {
			measurePts.push(w);
			if (measurePts.length === 2) {
				const d = Math.hypot(measurePts[1].x - measurePts[0].x, measurePts[1].y - measurePts[0].y);
				setStatus('Measured: ' + fmt(d) + ' u  =  ' + fmt(d / ENGINE_UPI, 2) + ' in  =  ' + fmt(d / (ENGINE_UPI / 25.4), 2) + ' mm');
				overlay.innerHTML += '<line class="measureline" x1="' + measurePts[0].x + '" y1="' + measurePts[0].y + '" x2="' + measurePts[1].x + '" y2="' + measurePts[1].y + '"/>' +
					'<text class="measurelabel" x="' + (measurePts[0].x + measurePts[1].x) / 2 + '" y="' + ((measurePts[0].y + measurePts[1].y) / 2 - 6 / view.k) + '" text-anchor="middle">' + fmt(d) + ' u</text>';
				measurePts = [];
			} else {
				overlay.innerHTML += '<circle class="measureline" cx="' + w.x + '" cy="' + w.y + '" r="' + 3 / view.k + '"/>';
			}
			return;
		}

		if (state.tool === 'rect' || state.tool === 'circle') {
			drag = { kind: 'draw', tool: state.tool, x0: snapv(w.x), y0: snapv(w.y), tmp: null };
			return;
		}

		if (state.tool === 'poly') {
			const wpt = { x: snapv(w.x), y: snapv(w.y) };
			if (polyPts.length) {
				const last = polyPts[polyPts.length - 1];
				if (Math.hypot(wpt.x - last.x, wpt.y - last.y) < 0.01) return; // double-click dedupe
				if (polyPts.length >= 3 && Math.hypot(w.x - polyPts[0].x, w.y - polyPts[0].y) * view.k < 10) {
					if (Math.hypot(wpt.x - polyPts[0].x, wpt.y - polyPts[0].y) >= 0.01) polyPts.push(wpt);
					finishPolygon();
					return;
				}
			}
			polyPts.push(wpt);
			polyPreview();
			return;
		}

		// select tool
		const pg = ev.target.closest ? ev.target.closest('.partgroup') : null;
		if (pg) {
			const id = +pg.dataset.partId;
			if (ev.shiftKey) {
				const i = state.selection.indexOf(id);
				if (i >= 0) state.selection.splice(i, 1); else state.selection.push(id);
			} else if (state.selection.indexOf(id) < 0) {
				state.selection = [id];
			}
			const sel = selParts();
			pushUndo();
			drag = { kind: 'move', sx: w.x, sy: w.y, orig: sel.map(P => ({ P, dx: P.xf.dx, dy: P.xf.dy })), moved: false };
			renderPartList(); renderEditSelection(); renderOverlay(); syncSelectionPanel();
			return;
		}
		// empty space → marquee
		clearSelection();
		renderPartList(); renderEditSelection(); renderOverlay(); syncSelectionPanel();
		drag = { kind: 'marquee', x0: w.x, y0: w.y, add: ev.shiftKey, base: ev.shiftKey ? state.selection.slice() : [] };
	}

	function onMove(ev) {
		// crosshair + coords
		const r = canvas.getBoundingClientRect();
		const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
		const showX = inside && !state.running;
		$('crosshairV').classList.toggle('hidden', !showX);
		$('crosshairH').classList.toggle('hidden', !showX);
		if (inside) {
			$('crosshairV').style.left = (ev.clientX - r.left) + 'px';
			$('crosshairH').style.top = (ev.clientY - r.top) + 'px';
			const w = screenToWorld(ev.clientX, ev.clientY);
			$('statusCoords').textContent = 'x ' + fmt(w.x) + '  y ' + fmt(w.y);
			if (state.tool === 'poly' && polyPts.length) polyPreview({ x: snapv(w.x), y: snapv(w.y) });
		}

		if (!drag) return;
		if (drag.kind === 'pan') {
			view.x = drag.vx + (ev.clientX - drag.sx);
			view.y = drag.vy + (ev.clientY - drag.sy);
			viewport.classList.add('panning');
			applyView();
			return;
		}
		const w = screenToWorld(ev.clientX, ev.clientY);

		if (drag.kind === 'move') {
			let dx = w.x - drag.sx, dy = w.y - drag.sy;
			if (state.snap) { dx = Math.round(dx / GRID) * GRID; dy = Math.round(dy / GRID) * GRID; }
			if (Math.abs(dx) + Math.abs(dy) > 0) drag.moved = true;
			for (const o of drag.orig) { o.P.xf.dx = o.dx + dx; o.P.xf.dy = o.dy + dy; refreshPartGeom(o.P); refreshPartDisplay(o.P); }
			renderOverlay();
		} else if (drag.kind === 'rotate') {
			const a = Math.atan2(w.y - drag.c.y, w.x - drag.c.x);
			let deg = drag.r0 + (a - drag.a0) * 180 / Math.PI;
			if (state.snap) deg = Math.round(deg / 15) * 15;
			drag.P.xf.rot = Math.round(deg * 10) / 10;
			refreshPartGeom(drag.P);
			refreshPartDisplay(drag.P);
			renderOverlay();
			$('statusCoords').textContent = 'rot ' + fmt(drag.P.xf.rot, 1) + '°';
		} else if (drag.kind === 'scale') {
			const d = Math.hypot(w.x - drag.cx, w.y - drag.cy);
			let s = drag.s0 * d / drag.d0;
			if (state.snap) s = Math.max(0.05, Math.round(s * 20) / 20);
			drag.P.xf.s = Math.max(0.02, s);
			refreshPartGeom(drag.P);
			refreshPartDisplay(drag.P);
			renderOverlay();
			$('statusCoords').textContent = 'scale ' + fmt(drag.P.xf.s, 2) + '×';
		} else if (drag.kind === 'marquee') {
			const b = normRect(drag.x0, drag.y0, w.x, w.y);
			let m = overlay.querySelector('.marquee');
			if (!m) { m = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); m.setAttribute('class', 'marquee'); overlay.appendChild(m); }
			m.setAttribute('x', b.x); m.setAttribute('y', b.y);
			m.setAttribute('width', b.width); m.setAttribute('height', b.height);
			drag.rect = b;
		} else if (drag.kind === 'draw') {
			const x1 = snapv(w.x), y1 = snapv(w.y);
			const b = normRect(drag.x0, drag.y0, x1, y1);
			if (drag.tmp) drag.tmp.remove();
			if (drag.tool === 'rect') {
				drag.tmp = mk('rect', { x: b.x, y: b.y, width: b.width, height: b.height, class: 'measureline' });
			} else {
				const rr = Math.max(b.width, b.height) / 2;
				drag.tmp = mk('circle', { cx: b.x + b.width / 2, cy: b.y + b.height / 2, r: rr, class: 'measureline' });
			}
			overlay.appendChild(drag.tmp);
		}
	}

	function onUp(ev) {
		if (!drag) return;
		const d = drag; drag = null;
		viewport.classList.remove('panning');

		if (d.kind === 'marquee' && d.rect) {
			overlay.querySelectorAll('.marquee').forEach(m => m.remove());
			const hit = liveParts().filter(p => rectsIntersect(d.rect, p.bounds)).map(p => p.id);
			state.selection = d.add ? Array.from(new Set(d.base.concat(hit))) : hit;
			renderPartList(); renderEditSelection(); renderOverlay(); syncSelectionPanel();
			if (hit.length) setStatus('Selected ' + hit.length + ' part(s).');
		} else if (d.kind === 'move' && !d.moved) {
			undoStack.pop(); // click without move: drop the undo entry
		} else if (d.kind === 'scale' || d.kind === 'rotate') {
			refreshPartGeom(d.P); renderPartList(); syncSelectionPanel(); renderOverlay();
		} else if (d.kind === 'draw') {
			if (d.tmp) d.tmp.remove();
			const w = screenToWorld(ev.clientX, ev.clientY);
			let el, name;
			if (d.tool === 'rect') {
				const b = normRect(d.x0, d.y0, snapv(w.x), snapv(w.y));
				if (b.width < 1 || b.height < 1) return;
				el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
				el.setAttribute('x', b.x); el.setAttribute('y', b.y);
				el.setAttribute('width', b.width); el.setAttribute('height', b.height);
				name = 'Rect ' + (++uidName);
			} else {
				const r = Math.max(1, Math.hypot(w.x - d.x0, w.y - d.y0));
				el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
				el.setAttribute('cx', d.x0); el.setAttribute('cy', d.y0); el.setAttribute('r', Math.round(snapv(r)));
				name = 'Circle ' + (++uidName);
			}
			let poly;
			try { poly = SvgParser.polygonify(el); } catch (e) { return; }
			const p = makePart(name, [{ el: el, poly: poly, area: Math.abs(polyArea(poly)) }]);
			state.parts.push(p);
			setSelection([p.id]);
			renderPartList(); renderEditView(); syncSelectionPanel();
			setStatus('Created part "' + name + '".');
		}
	}

	/* ---- unified pointer handling: mouse + touch + pen, with pinch zoom ---- */

	const pointers = new Map();
	let pinch = null;

	viewport.addEventListener('pointerdown', (ev) => {
		if (ev.pointerType === 'mouse' && ev.button !== 0 && ev.button !== 1) return;
		pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
		if (pointers.size === 2) {
			// two fingers → pinch zoom / two-finger pan; cancel any in-progress edit drag
			overlay.querySelectorAll('.marquee').forEach(m => m.remove());
			if (drag && (drag.kind === 'move' || drag.kind === 'scale' || drag.kind === 'rotate') && drag.orig) {
				// revert uncommitted drags
				for (const o of drag.orig) { o.P.xf.dx = o.dx; o.P.xf.dy = o.dy; refreshPartGeom(o.P); refreshPartDisplay(o.P); }
			}
			drag = null;
			const pts = [...pointers.values()];
			pinch = {
				d0: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
				k0: view.k,
				cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2,
				vx: view.x, vy: view.y
			};
			return;
		}
		onDown(ev);
	});
	window.addEventListener('pointermove', (ev) => {
		if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
		if (pinch && pointers.size >= 2) {
			const pts = [...pointers.values()];
			const d = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
			const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
			const k2 = Math.max(0.005, Math.min(pinch.k0 * d / pinch.d0, 400));
			const rect = canvas.getBoundingClientRect();
			const omx = pinch.cx - rect.left, omy = pinch.cy - rect.top;
			view.x = omx - (omx - pinch.vx) * (k2 / pinch.k0) + (cx - pinch.cx);
			view.y = omy - (omy - pinch.vy) * (k2 / pinch.k0) + (cy - pinch.cy);
			view.k = k2;
			applyView();
			return;
		}
		onMove(ev);
	}, { passive: true });
	window.addEventListener('pointerup', (ev) => {
		pointers.delete(ev.pointerId);
		if (pinch) { if (pointers.size < 2) { pinch = null; drag = null; viewport.classList.remove('panning'); } return; }
		onUp(ev);
	});
	window.addEventListener('pointercancel', (ev) => {
		pointers.delete(ev.pointerId);
		pinch = null; drag = null;
		viewport.classList.remove('panning');
	});

	function mk(tag, attrs) {
		const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
		for (const k in attrs) e.setAttribute(k, attrs[k]);
		return e;
	}
	function normRect(x0, y0, x1, y1) {
		return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
	}
	function rectsIntersect(a, b) {
		return !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y);
	}

	viewport.addEventListener('dblclick', (ev) => {
		if (state.tool === 'poly' && polyPts.length >= 3) finishPolygon();
	});

	viewport.addEventListener('wheel', (ev) => {
		ev.preventDefault();
		const r = canvas.getBoundingClientRect();
		zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * 0.0012));
	}, { passive: false });

	/* ================= sheets manager ================= */

	function makeSheet(name, w, h, unit) {
		return { id: uidSheet++, name: name || 'Sheet ' + (uidSheet), w: w, h: h, unit: unit || 'px' };
	}

	function renderSheets() {
		const ul = $('sheetList');
		ul.innerHTML = '';
		$('sheetCount').textContent = state.sheets.length;
		for (const s of state.sheets) {
			const li = document.createElement('li');
			li.dataset.sheetId = s.id;
			if (s.id === state.activeSheetId) li.classList.add('active');
			li.innerHTML = '<span class="sradio"></span><span class="sname"></span><span class="ssize"></span>';
			li.querySelector('.sname').textContent = s.name;
			li.querySelector('.ssize').textContent = fmt(s.w, 0) + '×' + fmt(s.h, 0) + ' ' + s.unit;
			li.onclick = () => { state.activeSheetId = s.id; renderSheets(); if (state.mode === 'edit') renderEditView(); updateSheetReadout(); };
			ul.appendChild(li);
		}
		const sh = activeSheet();
		$('sheetW').value = sh.w;
		$('sheetH').value = sh.h;
		$('sheetUnit').value = sh.unit;
		updateSheetReadout();
	}

	function updateSheetReadout() {
		const sh = activeSheet(), f = unitFactor();
		$('sheetReadout').textContent = sh.name + ': ' + fmt(sh.w * f) + ' × ' + fmt(sh.h * f) + ' u  (' +
			fmt((sh.w * f) / ENGINE_UPI, 2) + ' × ' + fmt((sh.h * f) / ENGINE_UPI, 2) + ' in)';
		$('statusUnits').textContent = sh.unit === 'px' ? '1 u = 1 px (import) · 72 u = 1 in' : 'units: ' + sh.unit + ' · 72 u = 1 in';
	}

	$('sheetAdd').onclick = () => {
		pushUndo();
		const s = makeSheet(null, activeSheet().w, activeSheet().h, activeSheet().unit);
		state.sheets.push(s);
		state.activeSheetId = s.id;
		renderSheets(); renderEditView();
	};
	$('sheetDup').onclick = () => {
		pushUndo();
		const a = activeSheet();
		const s = makeSheet(a.name + ' copy', a.w, a.h, a.unit);
		state.sheets.push(s);
		state.activeSheetId = s.id;
		renderSheets(); renderEditView();
	};
	$('sheetDel').onclick = () => {
		if (state.sheets.length <= 1) { setStatus('At least one sheet is required.'); return; }
		pushUndo();
		state.sheets = state.sheets.filter(s => s.id !== state.activeSheetId);
		state.activeSheetId = state.sheets[0].id;
		renderSheets(); renderEditView();
	};
	$('sheetW').addEventListener('input', () => { activeSheet().w = parseFloat($('sheetW').value) || 1; renderSheetsMeta(); });
	$('sheetH').addEventListener('input', () => { activeSheet().h = parseFloat($('sheetH').value) || 1; renderSheetsMeta(); });
	$('sheetUnit').addEventListener('change', () => { activeSheet().unit = $('sheetUnit').value; renderSheetsMeta(); });
	function renderSheetsMeta() {
		const a = activeSheet();
		const li = $('sheetList').querySelector('li.active .ssize');
		if (li) li.textContent = fmt(a.w, 0) + '×' + fmt(a.h, 0) + ' ' + a.unit;
		updateSheetReadout();
		if (state.mode === 'edit') renderEditView();
	}

	/* ================= nesting ================= */

	function buildJobSvgString() {
		const sh = activeSheet(), f = unitFactor(sh);
		const W = sh.w * f, H = sh.h * f;
		let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '">';
		s += '<rect id="bin" x="0" y="0" width="' + W + '" height="' + H + '"/>';
		const ser = new XMLSerializer();
		let total = 0;
		const seq = []; // cleaned-DOM mapping: one entry per top-level element after the bin
		for (const p of liveParts()) {
			if (p.qty < 1) continue;
			for (let q = 0; q < p.qty; q++) {
				// wrapper group carries the user's CAD transform; engine bakes it on import
				s += '<g transform="' + xfString(p) + '">';
				for (let mi = 0; mi < p.els.length; mi++) {
					s += ser.serializeToString(p.els[mi].el.cloneNode(true));
					seq.push({ partId: p.id, isOuter: mi === 0 });
				}
				s += '</g>';
				total++;
			}
		}
		s += '</svg>';
		return { str: s, W: W, H: H, total: total, seq: seq };
	}

	// tag cleaned job elements with per-part metadata (rotation lock, priority)
	// so the patched engine can honor them. Elements are matched by geometry
	// (first vertex + area of the transformed outer polygon) — robust against
	// element rewrites/reordering inside the parser's clean pass.
	function tagJobMeta(svgEl, seq) {
		const byId = new Map(liveParts().map(p => [p.id, p]));
		const need = seq.filter(s => {
			const p = byId.get(s.partId);
			return s.isOuter && p && (p.rotLock || p.priority);
		});
		if (!need.length) return true;
		const kids = Array.from(svgEl.children);
		let tagged = 0;
		for (const s of need) {
			const p = byId.get(s.partId);
			for (const k of kids) {
				if (!k.getAttribute || k.getAttribute('data-dn-tag')) continue;
				let poly = null;
				try { poly = SvgParser.polygonify(k); } catch (e) { poly = null; }
				if (!poly || poly.length < 3) continue;
				const areaOk = Math.abs(Math.abs(GeometryUtil.polygonArea(poly)) - p.tOuterArea) < Math.max(0.5, p.tOuterArea * 0.002);
				const ptOk = Math.abs(poly[0].x - p.tpoly[0].x) < 0.75 && Math.abs(poly[0].y - p.tpoly[0].y) < 0.75;
				if (!areaOk || !ptOk) continue;
				if (p.rotLock) k.setAttribute('data-norot', '1');
				if (p.priority) k.setAttribute('data-priority', String(p.priority));
				k.setAttribute('data-dn-tag', '1');
				tagged++;
				break;
			}
		}
		if (tagged < need.length) console.warn('meta tagging partial:', tagged, '/', need.length);
		return tagged === need.length;
	}

	function readCfg() {
		state.cfg = {
			spacing: Math.max(0, parseFloat($('cfgSpacing').value) || 0),
			rotations: parseInt($('cfgRotations').value, 10) || 4,
			populationSize: parseInt($('cfgPopulation').value, 10) || 10,
			mutationRate: parseInt($('cfgMutation').value, 10) || 10,
			curveTolerance: Math.max(0, parseFloat($('cfgCurveTol').value) || 0.3),
			useHoles: $('cfgUseHoles').checked,
			exploreConcave: $('cfgExploreConcave').checked
		};
	}

	function startNesting() {
		if (state.running) return;
		const totalQty = liveParts().reduce((s, p) => s + p.qty, 0);
		if (totalQty === 0) { setStatus('No parts to nest — set quantities greater than zero.'); return; }

		readCfg();
		const job = buildJobSvgString();

		SvgNest.stop();
		stopSim();
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
		try { svgEl = SvgNest.parsesvg(job.str); }
		catch (err) { console.error(err); setStatus('Failed to build nesting job: ' + err.message); return; }
		tagJobMeta(svgEl, job.seq);
		const bin = svgEl.querySelector('#bin');
		if (!bin) { setStatus('Internal error: bin missing after parse.'); return; }
		SvgNest.setbin(bin);

		state.history = [];
		state.histIndex = -1;
		state.live = true;
		state.running = true;
		state.mode = 'nest';
		$('viewBadge').textContent = 'NEST — LIVE';
		$('btnEdit').disabled = false;
		$('btnStart').disabled = true;
		$('btnStop').disabled = false;
		$('btnImport').disabled = true;
		$('btnSample').disabled = true;
		$('histSlider').max = 0;
		$('histSlider').value = 0;
		$('histSlider').disabled = true;
		$('histLabel').textContent = '–';
		setEngine(true);
		setStatus('Nesting ' + job.total + ' parts on "' + activeSheet().name + '" (' + fmt(job.W) + '×' + fmt(job.H) + ' u) — improvements stream in live.');
		syncSelectionPanel();

		const ok = SvgNest.start(
			function (p) {
				$('progressBar').style.width = Math.round((p || 0) * 100) + '%';
				if (!state.running) return;
				if (state.history.length === 0) setStatus('Computing no-fit polygons (NFP geometry) — first generation takes the longest…');
				else setStatus('Optimizing: ' + (state.history.length + 1) + ' improvements so far — layouts keep improving until you press Stop.');
			},
			function (svgList, utilization, placedCount) {
				if (!svgList || !svgList.length) return;
				state.history.push({ sheets: svgList, util: utilization || 0, placed: placedCount || '' });
				state.histIndex = state.history.length - 1;
				state.live = true;
				$('histSlider').max = state.history.length - 1;
				$('histSlider').value = state.histIndex;
				$('histSlider').disabled = false;
				$('histLabel').textContent = 'GEN ' + (state.histIndex + 1) + '/' + state.history.length;
				renderNestView();
				updateRunStats();
				$('btnExport').disabled = false;
			}
		);

		if (ok === false) {
			state.running = false;
			setEngine(false);
			$('btnStart').disabled = false;
			$('btnStop').disabled = true;
			$('btnImport').disabled = false;
			$('btnSample').disabled = false;
			$('viewBadge').textContent = 'EDIT';
			state.mode = 'edit';
			renderEditView();
			setStatus('Cannot start: parts may not fit the sheet, or sheet geometry is invalid.');
		}
	}

	function stopNesting() {
		if (!state.running) return;
		SvgNest.stop();
		state.running = false;
		$('viewBadge').textContent = 'NEST — RESULT';
		$('btnStart').disabled = false;
		$('btnStop').disabled = true;
		$('btnImport').disabled = false;
		$('btnSample').disabled = false;
		$('progressBar').style.width = '0%';
		setEngine(false);
		stopSim();
		const last = state.history[state.history.length - 1];
		setStatus('Stopped. ' + (last ? last.sheets.length + ' sheet(s), best utilization ' + (last.util * 100).toFixed(1) + '%. ' : '') + 'Scrub HISTORY or press Cut sim.');
	}

	function backToEdit() {
		SvgNest.stop();
		stopSim();
		state.running = false;
		state.mode = 'edit';
		setEngine(false);
		$('btnStart').disabled = false;
		$('btnStop').disabled = true;
		$('btnImport').disabled = false;
		$('btnSample').disabled = false;
		$('btnExport').disabled = state.history.length === 0;
		renderEditView();
		fitView();
		setStatus('Edit view. ' + (state.history.length ? 'Result history is kept — press Nest to run again.' : ''));
	}

	function renderNestView() {
		content.innerHTML = '';
		overlay.innerHTML = '';
		stopSim();
		const sh = activeSheet(), f = unitFactor(sh);
		sheetRect.setAttribute('visibility', 'visible');
		sheetRect.setAttribute('class', 'nestbin');
		sheetRect.setAttribute('x', 0);
		sheetRect.setAttribute('y', 0);
		sheetRect.setAttribute('width', sh.w * f);
		sheetRect.setAttribute('height', sh.h * f);

		$('viewBadge').textContent = state.running ? 'NEST — LIVE' : 'NEST — RESULT' + (state.histIndex < state.history.length - 1 ? ' (HISTORY)' : '');
		$('simbar').classList.remove('hidden');
		$('btnSim').disabled = state.histIndex < 0;
		$('btnSim').classList.remove('running');
		$('btnSim').querySelector('span').textContent = 'Cut sim';

		// sheet tabs with per-sheet part counts
		const snap = state.history[state.histIndex];
		const tabs = $('sheetTabs');
		tabs.classList.remove('hidden');
		tabs.innerHTML = '';
		if (!snap) return;
		snap.sheets.forEach((s, i) => {
			const t = document.createElement('div');
			t.className = 'stab' + (i === state.activeTab && state.live ? ' active' : '');
			const count = s.querySelectorAll('.nestpart').length || s.querySelectorAll('g:not(.bin)').length;
			t.textContent = 'SHEET ' + (i + 1) + ' · ' + count;
			t.onclick = () => { state.activeTab = i; state.live = true; state.histIndex = state.history.length - 1; renderNestView(); };
			tabs.appendChild(t);
		});

		const idx = (state.live ? (state.activeTab || 0) : 0);
		const svg = snap.sheets[Math.min(idx, snap.sheets.length - 1)];
		if (svg) {
			for (const child of Array.from(svg.childNodes)) {
				if (child.nodeType !== 1) continue;
				const n = document.importNode(child, true);
				n.classList.add(child.getAttribute('class') === 'bin' ? 'nestbin' : 'nestpart');
				content.appendChild(n);
			}
		}

		// per-sheet remnant estimate (usable offcut) + job stats refresh
		try {
			computeRemnants();
			const r = state.remnants[idx] || state.remnants[0];
			$('statRemnant').textContent = r ? fmt(r.side) + ' × ' + fmt(r.side) + ' u  (' + fmt(r.sideMm) + ' mm)' : '–';
		} catch (e) { console.warn('remnant calc failed', e); }
		updateJobStats();
	}

	function updateRunStats() {
		const snap = state.history[state.histIndex] || state.history[state.history.length - 1];
		$('statSheets').textContent = snap ? snap.sheets.length : '–';
		const u = $('statUtil');
		u.textContent = snap ? (snap.util * 100).toFixed(1) + '%' : '–';
		u.className = snap ? 'hot' : '';
		$('statPlaced').textContent = snap ? snap.placed : '–';
		$('statGen').textContent = state.history.length;
	}

	/* ---- history scrubbing ---- */

	$('histSlider').addEventListener('input', () => {
		state.histIndex = +$('histSlider').value;
		state.live = false;
		$('histLabel').textContent = 'GEN ' + (state.histIndex + 1) + '/' + state.history.length;
		state.activeTab = 0;
		renderNestView();
		updateRunStats();
	});
	$('btnLive').onclick = () => {
		state.histIndex = state.history.length - 1;
		state.live = true;
		state.activeTab = 0;
		$('histSlider').value = state.histIndex;
		$('histLabel').textContent = 'GEN ' + (state.histIndex + 1) + '/' + state.history.length;
		renderNestView();
		updateRunStats();
	};

	/* ---- laser cut-path simulation ---- */

	let sim = null;

	function stopSim() {
		if (sim) { cancelAnimationFrame(sim.raf); sim = null; }
		overlay.querySelectorAll('.simcut,.simhead').forEach(e => e.remove());
		const b = $('btnSim');
		b.classList.remove('running');
		b.querySelector('span').textContent = 'Cut sim';
	}

	$('btnSim').onclick = () => { sim ? stopSim() : startSim(); };

	function startSim() {
		if (state.histIndex < 0) return;
		const shapes = content.querySelectorAll('.nestpart path, .nestpart polygon, .nestpart polyline, .nestpart circle, .nestpart rect, .nestpart ellipse');
		if (!shapes.length) { setStatus('Nothing to simulate on this sheet.'); return; }

		// sample every shape into a world-coordinate polyline via its CTM
		const parts = [];
		const worldCtm = world.getCTM().inverse();
		const svgpt = canvas.createSVGPoint();
		for (const sh of shapes) {
			try {
				const len = sh.getTotalLength ? sh.getTotalLength() : 0;
				if (!len || !isFinite(len)) continue;
				const step = Math.max(2 / view.k, 3);
				const n = Math.min(600, Math.max(12, Math.ceil(len / step)));
				const m = worldCtm.multiply(sh.getScreenCTM().inverse());
				const pts = [];
				for (let i = 0; i <= n; i++) {
					const pt = sh.getPointAtLength(len * i / n);
					svgpt.x = pt.x; svgpt.y = pt.y;
					const wp = svgpt.matrixTransform(m);
					pts.push({ x: wp.x, y: wp.y });
				}
				parts.push(pts);
			} catch (e) { /* skip unsamplable shape */ }
		}
		if (!parts.length) { setStatus('Could not sample geometry for simulation.'); return; }

		const speed = parseFloat($('simSpeed').value) || 2;
		const cutline = mk('polyline', { class: 'simcut', points: '' });
		const head = mk('circle', { class: 'simhead', r: 4 / view.k, cx: -1e5, cy: -1e5 });
		overlay.appendChild(cutline);
		overlay.appendChild(head);

		sim = { parts, pi: 0, vi: 0, pts: [parts[0][0]], raf: 0, last: 0 };
		const b = $('btnSim');
		b.classList.add('running');
		b.querySelector('span').textContent = 'Stop sim';

		const tick = (t) => {
			if (!sim) return;
			const ptsPerFrame = 3 * speed;
			for (let k = 0; k < ptsPerFrame; k++) {
				const cur = sim.parts[sim.pi];
				if (!cur) { finishSim(); return; }
				sim.pts.push(cur[sim.vi]);
				sim.vi++;
				if (sim.vi >= cur.length) {
					sim.pi++; sim.vi = 0;
					if (sim.pi < sim.parts.length) sim.pts.push([null]); // gap marker
				}
			}
			// rebuild polyline with gaps
			let d = '';
			for (const p of sim.pts) {
				if (!p || p[0] === null) { if (d) d += ' '; continue; }
				d === '' || d.endsWith(' ') ? d += p.x + ',' + p.y : d += ' ' + p.x + ',' + p.y;
			}
			cutline.setAttribute('points', d.trim());
			const last = sim.parts[sim.pi] ? sim.parts[sim.pi][Math.max(0, sim.vi - 1)] : null;
			if (last) { head.setAttribute('cx', last.x); head.setAttribute('cy', last.y); }
			$('statusCoords').textContent = 'CUT SIM: part ' + Math.min(sim.pi + 1, sim.parts.length) + '/' + sim.parts.length;
			sim.raf = requestAnimationFrame(tick);
		};
		sim.raf = requestAnimationFrame(tick);
		setStatus('Cut-path simulation running — red line traces the laser path. Press Cut sim or Esc to stop.');
	}
	function finishSim() {
		$('statusCoords').textContent = 'CUT SIM: done';
		stopSim();
	}

	/* ================= export ================= */

	function exportSvg() {
		const last = state.history[state.history.length - 1];
		if (!last || !last.sheets.length) { setStatus('Nothing to export yet — run the nester first.'); return; }
		const ser = new XMLSerializer();
		const sh = activeSheet(), f = unitFactor(sh);
		const W = sh.w * f, H = sh.h * f;
		let out;
		if (last.sheets.length === 1) {
			out = ser.serializeToString(last.sheets[0]);
		} else {
			const gap = 10;
			out = '<svg xmlns="http://www.w3.org/2000/svg" width="' + (last.sheets.length * (W + gap) + gap) + '" height="' + (H + 2 * gap) + '" viewBox="0 ' + (-gap) + ' ' + (last.sheets.length * (W + gap) + gap) + ' ' + (H + 2 * gap) + '">';
			last.sheets.forEach((s, i) => {
				out += '<svg x="' + (gap + i * (W + gap)) + '" y="' + gap + '" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' + s.innerHTML + '</svg>';
			});
			out += '</svg>';
		}
		download('deepnest-result-' + last.sheets.length + 'sheets.svg', out);
		setStatus('Exported ' + last.sheets.length + ' sheet(s) as SVG.');
	}

	/* ================= keyboard ================= */

	let spaceHeld = false;

	window.addEventListener('keydown', (ev) => {
		const tag = ev.target.tagName;
		if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
		const sel = selParts();
		if (ev.ctrlKey || ev.metaKey) {
			if (ev.key === 'z') { ev.preventDefault(); undo(); return; }
			if (ev.key === 'y') { ev.preventDefault(); redo(); return; }
			if (ev.key === 'd') { ev.preventDefault(); dupSel(); return; }
			return;
		}
		switch (ev.key) {
			case 'v': case 'V': setTool('select'); break;
			case 'm': case 'M': setTool('measure'); break;
			case 'r': case 'R': setTool('rect'); break;
			case 'c': case 'C': setTool('circle'); break;
			case 'p': case 'P': setTool('poly'); break;
			case 'Enter': if (state.tool === 'poly') finishPolygon(); break;
			case 'h': case 'H': flipSel('h'); break;
			case 'j': case 'J': flipSel('v'); break;
			case 'q': case 'Q': rotSel(-90); break;
			case 'e': case 'E': rotSel(90); break;
			case 'g': case 'G': state.snap = !state.snap; $('chkSnap').checked = state.snap; syncSnap(); break;
			case 'f': case 'F': fitView(); break;
			case '+': case '=': zoomStep(1.25); break;
			case '-': case '_': zoomStep(0.8); break;
			case ' ': spaceHeld = true; ev.preventDefault(); break;
			case 'Escape':
				if (polyPts.length) cancelPolygon();
				else if (sim) stopSim();
				else { clearSelection(); renderPartList(); renderEditSelection(); renderOverlay(); syncSelectionPanel(); }
				break;
			case 'Delete': case 'Backspace': delSel(); break;
			case 'ArrowLeft': nudge(-1, 0, ev.shiftKey); break;
			case 'ArrowRight': nudge(1, 0, ev.shiftKey); break;
			case 'ArrowUp': nudge(0, -1, ev.shiftKey); break;
			case 'ArrowDown': nudge(0, 1, ev.shiftKey); break;
		}
	});
	window.addEventListener('keyup', (ev) => { if (ev.key === ' ') spaceHeld = false; });

	function nudge(dx, dy, big) {
		const sel = selParts(); if (!sel.length || state.mode !== 'edit') return;
		const step = big ? GRID * 5 : GRID;
		if (!nudge._pushed) { pushUndo(); nudge._pushed = true; setTimeout(() => { nudge._pushed = false; }, 1200); }
		for (const P of sel) { P.xf.dx += dx * step; P.xf.dy += dy * step; refreshPartGeom(P); refreshPartDisplay(P); }
		renderOverlay(); syncSelectionPanel();
	}

	function syncSnap() {
		$('statusSnap').textContent = 'SNAP: ' + (state.snap ? GRID + ' u' : 'off');
	}
	$('chkSnap').addEventListener('change', () => { state.snap = $('chkSnap').checked; syncSnap(); });

	/* ================= file import wiring ================= */

	$('btnImport').onclick = () => $('fileInput').click();
	$('fileInput').addEventListener('change', (ev) => {
		const files = Array.from(ev.target.files || []);
		(async () => {
			for (const f of files) {
				try {
					const text = await f.text();
					if (/\.dxf$/i.test(f.name)) importDxfText(f.name, text);
					else importSvgText(f.name, text);
				} catch (e) { setStatus('Could not read "' + f.name + '": ' + e.message); }
			}
		})();
		ev.target.value = '';
	});

	// drag & drop
	let dragDepth = 0;
	viewport.addEventListener('dragenter', (ev) => { ev.preventDefault(); dragDepth++; $('dropHint').classList.remove('hidden'); });
	viewport.addEventListener('dragover', (ev) => ev.preventDefault());
	viewport.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropHint').classList.add('hidden'); } });
	viewport.addEventListener('drop', (ev) => {
		ev.preventDefault();
		dragDepth = 0;
		$('dropHint').classList.add('hidden');
		const files = Array.from(ev.dataTransfer.files || []);
		(async () => {
			for (const f of files) {
				try {
					const text = await f.text();
					if (/\.dxf$/i.test(f.name)) importDxfText(f.name, text);
					else if (/\.svg$/i.test(f.name) || f.type === 'image/svg+xml') importSvgText(f.name, text);
					else setStatus('Unsupported file type: "' + f.name + '" (SVG or DXF only).');
				} catch (e) { setStatus('Could not read "' + f.name + '": ' + e.message); }
			}
		})();
	});

	/* ================= sample ================= */

	const SAMPLE_QTY = { gear: 4, plate: 4, lbracket: 6, washer: 8, disc: 2, tri: 4, shim: 3 };

	function loadSample() {
		return fetch('sample.svg')
			.then(res => { if (!res.ok) throw new Error('sample.svg not found'); return res.text(); })
			.then(text => {
				if (!importSvgText('sample.svg', text)) return false;
				for (const p of state.parts) {
					const prefix = p.name.split(' ')[0].split('-')[0];
					if (SAMPLE_QTY[prefix]) p.qty = SAMPLE_QTY[prefix];
				}
				renderPartList();
				return true;
			})
			.catch(e => setStatus('Could not load sample: ' + e.message));
	}
	$('btnSample').onclick = loadSample;

	/* ================= top buttons ================= */

	$('btnExport').onclick = exportSvg;
	$('btnStart').onclick = startNesting;
	$('btnStop').onclick = stopNesting;
	$('btnEdit').onclick = backToEdit;
	$('btnFit').onclick = fitView;
	$('btnZoomIn').onclick = () => zoomStep(1.25);
	$('btnZoomOut').onclick = () => zoomStep(0.8);

	window.addEventListener('resize', () => applyView());

	/* ============================================================
	   ENTERPRISE: material & costing, job stats, smart optimizer,
	   remnant estimation, job save/load, report, toasts & modals
	   ============================================================ */

	const U2MM = 72 / 25.4; // 1 engine unit in mm

	function toast(msg) {
		const box = $('toasts');
		const t = document.createElement('div');
		t.className = 'toast';
		t.textContent = msg;
		box.appendChild(t);
		setTimeout(() => t.remove(), 4200);
	}

	function fmtMoney(v) { return '$' + (Math.round(v * 100) / 100).toFixed(2); }
	function fmtLen(mm) { return mm >= 1000 ? (mm / 1000).toFixed(2) + ' m' : Math.round(mm) + ' mm'; }

	function partPerimeter(p) {
		let L = 0;
		for (const m of p.els) {
			const poly = m.poly.map(pt => xfPoint(p, pt));
			for (let i = 0; i < poly.length; i++) {
				const j = (i + 1) % poly.length;
				L += Math.hypot(poly[j].x - poly[i].x, poly[j].y - poly[i].y);
			}
		}
		return L;
	}

	function computeJobStats() {
		const parts = liveParts();
		const sh = activeSheet(), f = unitFactor(sh);
		const sheetWU = sh.w * f, sheetHU = sh.h * f;
		const sheetAreaU = sheetWU * sheetHU;
		let qty = 0, area = 0, cutlen = 0, pierces = 0, weightKg = 0;
		for (const p of parts) {
			qty += p.qty;
			area += p.tArea * p.qty;
			cutlen += partPerimeter(p) * p.qty;
			pierces += p.els.length * p.qty;
			weightKg += (p.tArea * p.qty) * U2MM * U2MM * state.material.thickness * state.material.density / 1e6;
		}
		const timeMin = (cutlen * U2MM) / Math.max(1, state.material.cutSpeed);
		const last = state.history[state.history.length - 1];
		const sheets = last ? last.sheets.length : Math.max(1, Math.ceil(area / (sheetAreaU * 0.85)));
		const matCost = sheets * state.material.priceSheet;
		const machCost = timeMin * state.material.machineRate;
		const waste = Math.min(1, Math.max(0, 1 - area / (sheets * sheetAreaU)));
		return {
			qty, area, cutlen, pierces, weightKg, timeMin, sheets, sheetsUsed: last ? last.sheets.length : 0,
			sheetWU, sheetHU, sheetAreaU, matCost, machCost, total: matCost + machCost, waste,
			costPerPart: qty ? (matCost + machCost) / qty : 0
		};
	}

	function updateJobStats() {
		const s = computeJobStats();
		$('jbParts').textContent = s.qty;
		$('jbArea').textContent = s.area >= 1e6 ? fmt(s.area / 1e6, 2) + 'M u²' : fmt(s.area / 1e3, 1) + 'k u²';
		$('jbCut').textContent = fmtLen(s.cutlen * U2MM);
		$('jbPierce').textContent = s.pierces;
		$('jbTime').textContent = s.timeMin >= 60 ? fmt(s.timeMin / 60, 1) + ' h' : fmt(s.timeMin) + ' min';
		$('jbSheets').textContent = s.sheetsUsed ? s.sheets + ' (nested)' : '~' + s.sheets + ' est.';
		$('jbMat').textContent = state.material.name + ' ' + state.material.thickness + 'mm · ' + fmt(s.weightKg, 1) + ' kg';
		$('jbCost').textContent = fmtMoney(s.costPerPart);
		$('chipParts').textContent = s.qty + ' parts · ' + fmtLen(s.cutlen * U2MM);
		$('chipSheets').textContent = s.sheets + ' sheets · ' + Math.round((1 - s.waste) * 100) + '% fill';
		$('chipCost').textContent = fmtMoney(s.total) + ' · ' + fmtMoney(s.costPerPart) + '/part';
		return s;
	}

	function readMaterial() {
		state.material = {
			name: $('matName').value || 'Material',
			thickness: Math.max(0, parseFloat($('matThick').value) || 0),
			density: Math.max(0, parseFloat($('matDensity').value) || 0),
			priceSheet: Math.max(0, parseFloat($('matPrice').value) || 0),
			machineRate: Math.max(0, parseFloat($('matRate').value) || 0),
			cutSpeed: Math.max(1, parseFloat($('matSpeed').value) || 1)
		};
	}
	['matName', 'matThick', 'matDensity', 'matPrice', 'matRate', 'matSpeed'].forEach(id =>
		$(id).addEventListener('input', () => { readMaterial(); updateJobStats(); }));

	function updateSpacingHint() {
		const v = parseFloat($('cfgSpacing').value) || 0;
		$('spacingHint').textContent = '= ' + fmt(v * U2MM, 2) + ' mm  ·  ' + fmt(v / ENGINE_UPI, 3) + ' in (per part edge)';
	}
	$('cfgSpacing').addEventListener('input', updateSpacingHint);

	/* ---- remnant (offcut) estimation via occupancy grid + maximal free square ---- */

	function computeRemnants() {
		state.remnants = [];
		const snap = state.history[state.histIndex >= 0 ? state.histIndex : state.history.length - 1];
		if (!snap) return;
		const sh = activeSheet(), f = unitFactor(sh);
		const W = sh.w * f, H = sh.h * f;
		const mg = document.getElementById('measureG');
		for (let si = 0; si < snap.sheets.length; si++) {
			mg.innerHTML = '';
			for (const child of Array.from(snap.sheets[si].childNodes)) {
				if (child.nodeType !== 1) continue;
				const n = document.importNode(child, true);
				if (n.getAttribute('class') !== 'bin') n.classList.add('nestpart');
				mg.appendChild(n);
			}
			state.remnants.push(remnantFromGrid(W, H));
		}
		mg.innerHTML = '';
	}

	function remnantFromGrid(W, H) {
		const cols = 64, cw = W / cols;
		const rows = Math.max(8, Math.ceil(H / cw));
		const chh = cw; // exactly square cells so the DP square side is physical
		const grid = new Uint8Array(cols * rows);
		const worldInv = world.getCTM().inverse();
		const svgpt = canvas.createSVGPoint();
		document.querySelectorAll('#measureG .nestpart *').forEach(sh => {
			try {
				const bb = sh.getBBox();
				if (!bb.width && !bb.height) return;
				const m = worldInv.multiply(sh.getScreenCTM());
				const xs = [], ys = [];
				[[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]].forEach(c => {
					svgpt.x = c[0]; svgpt.y = c[1];
					const w = svgpt.matrixTransform(m);
					xs.push(w.x); ys.push(w.y);
				});
				const x0 = Math.max(0, Math.floor(Math.min(...xs) / cw)), x1 = Math.min(cols - 1, Math.floor(Math.max(...xs) / cw));
				const y0 = Math.max(0, Math.floor(Math.min(...ys) / chh)), y1 = Math.min(rows - 1, Math.floor(Math.max(...ys) / chh));
				for (let r = y0; r <= y1; r++) for (let c = x0; c <= x1; c++) grid[r * cols + c] = 1;
			} catch (e) { /* skip */ }
		});
		// maximal free square (DP)
		const dp = new Int32Array(cols * rows);
		let best = 0, bx = 0, by = 0;
		for (let r = 0; r < rows; r++) {
			for (let c = 0; c < cols; c++) {
				if (grid[r * cols + c]) { dp[r * cols + c] = 0; continue; }
				dp[r * cols + c] = 1 + Math.min(
					r > 0 ? dp[(r - 1) * cols + c] : 0,
					c > 0 ? dp[r * cols + c - 1] : 0,
					(r > 0 && c > 0) ? dp[(r - 1) * cols + c - 1] : 0
				);
				if (dp[r * cols + c] > best) { best = dp[r * cols + c]; bx = c; by = r; }
			}
		}
		const side = best * cw;
		return { side: side, sideMm: side * U2MM, x: bx * cw, y: by * chh };
	}

	/* ---- Smart Sheet Optimizer ---- */

	const SHEET_PRESETS = [
		{ n: '400 × 300 mm', u: 'mm', w: 400, h: 300 },
		{ n: '600 × 400 mm', u: 'mm', w: 600, h: 400 },
		{ n: '1000 × 500 mm', u: 'mm', w: 1000, h: 500 },
		{ n: '1220 × 610 mm', u: 'mm', w: 1220, h: 610 },
		{ n: '1220 × 2440 mm', u: 'mm', w: 1220, h: 2440 },
		{ n: '1250 × 2500 mm', u: 'mm', w: 1250, h: 2500 },
		{ n: '1500 × 3000 mm', u: 'mm', w: 1500, h: 3000 },
		{ n: '24 × 48 in', u: 'in', w: 24, h: 48 },
		{ n: '48 × 96 in', u: 'in', w: 48, h: 96 },
		{ n: '60 × 120 in', u: 'in', w: 60, h: 120 }
	];

	// fast bounding-box shelf packer → {sheets, util}
	function estimatePacking(sheetWU, sheetHU) {
		const items = [];
		for (const p of liveParts()) {
			for (let q = 0; q < p.qty; q++) items.push({ w: p.bounds.width, h: p.bounds.height, a: p.tArea });
		}
		if (!items.length) return { sheets: 0, util: 0 };
		const totalA = items.reduce((s, it) => s + it.a, 0);
		items.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
		let sheets = 0;
		let placed = 0;
		while (placed < items.length && sheets < 500) {
			sheets++;
			let x = 0, y = 0, rowH = 0;
			for (let i = 0; i < items.length; i++) {
				const it = items[i];
				if (!it) continue;
				let w = it.w, h = it.h;
				if (w > sheetWU - x && h <= sheetWU - x) { const t = w; w = h; h = t; }
				if (w > sheetWU || y + h > sheetHU) continue;
				if (x + w > sheetWU) { x = 0; y += rowH; rowH = 0; }
				if (y + h > sheetHU) continue;
				x += w; rowH = Math.max(rowH, h);
				items[i] = null; placed++;
			}
			items.sort((a, b) => (a ? Math.max(a.w, a.h) : -1) - (b ? Math.max(b.w, b.h) : -1)).reverse();
		}
		return { sheets: sheets, util: totalA / (sheets * sheetWU * sheetHU) };
	}

	function largestPartFits(wU, hU) {
		return liveParts().every(p =>
			(p.bounds.width <= wU && p.bounds.height <= hU) ||
			(p.bounds.height <= wU && p.bounds.width <= hU));
	}

	function openOptimizer() {
		if (!liveParts().some(p => p.qty > 0)) { toast('Add parts and set quantities first.'); return; }
		readMaterial();
		const rows = [];
		for (const pr of SHEET_PRESETS) {
			const pf = pr.u === 'in' ? ENGINE_UPI : ENGINE_UPI / 25.4;
			const wU = pr.w * pf, hU = pr.h * pf;
			const fits = largestPartFits(wU, hU);
			const est = estimatePacking(wU, hU);
			rows.push({ pr: pr, wU: wU, hU: hU, fits: fits, est: est });
		}
		rows.sort((a, b) => (b.fits - a.fits) || (b.est.util - a.est.util));
		const best = rows.find(r => r.fits);
		const box = $('optimizerResults');
		box.innerHTML =
			'<div class="optrow head"><span>Stock size</span><span>Est. sheets</span><span>Est. fill</span><span>Largest part</span><span></span></div>' +
			rows.map((r, i) =>
				'<div class="optrow' + (r === best ? ' best' : '') + '">' +
				'<span class="oname">' + r.pr.n + (r === best ? ' ★' : '') + '</span>' +
				'<span>' + (r.fits ? '~' + r.est.sheets : '–') + '</span>' +
				'<span>' + (r.fits ? Math.round(r.est.util * 100) + '%' : '–') + '</span>' +
				'<span class="ofit ' + (r.fits ? 'ok' : '') + '">' + (r.fits ? 'fits' : 'too small') + '</span>' +
				'<button class="mini" data-opt="' + i + '">Apply</button>' +
				'</div>').join('');
		box.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => {
			const r = rows[+b.dataset.opt];
			const a = activeSheet();
			a.w = r.pr.w; a.h = r.pr.h; a.unit = r.pr.u;
			renderSheets(); renderEditView(); fitView(); updateJobStats();
			closeModals();
			toast('Sheet set to ' + r.pr.n + (r === best ? ' (best fit ★)' : '') + '.');
			if ($('optAutoNest').checked) startNesting();
		});
		closeModals();
		$('optimizerModal').classList.remove('hidden');
	}

	$('btnOptimize').onclick = openOptimizer;
	$('optAutofit').onclick = () => {
		const parts = liveParts().filter(p => p.qty > 0);
		if (!parts.length) { toast('No parts to fit.'); return; }
		const b = unionBounds(parts.map(p => p.bounds));
		const margin = Math.max(GRID, (parseFloat($('cfgSpacing').value) || 0) * 4);
		const a = activeSheet();
		a.unit = 'px';
		a.w = Math.ceil((b.width + margin * 2) / 10) * 10;
		a.h = Math.ceil((b.height + margin * 2) / 10) * 10;
		renderSheets(); renderEditView(); fitView(); updateJobStats();
		closeModals();
		toast('Sheet auto-fitted to ' + a.w + ' × ' + a.h + ' u.');
	};

	/* ---- job save / load ---- */

	function saveJob() {
		const data = {
			app: 'deepnest-cad-web', version: 3,
			savedAt: new Date().toISOString(),
			material: state.material,
			cfg: state.cfg,
			sheets: state.sheets,
			activeSheetId: state.activeSheetId,
			parts: liveParts().map(p => ({
				name: p.name, qty: p.qty, rotLock: !!p.rotLock, priority: p.priority || 0,
				color: p.color, xf: p.xf,
				els: p.els.map(m => new XMLSerializer().serializeToString(m.el))
			}))
		};
		download('nesting-job.json', JSON.stringify(data));
		toast('Job saved (nesting-job.json).');
	}

	function loadJob(text) {
		try {
			const data = JSON.parse(text);
			if (data.app !== 'deepnest-cad-web') throw new Error('not a Deepnest CAD job file');
			const parser = new DOMParser();
			const rebuilt = [];
			for (const jp of data.parts) {
				const wrapper = parser.parseFromString('<svg xmlns="http://www.w3.org/2000/svg">' + jp.els.join('') + '</svg>', 'image/svg+xml');
				const members = [];
				Array.from(wrapper.documentElement.children).forEach(el => {
					const poly = SvgParser.polygonify(el);
					if (poly && poly.length > 2) members.push({ el: el, poly: poly, area: Math.abs(polyArea(poly)) });
				});
				if (!members.length) continue;
				const p = makePart(jp.name, members);
				p.qty = jp.qty; p.rotLock = !!jp.rotLock; p.priority = jp.priority || 0;
				if (jp.color) p.color = jp.color;
				if (jp.xf) { p.xf = Object.assign(p.xf, jp.xf); refreshPartGeom(p); }
				rebuilt.push(p);
			}
			state.parts = rebuilt;
			state.sheets = data.sheets.map(s => ({ id: uidSheet++, name: s.name, w: s.w, h: s.h, unit: s.unit }));
			state.activeSheetId = state.sheets[0] ? state.sheets[0].id : null;
			if (data.material) {
				state.material = data.material;
				$('matName').value = state.material.name; $('matThick').value = state.material.thickness;
				$('matDensity').value = state.material.density; $('matPrice').value = state.material.priceSheet;
				$('matRate').value = state.material.machineRate; $('matSpeed').value = state.material.cutSpeed;
			}
			if (data.cfg) {
				$('cfgSpacing').value = data.cfg.spacing; $('cfgRotations').value = data.cfg.rotations;
				$('cfgPopulation').value = data.cfg.populationSize; $('cfgMutation').value = data.cfg.mutationRate;
				$('cfgCurveTol').value = data.cfg.curveTolerance; $('cfgUseHoles').checked = !!data.cfg.useHoles;
				$('cfgExploreConcave').checked = !!data.cfg.exploreConcave;
			}
			state.history = []; state.histIndex = -1; state.selection = [];
			state.mode = 'edit';
			$('btnStart').disabled = false; $('btnStop').disabled = true;
			$('btnImport').disabled = false; $('btnSample').disabled = false;
			$('btnExport').disabled = true; $('btnReport').disabled = true;
			setEngine(false);
			undoStack.length = 0; redoStack.length = 0;
			$('btnUndo').disabled = true; $('btnRedo').disabled = true;
			clearSelection();
			renderSheets(); renderPartList(); renderEditView(); fitView(); updateJobStats(); updateSpacingHint();
			toast('Job loaded: ' + rebuilt.length + ' part types, ' + state.sheets.length + ' sheet(s).');
			setStatus('Job loaded from file.');
			return true;
		} catch (err) {
			console.error(err);
			toast('Could not load job: ' + err.message);
			return false;
		}
	}

	$('btnSaveJob').onclick = saveJob;
	$('btnLoadJob').onclick = () => $('jobInput').click();
	$('jobInput').addEventListener('change', async (ev) => {
		const f = ev.target.files && ev.target.files[0];
		if (f) loadJob(await f.text());
		ev.target.value = '';
	});

	/* ---- report ---- */

	function showReport() {
		const d = { stats: updateJobStats(), remnants: state.remnants };
		const last = state.history[state.history.length - 1];
		d.sheets = last ? last.sheets.length : 0;
		d.util = last ? last.util : null;
		d.parts = liveParts().map(p => ({
			name: p.name, qty: p.qty, w: p.bounds.width, h: p.bounds.height,
			area: p.tArea, rotLock: !!p.rotLock, priority: p.priority || 0
		}));
		if (!d.sheets) { toast('Run the nester first — the report includes nest results.'); return; }
		const rows = d.parts.map(p =>
			'<tr><td>' + p.name + '</td><td>' + p.qty + '</td><td>' + fmt(p.w) + ' × ' + fmt(p.h) + ' u</td><td>' +
			fmt(p.area / 1e4, 2) + 'k u²</td><td>' + (p.rotLock ? '0° locked' : 'free') + '</td><td>' + (p.priority ? 'high' : 'normal') + '</td></tr>').join('');
		const sheetRows = d.remnants.map((r, i) =>
			'<tr><td>Sheet ' + (i + 1) + '</td><td>' + fmt(r.side) + ' u × ' + fmt(r.side) + ' u</td><td>' + fmt(r.sideMm) + ' mm</td></tr>').join('');
		$('reportBody').innerHTML =
			'<h4>Job summary</h4>' +
			'<table class="rpt">' +
			'<tr><th>Material</th><td>' + state.material.name + ' · ' + state.material.thickness + ' mm · ' + fmt(d.stats.weightKg, 1) + ' kg total</td></tr>' +
			'<tr><th>Parts</th><td>' + d.stats.qty + ' (' + liveParts().length + ' types)</td></tr>' +
			'<tr><th>Total part area</th><td>' + fmt(d.stats.area / 1e4, 1) + 'k u²</td></tr>' +
			'<tr><th>Cut length</th><td>' + fmtLen(d.stats.cutlen * U2MM) + ' · ' + d.stats.pierces + ' pierces</td></tr>' +
			'<tr><th>Est. cut time</th><td>' + (d.stats.timeMin >= 60 ? fmt(d.stats.timeMin / 60, 1) + ' h' : fmt(d.stats.timeMin) + ' min') + '</td></tr>' +
			'<tr><th>Sheets used</th><td>' + d.sheets + ' × ' + fmt(d.stats.sheetWU) + ' × ' + fmt(d.stats.sheetHU) + ' u</td></tr>' +
			'<tr><th>Material utilization</th><td>' + (d.util !== null ? (d.util * 100).toFixed(1) + '%' : '–') + '</td></tr>' +
			'<tr><th>Material cost</th><td>' + fmtMoney(d.stats.matCost) + '</td></tr>' +
			'<tr><th>Machine cost</th><td>' + fmtMoney(d.stats.machCost) + '</td></tr>' +
			'<tr><th><b>Job total</b></th><td><b>' + fmtMoney(d.stats.total) + ' · ' + fmtMoney(d.stats.costPerPart) + '/part</b></td></tr>' +
			'</table>' +
			'<h4>Sheet remnants (largest reusable offcut)</h4>' +
			'<table class="rpt"><tr><th>Sheet</th><th>Usable square</th><th>Metric</th></tr>' + (sheetRows || '<tr><td colspan="3">–</td></tr>') + '</table>' +
			'<h4>Parts</h4>' +
			'<table class="rpt"><tr><th>Name</th><th>Qty</th><th>Size (u)</th><th>Area</th><th>Rotation</th><th>Priority</th></tr>' + rows + '</table>';
		closeModals();
		$('reportModal').classList.remove('hidden');
	}

	$('btnReport').onclick = showReport;
	$('reportHtml').onclick = () => {
		const body = $('reportBody').innerHTML;
		const html = '<!doctype html><html><head><meta charset="utf-8"><title>Nest Report</title>' +
			'<style>body{font:13px/1.5 Segoe UI,sans-serif;color:#1b1d21;margin:28px;max-width:840px}h1{font-size:19px}h4{margin:18px 0 6px;color:#555}' +
			'table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #ddd}' +
			'th{color:#777;font-size:10px;letter-spacing:1px;text-transform:uppercase}td:last-child,th:last-child{text-align:right}' +
			'footer{color:#999;font-size:11px;margin-top:24px}</style></head><body>' +
			'<h1>Deepnest CAD — Nest Report</h1><p>Generated ' + new Date().toLocaleString() + '</p>' + body +
			'<footer>Generated by Deepnest CAD Web — https://cad-nest-pro.onrender.com</footer></body></html>';
		download('nest-report.html', html);
	};
	$('reportCsv').onclick = () => {
		const s = updateJobStats();
		let csv = 'name,qty,width_u,height_u,area_u2,rotation,priority\n';
		for (const p of liveParts()) csv += '"' + p.name + '",' + p.qty + ',' + fmt(p.bounds.width) + ',' + fmt(p.bounds.height) + ',' + Math.round(p.tArea) + ',' + (p.rotLock ? 'locked' : 'free') + ',' + (p.priority ? 'high' : 'normal') + '\n';
		download('parts.csv', csv);
	};

	/* ---- modals, collapsibles, panel drawers, presets, help ---- */

	function closeModals() { document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden')); }
	document.querySelectorAll('.modal').forEach(m => {
		m.addEventListener('click', (ev) => { if (ev.target === m) closeModals(); });
	});
	document.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModals);

	document.querySelectorAll('.panel h2.collapsible').forEach(h => {
		h.addEventListener('click', () => {
			h.classList.toggle('closed');
			const body = $(h.dataset.target);
			if (body) body.style.display = h.classList.contains('closed') ? 'none' : '';
		});
	});

	document.querySelectorAll('.paneltoggle').forEach(b => {
		b.onclick = () => {
			document.body.classList.toggle(b.dataset.panel === 'left' ? 'show-left' : 'show-right');
		};
	});
	$('drawerLeft').onclick = () => document.body.classList.toggle('show-left');
	$('drawerRight').onclick = () => document.body.classList.toggle('show-right');

	$('sheetPreset').addEventListener('change', () => {
		const v = $('sheetPreset').value;
		if (!v) return;
		const parts = v.split(':');
		const a = activeSheet();
		a.unit = parts[0]; a.w = parseFloat(parts[1]); a.h = parseFloat(parts[2]);
		renderSheets(); renderEditView(); fitView(); updateJobStats();
		toast('Sheet preset applied: ' + a.w + ' × ' + a.h + ' ' + a.unit);
	});

	$('btnHelp').onclick = () => { closeModals(); $('helpModal').classList.remove('hidden'); };
	$('polyClose').onclick = () => finishPolygon();
	$('polyCancel').onclick = () => cancelPolygon();

	window.addEventListener('keydown', (ev) => {
		if (ev.key === '?' && ev.target.tagName !== 'INPUT') { closeModals(); $('helpModal').classList.remove('hidden'); }
	});

	/* ================= init ================= */

	state.sheets = [makeSheet('Sheet 1', 600, 400, 'px')];
	state.activeSheetId = state.sheets[0].id;

	setTool('select');
	syncSnap();
	applyView();
	renderPartList();
	renderSheets();
	renderEditView();
	updateSpacingHint();
	updateJobStats();
	setStatus('Ready. Import SVG/DXF or drop files on the canvas — then press Optimize or Nest.');

	loadSample();

	// exposed for automated testing / power users
	window.__cad = {
		state, importSvgText, importDxfText, startNesting, stopNesting, setTool, fitView,
		refreshPartGeom, renderEditView, setSelection: (ids) => setSelection(ids),
		updateJobStats, computeJobStats, openOptimizer, loadJob, saveJob, showReport, computeRemnants,
		buildJobSvgString, tagJobMeta
	};
})();
