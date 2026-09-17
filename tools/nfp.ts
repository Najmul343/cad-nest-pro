// NFP kernel — convex-convex Minkowski NFP via rotating merge (O(n+m))
// Compiled to WASM with AssemblyScript (--runtime stub, no libc).
// Memory: own bump arena over linear memory; JS reads results via Float64 views.
// (module memory is exported by asc by default)

const PAGE: i32 = 65536;

let heapBase: usize = 0;
let heapPtr: usize = 0;
let heapCap: usize = 0;

function bumpAlloc(n: i32): usize {
	let p = heapPtr;
	let r = p % 8;
	if (r != 0) p += 8 - r;
	let end = p + <usize>n;
	if (end > heapCap) {
		let need: i32 = <i32>(end - heapCap);
		let pages: i32 = (need + PAGE - 1) / PAGE;
		let prev: i32 = memory.grow(pages);
		if (heapCap == 0) {
			heapBase = <usize>prev * <usize>PAGE;
			heapPtr = heapBase;
			p = heapPtr;
			r = p % 8;
			if (r != 0) p += 8 - r;
			end = p + <usize>n;
		}
		heapCap += <usize>pages * <usize>PAGE;
	}
	heapPtr = end;
	return p;
}

// reset the arena between NFP calls (JS calls this after reading results)
export function resetBump(): void {
	heapPtr = heapBase;
}

// reserve n bytes, returns offset into linear memory (JS writes input points here)
export function alloc(n: i32): usize {
	return bumpAlloc(n);
}

// signed area *2 (screen coords, y-down): >0 = clockwise-on-screen
function area2(pts: usize, n: i32): f64 {
	let s: f64 = 0;
	for (let i: i32 = 0; i < n; i++) {
		let j: i32 = i + 1 == n ? 0 : i + 1;
		let ax = load<f64>(pts + <usize>(i * 16));
		let ay = load<f64>(pts + <usize>(i * 16 + 8));
		let bx = load<f64>(pts + <usize>(j * 16));
		let by = load<f64>(pts + <usize>(j * 16 + 8));
		s += ax * by - bx * ay;
	}
	return s;
}

function normalize(pts: usize, n: i32): void {
	if (area2(pts, n) < 0) {
		for (let i: i32 = 0, j: i32 = n - 1; i < j; i++, j--) {
			const tx = load<f64>(pts + <usize>(i * 16));
			const ty = load<f64>(pts + <usize>(i * 16 + 8));
			store<f64>(pts + <usize>(i * 16), load<f64>(pts + <usize>(j * 16)));
			store<f64>(pts + <usize>(i * 16 + 8), load<f64>(pts + <usize>(j * 16 + 8)));
			store<f64>(pts + <usize>(j * 16), tx);
			store<f64>(pts + <usize>(j * 16 + 8), ty);
		}
	}
}

function copyNormalized(src: usize, n: i32, dst: usize): void {
	if (area2(src, n) < 0) {
		for (let i: i32 = 0; i < n; i++) {
			store<f64>(dst + <usize>(i * 16), load<f64>(src + <usize>((n - 1 - i) * 16)));
			store<f64>(dst + <usize>(i * 16 + 8), load<f64>(src + <usize>((n - 1 - i) * 16 + 8)));
		}
	} else {
		memory.copy(dst, src, <usize>n * 16);
	}
}

function startIdx(pts: usize, n: i32): i32 {
	let best: i32 = 0;
	let bx = load<f64>(pts);
	let by = load<f64>(pts + 8);
	for (let i: i32 = 1; i < n; i++) {
		const x = load<f64>(pts + <usize>(i * 16));
		const y = load<f64>(pts + <usize>(i * 16 + 8));
		if (y < by || (y == by && x < bx)) { best = i; bx = x; by = y; }
	}
	return best;
}

