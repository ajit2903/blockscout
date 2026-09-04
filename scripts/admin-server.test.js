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
let oauthServer;
let oauthTokenRequests = [];
let oauthUserId = 123456;
let oauthUrl;
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
      ADMIN_PORT: String(adminPort),
      ADMIN_SESSION_SECRET: sessionSecret,
      ETHEREUM_RPC_URL: rpcUrl,
      GITHUB_ADMIN_IDS: '123456',
      GITHUB_API_URL: `${oauthUrl}/user`,
      GITHUB_AUTHORIZE_URL: `${oauthUrl}/login/oauth/authorize`,
      GITHUB_CALLBACK_URL:
        `http://127.0.0.1:${adminPort}/api/admin/callback`,
      GITHUB_CLIENT_ID: 'test-client-id',
      GITHUB_CLIENT_SECRET: 'test-client-secret',
      GITHUB_TOKEN_URL: `${oauthUrl}/login/oauth/access_token`
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

function responseCookies(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }

  return (response.headers.get('set-cookie') || '')
    .split(/,(?=\s*[^;,=\s]+=)/)
    .map(value => value.trim());
}

async function beginLogin() {
  const response = await adminRequest('/api/admin/login', {
    redirect: 'manual'
  });
  const location = new URL(response.headers.get('location'));
  const oauthCookie = responseCookies(response)[0].split(';')[0];

  return { location, oauthCookie, response };
}

async function completeLogin(location, oauthCookie, state = null) {
  const oauthState = state || location.searchParams.get('state');

  return adminRequest(
    `/api/admin/callback?code=test-code&state=${encodeURIComponent(
      oauthState
    )}`,
    {
      redirect: 'manual',
      headers: { Cookie: oauthCookie }
    }
  );
}

function signedExpiredSession() {
  const expiresAt = Math.floor(Date.now() / 1000) - 1;
  const payload = Buffer.from(
    JSON.stringify({
      issuedAt: expiresAt - 12 * 60 * 60,
      expiresAt,
      githubUserId: '123456',
      githubLogin: 'test-admin',
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
  oauthServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/login/oauth/access_token') {
      let raw = '';

      req.on('data', chunk => {
        raw += chunk;
      });

      req.on('end', () => {
        oauthTokenRequests.push(new URLSearchParams(raw));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'test-access-token' }));
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/user') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: oauthUserId, login: 'test-admin' }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const oauthPort = await listen(oauthServer);
  oauthUrl = `http://127.0.0.1:${oauthPort}`;

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

  if (oauthServer) {
    await new Promise(resolve => oauthServer.close(resolve));
  }

  if (rpcServer) {
    await new Promise(resolve => rpcServer.close(resolve));
  }
});

test('uses GitHub OAuth and signed, secure session cookies', async t => {
  const login = await beginLogin();

  assert.equal(login.response.status, 302);
  assert.equal(login.location.origin, oauthUrl);
  assert.equal(login.location.pathname, '/login/oauth/authorize');
  assert.equal(login.location.searchParams.get('client_id'), 'test-client-id');
  assert.equal(login.location.searchParams.get('code_challenge_method'), 'S256');
  assert.match(login.location.searchParams.get('code_challenge'), /^[\w-]{43}$/);
  assert.match(login.location.searchParams.get('state'), /^[\w-]{43}$/);
  assert.match(login.response.headers.get('set-cookie'), /; HttpOnly/i);
  assert.match(login.response.headers.get('set-cookie'), /; SameSite=Lax/i);
  assert.match(login.response.headers.get('set-cookie'), /; Secure/i);

  await t.test('rejects a mismatched OAuth state', async () => {
    const attemptsBefore = oauthTokenRequests.length;
    const response = await completeLogin(
      login.location,
      login.oauthCookie,
      'incorrect-state'
    );

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/admin/login.html?auth=failed');
    assert.equal(oauthTokenRequests.length, attemptsBefore);
  });

  await t.test('rejects a GitHub user outside the admin allowlist', async () => {
    oauthUserId = 999999;

    try {
      const deniedLogin = await beginLogin();
      const response = await completeLogin(
        deniedLogin.location,
        deniedLogin.oauthCookie
      );

      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), '/admin/login.html?auth=denied');
      assert.equal(
        responseCookies(response).some(value =>
          value.startsWith('admin_session=')
        ),
        false
      );
    } finally {
      oauthUserId = 123456;
    }
  });

  const freshLogin = await beginLogin();
  const callbackResponse = await completeLogin(
    freshLogin.location,
    freshLogin.oauthCookie
  );
  const callbackCookies = responseCookies(callbackResponse);
  const sessionHeader = callbackCookies.find(value =>
    value.startsWith('admin_session=')
  );
  const cookie = sessionHeader.split(';')[0];

  assert.equal(callbackResponse.status, 302);
  assert.equal(callbackResponse.headers.get('location'), '/admin');
  assert.match(sessionHeader, /; HttpOnly/i);
  assert.match(sessionHeader, /; SameSite=Strict/i);
  assert.match(sessionHeader, /; Secure/i);
  assert.match(sessionHeader, /; Max-Age=43200/i);
  assert.equal(oauthTokenRequests.at(-1).get('code'), 'test-code');
  assert.match(
    oauthTokenRequests.at(-1).get('code_verifier'),
    /^[\w-]{43}$/
  );

  await t.test('serves admin assets from deployment-safe paths', async () => {
    const page = await adminRequest('/admin');
    const html = await page.text();
    const css = await adminRequest('/admin/admin.css');
    const javascript = await adminRequest('/admin/admin.js');

    assert.match(html, /href="\/admin\/admin\.css"/);
    assert.match(html, /src="\/admin\/admin\.js"/);
    assert.equal(css.status, 200);
    assert.equal(javascript.status, 200);
  });

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
