'use strict';

/**
 * Authentication.
 *
 * The shared `users.txt` stores passwords in plaintext because the C client
 * compares them with `strcmp`. Rather than break that client, the web layer
 * keeps an scrypt hash in `data/auth.json` and migrates an account the first
 * time it signs in through the browser. Delete `data/auth.json` and the C
 * client keeps working exactly as before.
 */

const crypto = require('crypto');
const store = require('./store');

const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const sessions = new Map(); // token -> { username, expiresAt }

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyHash(stored, password) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, expected] = stored.split('$');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expectedBuf = Buffer.from(expected, 'hex');
  if (expectedBuf.length !== actual.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actual);
}

/** Verifies a password, upgrading a plaintext account to a hash on success. */
function verify(user, password) {
  const auth = store.getAuth();
  const entry = auth[user.username];

  if (entry) return verifyHash(entry.hash, password);

  const legacyOk = user.password === String(password);
  if (legacyOk) {
    auth[user.username] = { hash: hashPassword(password), migratedAt: new Date().toISOString() };
    store.saveAuth(auth);
  }
  return legacyOk;
}

function registerCredentials(username, password) {
  const auth = store.getAuth();
  auth[username] = { hash: hashPassword(password), createdAt: new Date().toISOString() };
  store.saveAuth(auth);
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { username, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

function userFromToken(token) {
  const session = token && sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session.username;
}

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAt < now) sessions.delete(token);
  }
}, 60 * 60 * 1000).unref();

/* ------------------------------------------------------------------ */
/* Cookie plumbing (tiny hand-rolled parser, no extra dependency)      */
/* ------------------------------------------------------------------ */

const COOKIE_NAME = 'vsm_session';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function readToken(req) {
  const header = req.headers.cookie;
  if (header) {
    const fromCookie = parseCookies(header)[COOKIE_NAME];
    if (fromCookie) return fromCookie;
  }
  return req.headers.authorization?.replace(/^Bearer\s+/i, '') || null;
}

function setSessionCookie(res, token) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  const existing = res.getHeader('Set-Cookie');
  const value = parts.join('; ');
  if (existing) {
    res.setHeader('Set-Cookie', [].concat(existing, value));
  } else {
    res.setHeader('Set-Cookie', value);
  }
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Express middleware: attaches `req.user` (plain object) when signed in. */
function attachUser(req, _res, next) {
  const token = readToken(req);
  const username = userFromToken(token);
  req.token = token;
  req.user = username ? store.getUser(username) : null;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'You need to sign in to do that.' });
  }
  return next();
}

module.exports = {
  verify,
  registerCredentials,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireAuth,
  hashPassword
};