// Minkowski sum NFP of two convex polygons (either winding).
// Returns ptr to result points (f64 x,y interleaved); writes count to outLenPtr.
// Result is the merged hull of A + (-B), translated so it is relative to B's
// first vertex — matching the engine's orbit-NFP reference point.
export function minkowskiConvex(aPtr: usize, na: i32, bPtr: usize, nb: i32, outLenPtr: usize): usize {
	const total: i32 = na + nb;

	const ap = bumpAlloc(na * 16);
	copyNormalized(aPtr, na, ap);

	const bnp = bumpAlloc(nb * 16);
	for (let i: i32 = 0; i < nb; i++) {
		store<f64>(bnp + <usize>(i * 16), -load<f64>(bPtr + <usize>(i * 16)));
		store<f64>(bnp + <usize>(i * 16 + 8), -load<f64>(bPtr + <usize>(i * 16 + 8)));
	}
	normalize(bnp, nb);

	const b0x = load<f64>(bPtr);
	const b0y = load<f64>(bPtr + 8);

	let ia: i32 = startIdx(ap, na);
	let ib: i32 = startIdx(bnp, nb);

	const out = bumpAlloc(total * 16 * 2 + 32);
	const outPts = out + 16;
	let count: i32 = 0;

	let i: i32 = ia;
	let j: i32 = ib;
	const cap: i32 = total * 2 + 4;
	let fx: f64 = 0, fy: f64 = 0;
	let guard: i32 = 0;
	while (guard++ < cap) {
		const ax = load<f64>(ap + <usize>(i * 16));
		const ay = load<f64>(ap + <usize>(i * 16 + 8));
		const bx = load<f64>(bnp + <usize>(j * 16));
		const by = load<f64>(bnp + <usize>(j * 16 + 8));
		const px = ax + bx + b0x;
		const py = ay + by + b0y;

		if (count == 0) {
			fx = px; fy = py;
		} else {
			const dx = px - fx, dy = py - fy;
			if (dx * dx + dy * dy < 1e-18) break; // closed the loop
			let revisited = false;
			for (let q: i32 = 1; q < count; q++) {
				const qx = load<f64>(outPts + <usize>(q * 16));
				const qy = load<f64>(outPts + <usize>(q * 16 + 8));
				const ex = px - qx, ey = py - qy;
				if (ex * ex + ey * ey < 1e-18) { revisited = true; break; }
			}
			if (revisited) break;
		}
		store<f64>(outPts + <usize>(count * 16), px);
		store<f64>(outPts + <usize>(count * 16 + 8), py);
		count++;

		const i1: i32 = i + 1 == na ? 0 : i + 1;
		const j1: i32 = j + 1 == nb ? 0 : j + 1;
		const eax = load<f64>(ap + <usize>(i1 * 16)) - ax;
		const eay = load<f64>(ap + <usize>(i1 * 16 + 8)) - ay;
		const ebx = load<f64>(bnp + <usize>(j1 * 16)) - bx;
		const eby = load<f64>(bnp + <usize>(j1 * 16 + 8)) - by;
		const cross = eax * eby - eay * ebx;
		if (cross > 1e-12) {
			i = i1;
		} else if (cross < -1e-12) {
			j = j1;
		} else {
			i = i1;
			j = j1;
		}
	}

	// drop consecutive duplicates and a closing duplicate
	let w: i32 = 0;
	for (let r: i32 = 0; r < count; r++) {
		const cx = load<f64>(outPts + <usize>(r * 16));
		const cy = load<f64>(outPts + <usize>(r * 16 + 8));
		if (w > 0) {
			const px = load<f64>(outPts + <usize>((w - 1) * 16));
			const py = load<f64>(outPts + <usize>((w - 1) * 16 + 8));
			const dx = cx - px, dy = cy - py;
			if (dx * dx + dy * dy < 1e-18) continue;
		}
		if (r == count - 1 && w > 0) {
			const fx = load<f64>(outPts);
			const fy = load<f64>(outPts + 8);
			const dx = cx - fx, dy = cy - fy;
			if (dx * dx + dy * dy < 1e-18) continue;
		}
		if (w != r) {
			store<f64>(outPts + <usize>(w * 16), cx);
			store<f64>(outPts + <usize>(w * 16 + 8), cy);
		}
		w++;
	}

	store<i32>(outLenPtr, w);
	store<i32>(out, w);
	return outPts;
}
