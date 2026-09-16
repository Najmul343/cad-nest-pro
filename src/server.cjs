const express = require('express');
const multer = require('multer');
const path = require('path');

const { AnyNest: anyNest } = require('../vendor/any-nest/dist/any-nest.js');
const deepnest = require('@deepnest/calculate-nfp');
const { FloatPolygon } = require('../vendor/any-nest/dist/geometry-util/float-polygon.js');

const app = express();
const upload = multer();

// Serve the interactive workbench UI cleanly relative to project root
app.use(express.static(path.join(__dirname, '..', 'SVGnest')));

// Health check endpoint
app.get('/health', (req, res) => res.send('OK'));

app.use(express.json({ limit: '50mb' }));

app.post('/api/nest', async (req, res) => {
  try {
    const { tree, binPolygon, config } = req.body;
    if (!tree || !binPolygon) {
      return res.status(400).json({ error: 'Missing tree or binPolygon' });
    }

    const nester = new anyNest();
    
    // High-performance NFP Cache Map
    const nfpCache = new Map();

    // Inject the deepnest C++ native NFP calculator with NFP Caching!
    config.customNfpFn = (a, b, inside) => {
      const hashPoly = (p) => `${p.points ? p.points.length : 0}_${Math.round(p.area || 0)}`;
      const key = `${hashPoly(a)}__${hashPoly(b)}__${inside}__${a._rotation || 0}__${b._rotation || 0}`;

      if (nfpCache.has(key)) {
        return nfpCache.get(key);
      }

      const formatPoly = (poly) => {
        let arr = poly.points.map(p => ({ x: p.x, y: p.y }));
        if (poly.holes && poly.holes.length > 0) {
          arr.children = poly.holes.map(hole => hole.points.map(p => ({ x: p.x, y: p.y })));
        }
        return arr;
      };
      
      const group = {
        A: formatPoly(a),
        B: formatPoly(b),
        inside: inside
      };
      
      const result = deepnest.calculateNFP(group);
      
      if (!result || result.length === 0) {
        nfpCache.set(key, null);
        return null;
      }
      
      const floatPolys = result.map(poly => {
        const p = poly.map(pt => ({ x: pt.x, y: pt.y }));
        return FloatPolygon.fromPoints(p);
      });

      nfpCache.set(key, floatPolys);
      return floatPolys;
    };

    nester.config(config || {});
    
    // Convert arrays of points back into FloatPolygons expected by any-nest
    let binPoly = FloatPolygon.fromPoints(binPolygon, binPolygon.id || 0);
    binPoly._id = binPolygon.id || 0;
    binPoly._rotation = binPolygon.rotation || 0;
    binPoly._source = binPolygon.source !== undefined ? binPolygon.source : 0;

    let treePolys = tree.map((part, index) => {
      let fp = FloatPolygon.fromPoints(part, part.id || index);
      fp._id = part.id || index;
      fp._rotation = part.rotation || 0;
      fp._source = part.source !== undefined ? part.source : index;
      return fp;
    });

    nester.setBin(binPoly);
    nester.setParts(treePolys);

    let bestPlacement = null;
    let maxGenerations = config.generations || 1; // 1 generation for immediate fast response
    let generations = 0;

    await new Promise((resolve, reject) => {
      try {
        nester.start(
          (progress) => { /* ignore progress */ },
          (placements, fitness) => {
            bestPlacement = placements;
            generations++;
            if (generations >= maxGenerations) {
              nester.stop();
              resolve();
            }
          }
        );
      } catch (err) {
        reject(err);
      }
    });

    res.json({ placements: bestPlacement });
  } catch (err) {
    console.error('Nesting error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`True-Shape Nesting Engine (server-side) listening at http://0.0.0.0:${PORT}`);
});
