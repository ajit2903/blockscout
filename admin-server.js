'use strict';

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {
  block,
  callback,
  dashboard,
  login,
  logout,
  transaction
} = require('./lib/admin-service');

const PORT = Number(process.env.ADMIN_PORT || 3000);
const staticFiles = {
  '/admin': ['index.html', 'text/html; charset=utf-8'],
  '/admin/admin.css': ['admin.css', 'text/css; charset=utf-8'],
  '/admin/admin.js': ['admin.js', 'application/javascript; charset=utf-8']
};

async function serveStatic(res, filename, contentType) {
  try {
    const data = await fs.readFile(path.join(__dirname, 'admin', filename));
    res.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': contentType
    });
    res.end(data);
  } catch {
    res.writeHead(500, { 'Cache-Control': 'no-store' });
    res.end('Admin asset unavailable');
  }
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  ).pathname;

  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(302, { Location: '/admin' });
    return res.end();
  }

  if (req.method === 'GET' && staticFiles[pathname]) {
    return serveStatic(res, ...staticFiles[pathname]);
  }

  if (pathname === '/api/admin/login') return login(req, res);
  if (pathname === '/api/admin/callback') return callback(req, res);
  if (pathname === '/api/admin/logout') return logout(req, res);
  if (pathname === '/api/admin/dashboard') return dashboard(req, res);
  if (pathname === '/api/admin/block') return block(req, res);
  if (pathname === '/api/admin/transaction') return transaction(req, res);

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Admin panel running on http://localhost:${PORT}/admin`);
});
