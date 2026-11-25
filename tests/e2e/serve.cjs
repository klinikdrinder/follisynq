const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '../../out');
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
module.exports = (port) => new Promise((res) => {
  const s = http.createServer((req, rsp) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    let f = path.join(root, p);
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { rsp.writeHead(404); return rsp.end('nf'); }
    rsp.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(rsp);
  }).listen(port, () => res(s));
});
