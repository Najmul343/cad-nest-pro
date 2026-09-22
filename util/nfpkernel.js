/*
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
		var raw = atob('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');
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
		// Correct convex-convex outer NFP: Minkowski sum A + (-B) by edge merge.
		// Replaces the wrong WASM attempt (it returned A+B, not the NFP).
		outerNfp: (function () {
			function pa(p){ var a=0,i,j; for(i=0,j=p.length-1;i<p.length;j=i++) a+=p[j].x*p[i].y-p[i].x*p[j].y; return a/2; }
			function ccw(p){ p=p.slice(); if(p.length>1 && p[0].x===p[p.length-1].x && p[0].y===p[p.length-1].y) p.pop(); if(pa(p)<0) p.reverse(); return p; }
			function bottomStart(p){ var k=0,i; for(i=1;i<p.length;i++){ if(p[i].y<p[k].y || (p[i].y===p[k].y && p[i].x<p[k].x)) k=i; } return p.slice(k).concat(p.slice(0,k)); }
			function msum(A,B){
				A=bottomStart(A); B=bottomStart(B);
				var out=[], i=0, j=0, n=A.length, m=B.length;
				while(i<n || j<m){
					var av=A[i%n], bv=B[j%m], v={x:av.x+bv.x, y:av.y+bv.y};
					if(!out.length || Math.abs(v.x-out[out.length-1].x)>1e-9 || Math.abs(v.y-out[out.length-1].y)>1e-9) out.push(v);
					if(i>=n){ j++; continue; }
					if(j>=m){ i++; continue; }
					var ax=A[(i+1)%n].x-av.x, ay=A[(i+1)%n].y-av.y;
					var bx=B[(j+1)%m].x-bv.x, by=B[(j+1)%m].y-bv.y;
					var cr=ax*by-ay*bx;
					if(cr>1e-9 || (Math.abs(cr)<=1e-9 && (ax*bx+ay*by)>=0)) i++;
					else if(cr<-1e-9) j++;
					else { i++; j++; }
				}
				if(out.length>1 && Math.abs(out[0].x-out[out.length-1].x)<1e-9 && Math.abs(out[0].y-out[out.length-1].y)<1e-9) out.pop();
				return out;
			}
			return function (A, B) {
				if (!isConvex(A) || !isConvex(B)) return null;
				// first-vertex-anchored like the JS path: NFP tracks B[0]; reflect B about its first vertex
				var R = B.map(function (p) { return { x: B[0].x - p.x, y: B[0].y - p.y }; });
				var poly = msum(ccw(A), ccw(R));
				return poly.length > 2 ? [poly] : null;
			};
		})(),
	};
})(typeof self !== 'undefined' ? self : this);
