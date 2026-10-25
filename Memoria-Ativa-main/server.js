// Servidor local do Memória Ativa.
// Serve o index.html e expõe /api/generate usando o mesmo handler da Vercel.
// A geração por IA continua dependendo de OPENAI_API_KEY e de créditos da API.
// O gerador offline do navegador não depende disso.
const http = require('http');
const fs = require('fs');
const path = require('path');
const generateHandler = require('./api/generate');
const healthHandler = require('./api/health');

const PORT = Number(process.env.PORT || 3000);
const root = __dirname;

function runHandler(handler, req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      req.body = body ? JSON.parse(body) : {};
    } catch {
      req.body = {};
    }
    try {
      await handler(req, res);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, {'Content-Type':'application/json; charset=utf-8'});
      if (!res.writableEnded) res.end(JSON.stringify({error: err.message || String(err)}));
    }
  });
}

const mime = {
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.svg':'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/generate') return runHandler(generateHandler, req, res);
  if (url.pathname === '/api/health') return runHandler(healthHandler, req, res);

  let pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(path.resolve(root) + path.sep)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type': mime[path.extname(file)] || 'application/octet-stream'});
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Memória Ativa: http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
});
