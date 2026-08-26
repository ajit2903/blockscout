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
  try {
    const pathname = new URL(
      req.url,
      `http://${req.headers.host || 'localhost'}`
    ).pathname;

    if (req.method === 'GET' && pathname === '/') {
      res.writeHead(302, { Location: '/admin' });
      return res.end();
    }

    if (req.method === 'GET' && staticFiles[pathname]) {
      return await serveStatic(res, ...staticFiles[pathname]);
    }

    if (pathname === '/api/admin/login') return await login(req, res);
    if (pathname === '/api/admin/callback') return await callback(req, res);
    if (pathname === '/api/admin/logout') return await logout(req, res);
    if (pathname === '/api/admin/dashboard') return await dashboard(req, res);
    if (pathname === '/api/admin/block') return await block(req, res);
    if (pathname === '/api/admin/transaction') return await transaction(req, res);

    res.writeHead(404);
    res.end('Not found');
  } catch (err) {
    console.error('Admin server error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`Admin panel running on http://localhost:${PORT}/admin`);
});
