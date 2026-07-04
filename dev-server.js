// Minimal static dev server for BookSharez — zero dependencies.
// Needed because js/main.js is an ES module, which browsers refuse to load
// from file:// URLs. Usage:
//   node dev-server.js          → http://localhost:7654
//   node dev-server.js 8080     → custom port
// The verify-*.js Playwright harnesses expect port 7654.
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.argv[2] || 7654);
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end("Not found"); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log(`BookSharez dev server → http://localhost:${PORT}`));
