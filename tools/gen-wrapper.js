// Generates webapp/util/nfpkernel.js with the compiled nfp.wasm embedded as base64.
// Usage: node gen-wrapper.js (after asc has produced nfp.wasm)
'use strict';
const fs = require('fs');
const path = require('path');

const wasm = fs.readFileSync(path.join(__dirname, 'nfp.wasm'));
const b64 = wasm.toString('base64');

const js = `/*
 * NFP kernel wrapper — WASM-accelerated convex-convex no-fit-polygon.
 * The .wasm binary (AssemblyScript build, source: tools/nfp.ts) is embedded
 * as base64 so the kernel loads synchronously inside nested web workers too.
 * Falls back gracefully: outerNfp() returns null for non-convex pairs or
 * when WebAssembly is unavailable, and the engine uses the JS path.
 */
(function (root) {
	'use strict';

	var inst = null, exp = null;
	try {
		var raw = atob('${b64}');
		var bytes = new Uint8Array(raw.length);
		for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
		inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
		exp = inst.exports;
	} catch (e) {
		if (typeof console !== 'undefined') console.warn('NFP kernel unavailable, using JS fallback', e);
	}

	function isConvex(poly) {
		if (!poly || poly.length < 4) return !!poly && poly.length === 3;
		var sign = 0;
		for (var i = 0; i < poly.length; i++) {
			var j = i + 1 === poly.length ? 0 : i + 1;
			var k = j + 1 === poly.length ? 0 : j + 1;
			var ax = poly[j].x - poly[i].x, ay = poly[j].y - poly[i].y;
			var bx = poly[k].x - poly[j].x, by = poly[k].y - poly[j].y;
			var cross = ax * by - ay * bx;
			if (cross > 1e-9) { if (sign < 0) return false; sign = 1; }
			else if (cross < -1e-9) { if (sign > 0) return false; sign = -1; }
		}
		return true;
	}

	function nfpConvex(A, B) {
		if (!exp) return null;
		var na = A.length, nb = B.length;
		var ap = exp.alloc(na * 16);
		var f = new Float64Array(exp.memory.buffer, ap, na * 2);
		for (var i = 0; i < na; i++) { f[i*2] = A[i].x; f[i*2+1] = A[i].y; }
		var bp = exp.alloc(nb * 16);
		var g = new Float64Array(exp.memory.buffer, bp, nb * 2);
		for (var j = 0; j < nb; j++) { g[j*2] = B[j].x; g[j*2+1] = B[j].y; }
		var lp = exp.alloc(8);
		var res = exp.minkowskiConvex(ap, na, bp, nb, lp);
		var len = new Int32Array(exp.memory.buffer, lp, 1)[0];
		if (len < 3) return null;
		var o = new Float64Array(exp.memory.buffer, res, len * 2);
		var out = new Array(len);
		for (var k = 0; k < len; k++) out[k] = { x: o[k*2], y: o[k*2+1] };
		exp.resetBump();
		return out;
	}

	root.NfpKernel = {
		supported: !!exp,
		isConvex: isConvex,
		nfpConvex: nfpConvex,
		// outer NFP for a pair when both polygons are convex, else null (JS path)
		outerNfp: function (A, B) {
			if (!exp || !isConvex(A) || !isConvex(B)) return null;
			var poly = nfpConvex(A, B);
			return poly ? [poly] : null;
		}
	};
})(typeof self !== 'undefined' ? self : this);
`;

const outPath = path.join(__dirname, '..', 'Deepnest', 'webapp', 'util', 'nfpkernel.js');
fs.writeFileSync(outPath, js);
console.log('nfpkernel.js written,', js.length, 'bytes (wasm', wasm.length, 'bytes)');
