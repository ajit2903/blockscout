'use strict';

const crypto = require('node:crypto');

const SESSION_TTL_SECONDS = 12 * 60 * 60;
const MAX_BODY_BYTES = 16 * 1024;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const loginAttempts = new Map();

class PayloadTooLargeError extends Error {}

function config() {
  const rpcUrl = process.env.ETHEREUM_RPC_URL;
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD;
  const sessionSecret = process.env.ADMIN_SESSION_SECRET;

  if (!rpcUrl) throw new Error('ETHEREUM_RPC_URL is required');
  if (!adminPassword) throw new Error('ADMIN_PASSWORD is required');

  if (!sessionSecret || Buffer.byteLength(sessionSecret) < 32) {
    throw new Error('ADMIN_SESSION_SECRET must be at least 32 bytes');
  }

  return {
    adminPassword,
    adminUser,
    cookieSecure: process.env.ADMIN_COOKIE_SECURE !== 'false',
    rpcUrl,
    sessionSecret
  };
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ...headers
  });
  res.end(JSON.stringify(body));
}

function methodNotAllowed(res) {
  return json(res, 405, { error: 'Method not allowed' });
}

function parseCookies(req) {
  const cookies = {};

  for (const part of (req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      // Ignore malformed cookies instead of failing the entire request.
    }
  }

  return cookies;
}

function sign(value, sessionSecret) {
  return crypto
    .createHmac('sha256', sessionSecret)
    .update(value)
    .digest('hex');
}

function safeEqual(left, right) {
  const leftDigest = crypto.createHash('sha256').update(left).digest();
  const rightDigest = crypto.createHash('sha256').update(right).digest();

  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function createSession(sessionSecret) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      issuedAt,
      expiresAt: issuedAt + SESSION_TTL_SECONDS,
      nonce: crypto.randomBytes(16).toString('hex')
    })
  ).toString('base64url');

  return `${payload}.${sign(payload, sessionSecret)}`;
}

function validSignature(value, signature, sessionSecret) {
  if (!/^[a-f0-9]{64}$/.test(signature || '')) return false;

  return crypto.timingSafeEqual(
    Buffer.from(sign(value, sessionSecret), 'hex'),
    Buffer.from(signature, 'hex')
  );
}

function sessionCookie(value, maxAge, cookieSecure) {
  const secure = cookieSecure ? '; Secure' : '';

  return (
    `admin_session=${encodeURIComponent(value)}; ` +
    'HttpOnly; SameSite=Strict; Path=/; ' +
    `Max-Age=${maxAge}${secure}`
  );
}

function authenticated(req, sessionSecret) {
  const token = parseCookies(req).admin_session;
  if (!token) return false;

  const parts = token.split('.');
  if (
    parts.length !== 2 ||
    !validSignature(parts[0], parts[1], sessionSecret)
  ) {
    return false;
  }

  try {
    const session = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString('utf8')
    );
    const now = Math.floor(Date.now() / 1000);

    return (
      Number.isSafeInteger(session.issuedAt) &&
      Number.isSafeInteger(session.expiresAt) &&
      session.issuedAt <= now + 60 &&
      session.expiresAt > now &&
      session.expiresAt - session.issuedAt === SESSION_TTL_SECONDS
    );
  } catch {
    return false;
  }
}

function bodySize(value) {
  return Buffer.byteLength(
    typeof value === 'string' ? value : JSON.stringify(value)
  );
}

async function readJsonBody(req) {
  if (req.body !== undefined) {
    if (bodySize(req.body) > MAX_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }

    if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
      return JSON.parse(req.body || '{}');
    }

    return req.body || {};
  }

  return new Promise((resolve, reject) => {
    let bytes = 0;
    let settled = false;
    const chunks = [];

    req.on('data', chunk => {
      if (settled) return;

      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        settled = true;
        req.resume();
        reject(new PayloadTooLargeError());
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;

      settled = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });

    req.on('error', error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function clientAddress(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) {
    return forwarded.split(',')[0].trim();
  }

  return req.socket?.remoteAddress || 'unknown';
}

function rateLimited(req) {
  const now = Date.now();
  const address = clientAddress(req);
  const attempt = loginAttempts.get(address);

  if (!attempt || now - attempt.firstAttempt > LOGIN_WINDOW_MS) return false;
  return attempt.count >= MAX_LOGIN_ATTEMPTS;
}

function recordFailedLogin(req) {
  const now = Date.now();
  const address = clientAddress(req);
  const attempt = loginAttempts.get(address);

  if (!attempt || now - attempt.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.set(address, { count: 1, firstAttempt: now });
    return;
  }

  attempt.count += 1;
}

function clearFailedLogins(req) {
  loginAttempts.delete(clientAddress(req));
}

async function rpc(method, params, rpcUrl) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    })
  });

  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);

  const result = await response.json();
  if (result.error) throw new Error('RPC error');

  return result.result;
}

