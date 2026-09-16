const express = require('express');
const app = express();
const path = require('path');

// Serve the original SVGNest engine directly to the browser
app.use(express.static(path.join(__dirname, 'SVGnest')));

// Health check endpoint
app.get('/health', (req, res) => res.send('OK'));

const PORT = 3000;
// explicitly bind to 0.0.0.0 so both IPv4 and IPv6 tunnels can reach it reliably
app.listen(PORT, '0.0.0.0', () => {
    console.log(`True-Shape Nesting Engine PoC running at http://0.0.0.0:${PORT}`);
    console.log(`This runs the No-Fit-Polygon + Genetic Algorithm locally.`);
});
