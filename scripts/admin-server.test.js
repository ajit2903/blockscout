'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { after, before, test } = require('node:test');

const repositoryRoot = path.join(__dirname, '..');
const sessionSecret = 'test-session-secret-'.repeat(4);

let adminPort;
let adminProcess;
let rpcServer;
let rpcUrl;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

async function availablePort() {
  const server = http.createServer();
  const port = await listen(server);

  await new Promise(resolve => server.close(resolve));

  return port;
}

async function startAdmin() {
  adminPort = await availablePort();
  adminProcess = spawn(process.execPath, ['admin-server.js'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      ADMIN_COOKIE_SECURE: 'true',
      ADMIN_PASSWORD: 'correct horse battery staple',
      ADMIN_PORT: String(adminPort),
      ADMIN_SESSION_SECRET: sessionSecret,
      ADMIN_USER: 'admin',
      ETHEREUM_RPC_URL: rpcUrl
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Admin server startup timed out: ${stderr}`));
    }, 5000);

    adminProcess.stderr.on('data', chunk => {
      stderr += chunk;
    });

    adminProcess.stdout.on('data', chunk => {
      if (chunk.toString().includes('Admin panel running')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    adminProcess.once('exit', code => {
      clearTimeout(timeout);
      reject(
        new Error(`Admin server exited with code ${code}: ${stderr}`)
      );
    });
  });
}

async function stopAdmin() {
  if (!adminProcess || adminProcess.exitCode !== null) return;

  adminProcess.kill('SIGTERM');
  await once(adminProcess, 'exit');
}

function adminRequest(pathname, options = {}) {
  return fetch(`http://127.0.0.1:${adminPort}${pathname}`, options);
}

function signedExpiredSession() {
  const expiresAt = Math.floor(Date.now() / 1000) - 1;
  const payload = Buffer.from(
    JSON.stringify({
      issuedAt: expiresAt - 12 * 60 * 60,
      expiresAt,
      nonce: '0'.repeat(32)
    })
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', sessionSecret)
    .update(payload)
    .digest('hex');

  return `${payload}.${signature}`;
}

before(async () => {
  rpcServer = http.createServer((req, res) => {
    let raw = '';

    req.on('data', chunk => {
      raw += chunk;
    });

    req.on('end', () => {
      const request = JSON.parse(raw);
      const results = {
        eth_blockNumber: '0x10',
        eth_chainId: '0x1',
        eth_syncing: false,
        web3_clientVersion: 'test-client/1.0'
      };

      res.writeHead(200, {
        'Content-Type': 'application/json'
      });
      const result =
        request.method === 'eth_getBlockByNumber'
          ? { number: request.params[0] }
          : results[request.method];

      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result
        })
      );
    });
  });

  const rpcPort = await listen(rpcServer);
  rpcUrl = `http://127.0.0.1:${rpcPort}`;

  await startAdmin();
});

after(async () => {
  await stopAdmin();

  if (rpcServer) {
    await new Promise(resolve => rpcServer.close(resolve));
  }
});

test('uses signed, expiring, secure session cookies', async t => {
  const loginResponse = await adminRequest('/api/admin/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username: 'admin',
      password: 'correct horse battery staple'
    })
  });

  assert.equal(loginResponse.status, 200);

  const setCookie = loginResponse.headers.get('set-cookie');
  const cookie = setCookie.split(';')[0];

  assert.match(setCookie, /; HttpOnly/i);
  assert.match(setCookie, /; SameSite=Strict/i);
  assert.match(setCookie, /; Secure/i);
  assert.match(setCookie, /; Max-Age=43200/i);

  await t.test('accepts a valid signed session', async () => {
    const response = await adminRequest('/api/admin/dashboard', {
      headers: {
        Cookie: cookie
      }
    });

    assert.equal(response.status, 200);
  });

  await t.test('accepts block zero through the Vercel API route', async () => {
    const response = await adminRequest('/api/admin/block', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie
      },
      body: JSON.stringify({ number: 0 })
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { number: '0x0' });
  });

  await t.test('rejects oversized login payloads', async () => {
    const response = await adminRequest('/api/admin/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: 'admin',
        password: 'x'.repeat(16 * 1024)
      })
    });

    assert.equal(response.status, 413);
  });

  await t.test('rejects a tampered signature', async () => {
    const token = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
    const replacement = token.endsWith('0') ? '1' : '0';
    const tampered = `${token.slice(0, -1)}${replacement}`;
    const response = await adminRequest('/api/admin/dashboard', {
      headers: {
        Cookie: `admin_session=${encodeURIComponent(tampered)}`
      }
    });

    assert.equal(response.status, 401);
  });

  await t.test('rejects an expired signed session', async () => {
    const response = await adminRequest('/api/admin/dashboard', {
      headers: {
        Cookie: `admin_session=${encodeURIComponent(
          signedExpiredSession()
        )}`
      }
    });

    assert.equal(response.status, 401);
  });

  await t.test('survives an application restart', async () => {
    await stopAdmin();
    await startAdmin();

    const response = await adminRequest('/api/admin/dashboard', {
      headers: {
        Cookie: cookie
      }
    });

    assert.equal(response.status, 200);
  });

  await t.test('clears the secure cookie on logout', async () => {
    const response = await adminRequest('/api/admin/logout', {
      method: 'POST',
      headers: {
        Cookie: cookie
      }
    });
    const clearedCookie = response.headers.get('set-cookie');

    assert.equal(response.status, 200);
    assert.match(clearedCookie, /admin_session=;/i);
    assert.match(clearedCookie, /; Secure/i);
    assert.match(clearedCookie, /; Max-Age=0/i);
  });
});
