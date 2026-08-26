'use strict';

const crypto = require('node:crypto');

const SESSION_TTL_SECONDS = 12 * 60 * 60;
const OAUTH_TTL_SECONDS = 10 * 60;
const MAX_BODY_BYTES = 16 * 1024;
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';

class PayloadTooLargeError extends Error {}

function authConfig() {
  const githubAdminIds = new Set(
    (process.env.GITHUB_ADMIN_IDS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  );
  const githubCallbackUrl = process.env.GITHUB_CALLBACK_URL;
  const githubClientId = process.env.GITHUB_CLIENT_ID;
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
  const sessionSecret = process.env.ADMIN_SESSION_SECRET;

  if (!githubCallbackUrl) throw new Error('GITHUB_CALLBACK_URL is required');
  if (!githubClientId) throw new Error('GITHUB_CLIENT_ID is required');
  if (!githubClientSecret) throw new Error('GITHUB_CLIENT_SECRET is required');
  if (githubAdminIds.size === 0) {
    throw new Error('GITHUB_ADMIN_IDS must contain at least one GitHub user ID');
  }
  if ([...githubAdminIds].some(value => !/^\d+$/.test(value))) {
    throw new Error('GITHUB_ADMIN_IDS must contain only numeric GitHub user IDs');
  }

  if (!sessionSecret || Buffer.byteLength(sessionSecret) < 32) {
    throw new Error('ADMIN_SESSION_SECRET must be at least 32 bytes');
  }

  return {
    cookieSecure: process.env.ADMIN_COOKIE_SECURE !== 'false',
    githubAdminIds,
    githubApiUrl: process.env.GITHUB_API_URL || GITHUB_USER_URL,
    githubAuthorizeUrl:
      process.env.GITHUB_AUTHORIZE_URL || GITHUB_AUTHORIZE_URL,
    githubCallbackUrl,
    githubClientId,
    githubClientSecret,
    githubTokenUrl: process.env.GITHUB_TOKEN_URL || GITHUB_TOKEN_URL,
    sessionSecret
  };
}

function config() {
  const rpcUrl = process.env.ETHEREUM_RPC_URL;
  if (!rpcUrl) throw new Error('ETHEREUM_RPC_URL is required');

  return { ...authConfig(), rpcUrl };
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ...headers
  });
  res.end(JSON.stringify(body));
}

