'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.ADMIN_PORT || 3000);
const RPC_URL = process.env.ETHEREUM_RPC_URL;

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!RPC_URL) {
  throw new Error('ETHEREUM_RPC_URL is required');
}

if (!ADMIN_PASSWORD) {
  throw new Error('ADMIN_PASSWORD is required');
}

const SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET ||
  crypto.randomBytes(32).toString('hex');

const sessions = new Map();

function json(res, status, body) {
  const data = JSON.stringify(body);

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });

  res.end(data);
}

function parseCookies(req) {
  const cookies = {};

  for (const part of (req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');

    if (index === -1) continue;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

function sign(value) {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(value)
    .digest('hex');
}

function createSession() {
  const id = crypto.randomBytes(32).toString('hex');

  sessions.set(id, {
    createdAt: Date.now()
  });

  return id;
}

function authenticated(req) {
  const cookies = parseCookies(req);
  const token = cookies.admin_session;

  if (!token) return false;

  const session = sessions.get(token);

  if (!session) return false;

  // 12-hour session lifetime.
  if (Date.now() - session.createdAt > 12 * 60 * 60 * 1000) {
    sessions.delete(token);
    return false;
  }

  return true;
}

async function rpc(method, params = []) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    })
  });

  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}`);
  }

  const result = await response.json();

  if (result.error) {
    throw new Error(result.error.message || 'RPC error');
  }

  return result.result;
}

function hexToNumber(value) {
  return value == null ? null : Number.parseInt(value, 16);
}

async function getDashboard() {
  const started = Date.now();

  const [chainIdHex, blockNumberHex, syncing, clientVersion] =
    await Promise.all([
      rpc('eth_chainId'),
      rpc('eth_blockNumber'),
      rpc('eth_syncing'),
      rpc('web3_clientVersion')
    ]);

  return {
    rpc: {
      ok: true,
      latencyMs: Date.now() - started
    },
    network: {
      chainId: hexToNumber(chainIdHex),
      latestBlock: hexToNumber(blockNumberHex),
      syncing,
      clientVersion
    }
  };
}

async function handleApi(req, res, pathname, body) {
  if (!authenticated(req)) {
    return json(res, 401, {
      error: 'Authentication required'
    });
  }

  try {
    if (pathname === '/api/dashboard') {
      return json(res, 200, await getDashboard());
    }

    if (pathname === '/api/block') {
      const number = body?.number;

      if (!number) {
        return json(res, 400, {
          error: 'Block number is required'
        });
      }

      const block = await rpc('eth_getBlockByNumber', [
        String(number).startsWith('0x')
          ? String(number)
          : `0x${Number(number).toString(16)}`,
        false
      ]);

      return json(res, 200, block);
    }

    if (pathname === '/api/transaction') {
      const hash = body?.hash;

      if (!/^0x[a-fA-F0-9]{64}$/.test(hash || '')) {
        return json(res, 400, {
          error: 'Invalid transaction hash'
        });
      }

      const transaction = await rpc('eth_getTransactionByHash', [hash]);

      return json(res, 200, transaction);
    }

    return json(res, 404, {
      error: 'Not found'
    });
  } catch (error) {
    return json(res, 502, {
      error: error.message
    });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(302, {
      Location: '/admin'
    });

    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/admin') {
    const file = path.join(__dirname, 'admin', 'index.html');

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });

    return fs.createReadStream(file).pipe(res);
  }

  if (req.method === 'GET' && url.pathname === '/admin.js') {
    const file = path.join(__dirname, 'admin', 'admin.js');

    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store'
    });

    return fs.createReadStream(file).pipe(res);
  }

  if (req.method === 'GET' && url.pathname === '/admin.css') {
    const file = path.join(__dirname, 'admin', 'admin.css');

    res.writeHead(200, {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': 'no-store'
    });

    return fs.createReadStream(file).pipe(res);
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    let raw = '';

    req.on('data', chunk => {
      raw += chunk;
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(raw || '{}');

        if (
          data.username !== ADMIN_USER ||
          data.password !== ADMIN_PASSWORD
        ) {
          return json(res, 401, {
            error: 'Invalid username or password'
          });
        }

        const session = createSession();

        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie':
            `admin_session=${encodeURIComponent(session)}; ` +
            'HttpOnly; SameSite=Strict; Path=/; Max-Age=43200'
        });

        return res.end(
          JSON.stringify({
            authenticated: true
          })
        );
      } catch {
        return json(res, 400, {
          error: 'Invalid request'
        });
      }
    });

    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    const cookies = parseCookies(req);

    if (cookies.admin_session) {
      sessions.delete(cookies.admin_session);
    }

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie':
        'admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
    });

    return res.end(
      JSON.stringify({
        authenticated: false
      })
    );
  }

  if (
    req.method === 'POST' &&
    ['/api/block', '/api/transaction'].includes(url.pathname)
  ) {
    let raw = '';

    req.on('data', chunk => {
      raw += chunk;
    });

    req.on('end', async () => {
      try {
        const body = JSON.parse(raw || '{}');

        await handleApi(req, res, url.pathname, body);
      } catch {
        json(res, 400, {
          error: 'Invalid JSON'
        });
      }
    });

    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/dashboard') {
    return handleApi(req, res, url.pathname, {});
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Admin panel running on http://localhost:${PORT}/admin`);
});
