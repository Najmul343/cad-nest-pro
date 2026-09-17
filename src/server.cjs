const express = require('express');
const multer = require('multer');
const path = require('path');
const deepnest = require('@deepnest/calculate-nfp');

const app = express();
const upload = multer();

// Serve the interactive workbench UI cleanly relative to project root
app.use(express.static(path.join(__dirname, '..', 'SVGnest')));

// Health check endpoint
app.get('/health', (req, res) => res.send('OK'));

app.use(express.json({ limit: '50mb' }));

// ─── Helper: build nester from request body ───────────────────────────────────
async function buildNester(tree, binPolygon, config) {
  const { AnyNest } = await import('../vendor/any-nest/dist/any-nest.js');
  const { FloatPolygon: FP } = await import('../vendor/any-nest/dist/geometry-util/float-polygon.js');

  const nester = new AnyNest();
  const nfpCache = new Map();

  config.customNfpFn = (a, b, inside) => {
    const hashPoly = (p) => {
      let coordHash = 0;
      if (p.points) {
        p.points.forEach((pt, i) => { coordHash += (pt.x + pt.y) * (i + 1); });
      }
      return `${p.points ? p.points.length : 0}_${Math.round(p.area || 0)}_${Math.round(coordHash)}`;
    };
    const key = `${hashPoly(a)}__${hashPoly(b)}__${inside}`;
    if (nfpCache.has(key)) return nfpCache.get(key);

    const formatPoly = (poly) => {
      let arr = poly.points.map(p => ({ x: p.x, y: p.y }));
      if (poly.children && poly.children.length > 0) {
        arr.children = poly.children.map(hole => hole.points.map(p => ({ x: p.x, y: p.y })));
      }
      return arr;
    };

    try {
      const result = deepnest.calculateNFP({ A: formatPoly(a), B: formatPoly(b), inside });
      if (!result || result.length === 0) { nfpCache.set(key, null); return null; }
      const floatPolys = result.map(poly => FP.fromPoints(poly.map(pt => ({ x: pt.x, y: pt.y }))));
      nfpCache.set(key, floatPolys);
      return floatPolys;
    } catch (err) {
      console.error('C++ NFP error:', err);
      nfpCache.set(key, null);
      return null;
    }
  };

  nester.config(config || {});

  const binPoints = binPolygon.points || binPolygon;
  let binPoly = FP.fromPoints(binPoints, binPolygon.id || 0);
  binPoly._id = binPolygon.id || 0;
  binPoly._rotation = binPolygon.rotation || 0;
  binPoly._source = binPolygon.source !== undefined ? binPolygon.source : 0;

  const treePolys = tree.map((part, index) => {
    const points = part.points || part;
    const partId = part.id !== undefined ? part.id : index;
    let fp = FP.fromPoints(points, partId);
    fp._id = partId;
    fp._rotation = part.rotation || 0;
    fp._source = part.source !== undefined ? part.source : index;
    return fp;
  });

  nester.setBin(binPoly);
  nester.setParts(treePolys);

  return { nester, FP };
}

// ─── Original one-shot endpoint (kept for backward compat) ───────────────────
app.post('/api/nest', async (req, res) => {
  try {
    const { tree, binPolygon, config } = req.body;
    if (!tree || !binPolygon) return res.status(400).json({ error: 'Missing tree or binPolygon' });

    const { nester } = await buildNester(tree, binPolygon, config || {});
    let bestPlacement = null;
    let maxGenerations = (config && config.generations) || 1;
    let generations = 0;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { nester.stop(); resolve(); }, 15000);
      try {
        nester.start(
          () => {},
          (placements) => {
            if (placements) bestPlacement = placements;
            generations++;
            if (generations >= maxGenerations) { clearTimeout(timeout); nester.stop(); resolve(); }
          }
        );
      } catch (err) { clearTimeout(timeout); reject(err); }
    });

    res.json({ placements: bestPlacement });
  } catch (err) {
    console.error('Nesting error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ─── SSE Streaming endpoint — sends live progress after every generation ──────
// Client connects with EventSource to /api/nest/stream?token=<id>
// Then POSTs the payload to /api/nest/start?token=<id>
// Server streams events: { type:'progress', generation, totalGenerations, fitness, placements }
// Final event: { type:'done', placements }
const pendingJobs = new Map(); // token → { tree, binPolygon, config }

app.post('/api/nest/prepare', (req, res) => {
  const { tree, binPolygon, config } = req.body;
  if (!tree || !binPolygon) return res.status(400).json({ error: 'Missing tree or binPolygon' });
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  pendingJobs.set(token, { tree, binPolygon, config: config || {} });
  // Auto-cleanup after 60 s if never consumed
  setTimeout(() => pendingJobs.delete(token), 60000);
  res.json({ token });
});

app.get('/api/nest/stream', async (req, res) => {
  const token = req.query.token;
  const job = pendingJobs.get(token);
  if (!job) return res.status(404).json({ error: 'No job found for token' });
  pendingJobs.delete(token);

  const { tree, binPolygon, config } = job;
  const maxGenerations = config.generations || 10;
  const totalParts = tree.length;

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 5000);

  try {
    const { nester } = await buildNester(tree, binPolygon, config);
    let bestPlacement = null;
    let generation = 0;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        nester.stop();
        resolve();
      }, 30000);

      try {
        nester.start(
          () => {}, // progress callback (not used)
          (placements, fitness) => {
            if (placements) bestPlacement = placements;
            generation++;

            // Count placed parts in best sheet
            const placedCount = bestPlacement && bestPlacement[0] ? bestPlacement[0].length : 0;
            const utilization = fitness !== undefined ? Math.round((1 - fitness) * 100) : null;
            const progress = Math.round((generation / maxGenerations) * 100);

            send({
              type: 'progress',
              generation,
              totalGenerations: maxGenerations,
              progress,
              fitness,
              utilization,
              placedCount,
              totalParts,
              placements: bestPlacement
            });

            if (generation >= maxGenerations) {
              clearTimeout(timeout);
              nester.stop();
              resolve();
            }
          }
        );
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });

    send({ type: 'done', placements: bestPlacement, generation, totalGenerations: maxGenerations });
  } catch (err) {
    console.error('SSE Nesting error:', err);
    send({ type: 'error', message: err.message });
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`True-Shape Nesting Engine (server-side) listening at http://0.0.0.0:${PORT}`);
});
