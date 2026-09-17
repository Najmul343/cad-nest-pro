/* Generates webapp/sample.svg — one of each demo part; the app assigns quantities. Run: node sample-generator.js */
'use strict';
const fs = require('fs');

const pts = a => a.map(p => p.x.toFixed(2) + ',' + p.y.toFixed(2)).join(' ');

// gear: straight-sided teeth polygon
function gear(rOuter, rInner, teeth) {
	const a = [];
	const step = (Math.PI * 2) / teeth;
	for (let i = 0; i < teeth; i++) {
		const t = i * step;
		const tw = step * 0.28;   // half tooth width at root
		const tw2 = step * 0.20;  // half tooth width at tip
		a.push({ x: rInner * Math.cos(t - tw), y: rInner * Math.sin(t - tw) });
		a.push({ x: rOuter * Math.cos(t - tw2), y: rOuter * Math.sin(t - tw2) });
		a.push({ x: rOuter * Math.cos(t + tw2), y: rOuter * Math.sin(t + tw2) });
		a.push({ x: rInner * Math.cos(t + tw), y: rInner * Math.sin(t + tw) });
	}
	return a;
}

// L bracket outline: (0,0) (w,0) (w,t) (t,t) (t,h) (0,h)
function lbracket(w, h, t) {
	return [
		{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: t },
		{ x: t, y: t }, { x: t, y: h }, { x: 0, y: h }
	];
}

// stadium slot polygon, centered on origin
function slot(w, r) {
	const a = [];
	for (let i = 0; i <= 14; i++) {
		const t = -Math.PI / 2 + (Math.PI * i) / 14;
		a.push({ x: w / 2 + r * Math.cos(t), y: r + r * Math.sin(t) });
	}
	for (let i = 0; i <= 14; i++) {
		const t = Math.PI / 2 + (Math.PI * i) / 14;
		a.push({ x: -w / 2 + r * Math.cos(t), y: r + r * Math.sin(t) });
	}
	return a;
}

let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 940 300">\n';

// gear, center (90,90)
s += `  <polygon id="gear" points="${pts(gear(55, 46, 10))}" transform="translate(90 90)"/>\n`;
s += `  <circle id="gear-hole" cx="90" cy="90" r="14"/>\n`;

// disc, center (250,90)
s += `  <circle id="disc" cx="250" cy="90" r="65"/>\n`;
s += `  <circle id="disc-hole" cx="250" cy="90" r="20"/>\n`;

// mounting plate 140x90 at (350,40), corner holes + slot
{
	const x = 350, y = 40;
	s += `  <rect id="plate" x="${x}" y="${y}" width="140" height="90" rx="6"/>\n`;
	for (const [hx, hy] of [[16, 16], [124, 16], [16, 74], [124, 74]])
		s += `  <circle id="plate-hole" cx="${x + hx}" cy="${y + hy}" r="6"/>\n`;
	s += `  <polygon id="plate-slot" points="${pts(slot(56, 9).map(p => ({ x: p.x + x + 70, y: p.y + y + 36 })))}"/>\n`;
}

// L bracket at (530,50)
{
	const x = 530, y = 50;
	s += `  <polygon id="lbracket" points="${pts(lbracket(90, 80, 12).map(p => ({ x: p.x + x, y: p.y + y })))}"/>\n`;
	s += `  <circle id="lbracket-hole1" cx="${x + 6}" cy="${y + 55}" r="5"/>\n`;
	s += `  <circle id="lbracket-hole2" cx="${x + 63}" cy="${y + 6}" r="5"/>\n`;
}

// washer, center (700,90)
s += `  <circle id="washer" cx="700" cy="90" r="30"/>\n`;
s += `  <circle id="washer-hole" cx="700" cy="90" r="12"/>\n`;

// triangle plate
s += `  <polygon id="tri" points="780,40 890,40 780,120"/>\n`;
s += `  <circle id="tri-hole" cx="810" cy="70" r="6"/>\n`;

// stadium shim, centered (120,240)
s += `  <polygon id="shim" points="${pts(slot(80, 18).map(p => ({ x: p.x + 120, y: p.y + 222 })))}"/>\n`;

s += '</svg>\n';
fs.writeFileSync(__dirname + '/sample.svg', s);
console.log('sample.svg written, ' + s.length + ' bytes');
