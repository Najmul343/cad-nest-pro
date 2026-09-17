/*
 * Deepnest Web - tiny zero-dependency static file server.
 * Serves the CAD web app on http://localhost:8138
 *
 * Usage:  node server.js   [port]
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
// Render and most hosts inject PORT; default to 8138 for local runs
const PORT = parseInt(process.env.PORT, 10) || parseInt(process.argv[2], 10) || 8138;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    res.writeHead(400);
    return res.end('Bad request');
  }

  if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('OK');
  }

  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 Not Found: ' + urlPath);
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

// must bind 0.0.0.0 on Render - binding 127.0.0.1 fails their port detection
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  Deepnest Web (CAD edition)');
  console.log('  --------------------------');
  console.log('  Local:  http://localhost:' + PORT);
  console.log('  Press Ctrl+C to stop the server.');
});
