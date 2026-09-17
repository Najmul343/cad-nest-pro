# CAD Nest Pro — Deepnest CAD Web

A browser-based **nesting tool for laser cutters and CNC work**, rebuilt from
[Deepnest](https://github.com/Jack000/Deepnest) (Electron desktop app) as a pure
web application with a modern **CAD-style dark UI**.

**Live:** https://cad-nest-pro.onrender.com · **Local:** `npm start` → http://localhost:8138

![what it does](https://img.shields.io/badge/engine-pure_JS-brightgreen) ![deps](https://img.shields.io/badge/runtime_deps-0-blue)

## Features

- **CAD-style interface** — dark theme, toolbar, parts tree with thumbnails,
  live coordinate readout, crosshair, adaptive grid, pan/zoom canvas,
  multi-sheet tabs, status bar
- **Nesting engine** — Deepnest's genetic-algorithm nesting with no-fit-polygon
  math, running entirely in browser web workers (parallel.js)
- **Part library workflow** — import SVG, set per-part quantities, nest
  arbitrary quantities across multiple sheets
- **Configurable** — part spacing, allowed rotations, population size,
  mutation rate, curve tolerance, use part holes, explore concave regions
- **SVG export** — export nesting results (all sheets) as SVG for your cutter
- **Zero dependencies** — Node.js static server only (`node server.js`)

## Usage

1. **Import** — load your own SVG file(s), or press **Sample** for a demo set
2. **Parts panel** — set quantities (＋/−), click to select, ✕ to delete
3. **Sheet panel** — sheet size and units (px / inch / mm)
4. **Nest** — press ▶ Nest; improvements stream in live. Press ■ Stop when satisfied
5. **Export** — download the result SVG(s)

### Notes

- Units: engine units are 1/72 inch when the imported SVG carries physical
  units (mm/cm/in); unitless SVGs map 1:1 px → unit. The status bar shows the
  conversion live.
- **DXF files are not supported** — convert to SVG first (e.g. Inkscape:
  *File → Open dxf → Save as SVG*).
- Nesting runs until you stop it: more time = better layouts (it keeps
  improving generations).

## Run locally

```bash
npm start          # or: node server.js
# → http://localhost:8138
```

## Deploy (Render)

The repo is Render-ready: a Node web service with build command `npm install`
(no-op, zero deps) and start command `npm start`. The server honors the
`PORT` environment variable.

## Credits & license

Built on the work of:

- **[Deepnest](https://github.com/Jack000/Deepnest)** by Jack Qiao — nesting
  engine, SVG/DXF parser (MIT)
- **[SVGnest](https://github.com/Jack000/SVGnest)** — the pure-JS nesting core
  (MIT)
- [Clipper](http://www.angusj.com/delphi/clipper.php) by Angus Johnson (Boost),
  [parallel.js](https://github.com/addyosmani/parallel.js), pathseg polyfill by
  progers

Code from those projects is MIT-licensed; see [LICENSE](LICENSE).
