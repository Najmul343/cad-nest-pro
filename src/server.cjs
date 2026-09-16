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

app.post('/api/nest', async (req, res) => {
  try {
    const { tree, binPolygon, config } = req.body;
    if (!tree || !binPolygon) {
      return res.status(400).json({ error: 'Missing tree or binPolygon' });
    }

    // Dynamic import() works from CJS to load ES Modules
    const { AnyNest } = await import('../vendor/any-nest/dist/any-nest.js');
    const { FloatPolygon } = await import('../vendor/any-nest/dist/geometry-util/float-polygon.js');

    const nester = new AnyNest();
    
    // High-performance NFP Cache Map
    const nfpCache = new Map();

    // Inject the deepnest C++ native NFP calculator with NFP Caching!
    config.customNfpFn = (a, b, inside) => {
      const hashPoly = (p) => {
        let coordHash = 0;
        if (p.points) {
          p.points.forEach((pt, i) => {
            coordHash += (pt.x + pt.y) * (i + 1);
          });
        }
        return `${p.points ? p.points.length : 0}_${Math.round(p.area || 0)}_${Math.round(coordHash)}`;
      };
      const key = `${hashPoly(a)}__${hashPoly(b)}__${inside}`;

      if (nfpCache.has(key)) {
        return nfpCache.get(key);
      }

      const formatPoly = (poly) => {
        let arr = poly.points.map(p => ({ x: p.x, y: p.y }));
        if (poly.children && poly.children.length > 0) {
          arr.children = poly.children.map(hole => hole.points.map(p => ({ x: p.x, y: p.y })));
        }
        return arr;
      };
      
      try {
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
        
        const pointArrays = result.map(poly => {
          return poly.map(pt => ({ x: pt.x, y: pt.y }));
        });

        nfpCache.set(key, pointArrays);
        return pointArrays;
      } catch (err) {
        console.error('C++ NFP error:', err);
        nfpCache.set(key, null);
        return null;
      }
    };

    nester.config(config || {});
    
    // Convert arrays of points back into FloatPolygons expected by any-nest
    const { FloatPolygon: FP } = await import('../vendor/any-nest/dist/geometry-util/float-polygon.js');
    
    const binPoints = binPolygon.points || binPolygon;
    let binPoly = FP.fromPoints(binPoints, binPolygon.id || 0);
    binPoly._id = binPolygon.id || 0;
    binPoly._rotation = binPolygon.rotation || 0;
    binPoly._source = binPolygon.source !== undefined ? binPolygon.source : 0;

    let treePolys = tree.map((part, index) => {
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

    let bestPlacement = null;
    let maxGenerations = config.generations || 1;
    let generations = 0;

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        nester.stop();
        resolve();
      }, 15000);

      try {
        nester.start(
          (progress) => { /* ignore progress */ },
          (placements, fitness) => {
            if (placements) bestPlacement = placements;
            generations++;
            if (generations >= maxGenerations) {
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