function redirect(res, location, cookies = []) {
  const headers = {
    'Cache-Control': 'no-store',
    Location: location
  };

  if (cookies.length > 0) headers['Set-Cookie'] = cookies;

  res.writeHead(302, headers);
  res.end();
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

function createSession(sessionSecret, githubUser) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      issuedAt,
      expiresAt: issuedAt + SESSION_TTL_SECONDS,
      githubUserId: String(githubUser.id),
      githubLogin: githubUser.login,
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

function oauthCookie(value, maxAge, cookieSecure) {
  const secure = cookieSecure ? '; Secure' : '';

  return (
    `admin_oauth=${encodeURIComponent(value)}; ` +
    'HttpOnly; SameSite=Lax; Path=/api/admin/callback; ' +
    `Max-Age=${maxAge}${secure}`
  );
}

function signedPayload(value, sessionSecret) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${sign(payload, sessionSecret)}`;
}

function readSignedPayload(value, sessionSecret) {
  const parts = (value || '').split('.');
  if (
    parts.length !== 2 ||
    !validSignature(parts[0], parts[1], sessionSecret)
  ) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function authenticated(req, sessionSecret, githubAdminIds) {
  const token = parseCookies(req).admin_session;
  if (!token) return false;

  const session = readSignedPayload(token, sessionSecret);
  if (!session) return false;

  try {
    const now = Math.floor(Date.now() / 1000);

    return (
      Number.isSafeInteger(session.issuedAt) &&
      Number.isSafeInteger(session.expiresAt) &&
      session.issuedAt <= now + 60 &&
      session.expiresAt > now &&
      session.expiresAt - session.issuedAt === SESSION_TTL_SECONDS &&
      typeof session.githubLogin === 'string' &&
      githubAdminIds.has(String(session.githubUserId))
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

function requireAuthentication(req, res, settings) {
  if (
    authenticated(req, settings.sessionSecret, settings.githubAdminIds)
  ) {
    return true;
  }

  json(res, 401, { error: 'Authentication required' });
  return false;
}

async function login(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);

  const settings = authConfig();
  const state = crypto.randomBytes(32).toString('base64url');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  const oauth = signedPayload(
    {
      state,
      codeVerifier,
      expiresAt: Math.floor(Date.now() / 1000) + OAUTH_TTL_SECONDS
    },
    settings.sessionSecret
  );
  const authorizeUrl = new URL(settings.githubAuthorizeUrl);

  authorizeUrl.searchParams.set('client_id', settings.githubClientId);
  authorizeUrl.searchParams.set('redirect_uri', settings.githubCallbackUrl);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('allow_signup', 'false');
  authorizeUrl.searchParams.set('prompt', 'select_account');

  return redirect(res, authorizeUrl.toString(), [
    oauthCookie(oauth, OAUTH_TTL_SECONDS, settings.cookieSecure)
  ]);
}

async function exchangeCode(code, codeVerifier, settings) {
  const response = await fetch(settings.githubTokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: settings.githubClientId,
      client_secret: settings.githubClientSecret,
      code,
      redirect_uri: settings.githubCallbackUrl,
      code_verifier: codeVerifier
    })
  });

  if (!response.ok) throw new Error('GitHub token exchange failed');

  const token = await response.json();
  if (typeof token.access_token !== 'string' || !token.access_token) {
    throw new Error('GitHub did not return an access token');
  }

  return token.access_token;
}

async function githubUser(accessToken, settings) {
  const response = await fetch(settings.githubApiUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'blockscout-admin',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (!response.ok) throw new Error('GitHub user lookup failed');

  const user = await response.json();
  if (!/^\d+$/.test(String(user.id)) || typeof user.login !== 'string') {
    throw new Error('GitHub returned an invalid user');
  }

  return user;
}

async function callback(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);

  const settings = authConfig();
  const clearOauthCookie = oauthCookie('', 0, settings.cookieSecure);
  const requestUrl = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );
  const code = requestUrl.searchParams.get('code');
  const state = requestUrl.searchParams.get('state');
  const oauth = readSignedPayload(
    parseCookies(req).admin_oauth,
    settings.sessionSecret
  );
  const now = Math.floor(Date.now() / 1000);

  if (
    requestUrl.searchParams.has('error') ||
    typeof code !== 'string' ||
    typeof state !== 'string' ||
    typeof oauth?.state !== 'string' ||
    typeof oauth?.codeVerifier !== 'string' ||
    !Number.isSafeInteger(oauth?.expiresAt) ||
    oauth.expiresAt <= now ||
    !safeEqual(state, oauth.state)
  ) {
    return redirect(res, '/admin?auth=failed', [clearOauthCookie]);
  }

  try {
    const accessToken = await exchangeCode(
      code,
      oauth.codeVerifier,
      settings
    );
    const user = await githubUser(accessToken, settings);

    if (!settings.githubAdminIds.has(String(user.id))) {
      return redirect(res, '/admin?auth=denied', [clearOauthCookie]);
    }

    const session = createSession(settings.sessionSecret, user);
    return redirect(res, '/admin', [
      clearOauthCookie,
      sessionCookie(
        session,
        SESSION_TTL_SECONDS,
        settings.cookieSecure
      )
    ]);
  } catch {
    return redirect(res, '/admin?auth=failed', [clearOauthCookie]);
  }
}

async function logout(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);

  const settings = authConfig();
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
  if (!requireAuthentication(req, res, settings)) return;

  try {
    return json(res, 200, await getDashboard(settings.rpcUrl));
  } catch {
    return json(res, 502, { error: 'RPC request failed' });
  }
}

async function block(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);

  const settings = config();
  if (!requireAuthentication(req, res, settings)) return;

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
  if (!requireAuthentication(req, res, settings)) return;

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
  callback,
  dashboard,
  login,
  logout,
  transaction
};