function hexToNumber(value) {
  return value == null ? null : Number.parseInt(value, 16);
}

async function getDashboard(rpcUrl) {
  const started = Date.now();
  const [chainIdHex, blockNumberHex, syncing, clientVersion] = await Promise.all([
    rpc('eth_chainId', [], rpcUrl),
    rpc('eth_blockNumber', [], rpcUrl),
    rpc('eth_syncing', [], rpcUrl),
    rpc('web3_clientVersion', [], rpcUrl)
  ]);

  return {
    rpc: { ok: true, latencyMs: Date.now() - started },
    network: {
      chainId: hexToNumber(chainIdHex),
      latestBlock: hexToNumber(blockNumberHex),
      syncing,
      clientVersion
    }
  };
}

function normalizeBlockNumber(value) {
  if (typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value)) {
    return `0x${BigInt(value).toString(16)}`;
  }

  if (
    (typeof value === 'number' || typeof value === 'string') &&
    /^\d+$/.test(String(value))
  ) {
    const number = BigInt(value);
    return `0x${number.toString(16)}`;
  }

  return null;
}

function requireAuthentication(req, res, sessionSecret) {
  if (authenticated(req, sessionSecret)) return true;
  json(res, 401, { error: 'Authentication required' });
  return false;
}

async function login(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);

  const settings = config();
  if (rateLimited(req)) {
    return json(res, 429, { error: 'Too many login attempts' });
  }

  let data;
  try {
    data = await readJsonBody(req);
  } catch (error) {
    return json(
      res,
      error instanceof PayloadTooLargeError ? 413 : 400,
      {
        error:
          error instanceof PayloadTooLargeError
            ? 'Request body too large'
            : 'Invalid request'
      }
    );
  }

  if (
    typeof data.username !== 'string' ||
    typeof data.password !== 'string' ||
    !safeEqual(data.username, settings.adminUser) ||
    !safeEqual(data.password, settings.adminPassword)
  ) {
    recordFailedLogin(req);
    return json(res, 401, { error: 'Invalid username or password' });
  }

  clearFailedLogins(req);
  const session = createSession(settings.sessionSecret);

  return json(
    res,
    200,
    { authenticated: true },
    {
      'Set-Cookie': sessionCookie(
        session,
        SESSION_TTL_SECONDS,
        settings.cookieSecure
      )
    }
  );
}

async function logout(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);

  const settings = config();
  return json(
    res,
    200,
    { authenticated: false },
    { 'Set-Cookie': sessionCookie('', 0, settings.cookieSecure) }
  );
}

async function dashboard(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);

  const settings = config();
  if (!requireAuthentication(req, res, settings.sessionSecret)) return;

  try {
    return json(res, 200, await getDashboard(settings.rpcUrl));
  } catch {
    return json(res, 502, { error: 'RPC request failed' });
  }
}

async function block(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);

  const settings = config();
  if (!requireAuthentication(req, res, settings.sessionSecret)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return json(
      res,
      error instanceof PayloadTooLargeError ? 413 : 400,
      {
        error:
          error instanceof PayloadTooLargeError
            ? 'Request body too large'
            : 'Invalid JSON'
      }
    );
  }

  const number = normalizeBlockNumber(body?.number);
  if (!number) return json(res, 400, { error: 'Invalid block number' });

  try {
    return json(
      res,
      200,
      await rpc('eth_getBlockByNumber', [number, false], settings.rpcUrl)
    );
  } catch {
    return json(res, 502, { error: 'RPC request failed' });
  }
}

async function transaction(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);

  const settings = config();
  if (!requireAuthentication(req, res, settings.sessionSecret)) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return json(
      res,
      error instanceof PayloadTooLargeError ? 413 : 400,
      {
        error:
          error instanceof PayloadTooLargeError
            ? 'Request body too large'
            : 'Invalid JSON'
      }
    );
  }

  const hash = body?.hash;
  if (!/^0x[a-fA-F0-9]{64}$/.test(hash || '')) {
    return json(res, 400, { error: 'Invalid transaction hash' });
  }

  try {
    return json(
      res,
      200,
      await rpc('eth_getTransactionByHash', [hash], settings.rpcUrl)
    );
  } catch {
    return json(res, 502, { error: 'RPC request failed' });
  }
}

module.exports = {
  block,
  dashboard,
  login,
  logout,
  transaction
};
