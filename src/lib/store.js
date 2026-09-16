'use strict';

/**
 * Persistence layer.
 *
 * The C terminal client and this web server share the same flat files:
 *
 *   users.txt      ->  username fullname password balance
 *   portfolio.txt  ->  username balance APL:2,AMZN:1      ("None" when empty)
 *
 * Web-only extras (hashed credentials, trade log, average cost basis) live in
 * `data/*.json` so the on-disk formats the C program understands stay intact.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Every read/write in this module uses the synchronous fs API, and Node runs
 * request handlers on a single thread — so any handler that does not `await`
 * between a read and its matching write is already atomic. (Handlers must not
 * await inside a read-modify-write; none of them do.)
 */

function readText(file, fallback) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw err;
  }
}

function writeText(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, 'utf8');
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  const raw = readText(file, null);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

/* ------------------------------------------------------------------ */
/* Holdings parsing                                                    */
/* ------------------------------------------------------------------ */

/** "APL:2,AMZN:1" -> { APL: 2, AMZN: 1 } ; "None" -> {} */
function parseHoldings(raw) {
  const out = {};
  if (!raw) return out;
  const text = String(raw).trim();
  if (!text || text === 'None' || text === '-') return out;

  for (const chunk of text.split(',')) {
    const [sym, qty] = chunk.split(':');
    if (!sym) continue;
    const n = Number.parseInt(qty, 10);
    if (Number.isFinite(n) && n > 0) out[sym.trim().toUpperCase()] = n;
  }
  return out;
}

/** { APL: 2 } -> "APL:2" ; {} -> "None" */
function stringifyHoldings(holdings) {
  const parts = Object.entries(holdings)
    .filter(([, qty]) => Number.isFinite(qty) && qty > 0)
    .map(([sym, qty]) => `${sym}:${Math.trunc(qty)}`);
  return parts.length ? parts.join(',') : 'None';
}

/* ------------------------------------------------------------------ */
/* users.txt                                                           */
/* ------------------------------------------------------------------ */

function readUsers() {
  const users = [];
  for (const line of readText(config.USERS_FILE, '').split('\n')) {
    const text = line.trim();
    if (!text) continue;
    // username fullname password balance
    // `fullname` is greedy so names containing spaces still parse: everything
    // between the username and the last two tokens belongs to the name.
    const match = text.match(/^(\S+)\s+(.+?)\s+(\S+)\s+(-?\d+)\s*$/);
    if (!match) continue;
    users.push({
      username: match[1],
      fullname: match[2],
      password: match[3],
      balance: Number.parseInt(match[4], 10) || 0
    });
  }
  return users;
}

function writeUsers(users) {
  const body = users
    .map((u) => `${u.username} ${u.fullname} ${u.password} ${Math.trunc(u.balance)}\n`)
    .join('');
  writeText(config.USERS_FILE, body);
}

/* ------------------------------------------------------------------ */
/* portfolio.txt                                                       */
/* ------------------------------------------------------------------ */

function readPortfolios() {
  const rows = [];
  for (const line of readText(config.PORTFOLIO_FILE, '').split('\n')) {
    const text = line.trim();
    if (!text) continue;
    const match = text.match(/^(\S+)\s+(-?\d+)\s*(.*)$/);
    if (!match) continue;
    rows.push({
      username: match[1],
      balance: Number.parseInt(match[2], 10) || 0,
      holdings: parseHoldings(match[3])
    });
  }
  return rows;
}

function writePortfolios(rows) {
  const body = rows
    .map(
      (r) =>
        `${r.username} ${Math.trunc(r.balance)} ${stringifyHoldings(r.holdings)}\n`
    )
    .join('');
  writeText(config.PORTFOLIO_FILE, body);
}

/* ------------------------------------------------------------------ */
/* Composite reads / writes                                            */
/* ------------------------------------------------------------------ */

function getUser(username) {
  return readUsers().find((u) => u.username === username) || null;
}

function getPortfolio(username) {
  return readPortfolios().find((p) => p.username === username) || null;
}

/**
 * Keeps `portfolio.txt` in sync with `users.txt`: every account gets a row and
 * empty portfolios are normalised to "None" (the C client relies on that).
 */
function reconcile() {
  let changed = false;
  const users = readUsers();
  const rows = readPortfolios();
  const byName = new Map(rows.map((r) => [r.username, r]));

  for (const user of users) {
    const row = byName.get(user.username);
    if (!row) {
      rows.push({ username: user.username, balance: user.balance, holdings: {} });
      changed = true;
    } else if (row.balance !== user.balance) {
      row.balance = user.balance; // users.txt is the source of truth for cash
      changed = true;
    }
  }

  // Drop rows for accounts that no longer exist.
  const known = new Set(users.map((u) => u.username));
  const pruned = rows.filter((r) => known.has(r.username));
  if (pruned.length !== rows.length) changed = true;

  if (changed) writePortfolios(pruned);
  return pruned;
}

/** Writes a user's cash + holdings to both files atomically enough. */
function saveAccount(username, { balance, holdings }) {
  let touched = false;

  const users = readUsers();
  for (const u of users) {
    if (u.username === username && balance !== undefined) {
      u.balance = Math.trunc(balance);
      touched = true;
    }
  }
  if (touched) writeUsers(users);

  const rows = readPortfolios();
  let found = false;
  for (const r of rows) {
    if (r.username === username) {
      if (balance !== undefined) r.balance = Math.trunc(balance);
      if (holdings !== undefined) r.holdings = holdings;
      found = true;
    }
  }
  if (!found) {
    rows.push({
      username,
      balance: balance !== undefined ? Math.trunc(balance) : config.STARTING_BALANCE,
      holdings: holdings || {}
    });
  }
  writePortfolios(rows);
}

/* ------------------------------------------------------------------ */
/* Web-only sidecars                                                   */
/* ------------------------------------------------------------------ */

function getAuth() {
  return readJson(config.AUTH_FILE, {});
}
function saveAuth(auth) {
  writeJson(config.AUTH_FILE, auth);
}

function getTrades() {
  return readJson(config.TRADES_FILE, []);
}
function appendTrade(trade) {
  const trades = getTrades();
  trades.push(trade);
  // Keep the log bounded so the file never grows without limit.
  writeJson(config.TRADES_FILE, trades.slice(-500));
}

function getCostBasis() {
  return readJson(config.COST_BASIS_FILE, {});
}
function saveCostBasis(basis) {
  writeJson(config.COST_BASIS_FILE, basis);
}

module.exports = {
  readJson,
  writeJson,
  parseHoldings,
  stringifyHoldings,
  readUsers,
  writeUsers,
  readPortfolios,
  writePortfolios,
  getUser,
  getPortfolio,
  reconcile,
  saveAccount,
  getAuth,
  saveAuth,
  getTrades,
  appendTrade,
  getCostBasis,
  saveCostBasis
};
