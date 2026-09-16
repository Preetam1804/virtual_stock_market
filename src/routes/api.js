'use strict';

const express = require('express');
const config = require('../config');
const store = require('../lib/store');
const auth = require('../lib/auth');
const trends = require('../lib/trends');

const router = express.Router();

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;
const round2 = (n) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ */
/* Portfolio maths                                                     */
/* ------------------------------------------------------------------ */

/** Weighted average purchase price per ticker, per user. */
function avgCost(username, symbol) {
  return store.getCostBasis()[username]?.[symbol] ?? null;
}

function setAvgCost(username, symbol, value) {
  const basis = store.getCostBasis();
  basis[username] = basis[username] || {};
  if (value === null || !Number.isFinite(value)) delete basis[username][symbol];
  else basis[username][symbol] = round2(value);
  store.saveCostBasis(basis);
}

/**
 * Builds the full portfolio summary for a user at current market prices.
 * @param {object} market Market engine instance
 * @param {object} user   Row from users.txt
 */
function summarize(market, user) {
  const portfolio = store.getPortfolio(user.username) || { holdings: {} };
  const cash = user.balance;
  const quotes = new Map(market.snapshot().map((q) => [q.symbol, q]));

  const positions = Object.entries(portfolio.holdings)
    .filter(([symbol]) => quotes.has(symbol))
    .map(([symbol, qty]) => {
      const quote = quotes.get(symbol);
      const price = quote.price;
      const value = round2(price * qty);
      const cost = avgCost(user.username, symbol);
      const basis = cost === null ? null : round2(cost * qty);
      return {
        symbol,
        name: quote.name,
        color: quote.color,
        sector: quote.sector,
        quantity: qty,
        price,
        prevClose: quote.prevClose,
        change: quote.change,
        changePct: quote.changePct,
        value,
        avgCost: cost,
        costBasis: basis,
        unrealised: basis === null ? null : round2(value - basis),
        unrealisedPct: basis === null || basis === 0 ? null : round2(((value - basis) / basis) * 10000) / 100,
        dayChange: round2((price - quote.prevClose) * qty)
      };
    })
    .sort((a, b) => b.value - a.value);

  const holdingsValue = round2(positions.reduce((sum, p) => sum + p.value, 0));

  // Holdings opened in the C client have no recorded purchase price, so P/L is
  // only computed over positions we actually know the cost of — and is null
  // (rather than a misleading zero) when there are none.
  const priced = positions.filter((p) => p.costBasis != null);
  const invested = round2(priced.reduce((sum, p) => sum + p.costBasis, 0));
  const unrealised = priced.length ? round2(priced.reduce((sum, p) => sum + p.unrealised, 0)) : null;

  const netWorth = round2(cash + holdingsValue);
  const dayChange = round2(positions.reduce((sum, p) => sum + p.dayChange, 0));
  const prevNetWorth = netWorth - dayChange;

  return {
    user: { username: user.username, fullname: user.fullname },
    cash,
    holdingsValue,
    invested,
    netWorth,
    unrealised,
    unrealisedPct: unrealised !== null && invested ? round2((unrealised / invested) * 10000) / 100 : null,
    hasFullBasis: priced.length === positions.length,
    dayChange,
    dayChangePct: prevNetWorth ? round2((dayChange / prevNetWorth) * 10000) / 100 : 0,
    positions,
    allocation: positions.map((p) => ({
      symbol: p.symbol,
      color: p.color,
      value: p.value,
      pct: netWorth ? round2((p.value / netWorth) * 10000) / 100 : 0
    }))
  };
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

router.post('/auth/signup', (req, res) => {
  const username = String(req.body?.username || '').trim();
  let fullname = String(req.body?.fullname || req.body?.username || '').trim();
  const password = String(req.body?.password || '');

  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Username must be 3-24 characters: letters, numbers, . _ or -' });
  }
  if (!fullname || fullname.length > 48) {
    return res.status(400).json({ error: 'Please enter your name (48 characters max).' });
  }
  // `users.txt` is whitespace-delimited and the C client reads the name with
  // `%s`, so fold spaces into underscores to keep both clients in sync.
  if (/\s/.test(fullname)) fullname = fullname.replace(/\s+/g, '_');
  if (password.length < 4 || password.length > 64) {
    return res.status(400).json({ error: 'Password must be 4-64 characters long.' });
  }

  // Synchronous read-modify-write: atomic under Node's single-threaded loop.
  if (store.getUser(username)) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }

  const users = store.readUsers();
  users.push({ username, fullname, password, balance: config.STARTING_BALANCE });
  store.writeUsers(users);

  const rows = store.readPortfolios();
  rows.push({ username, balance: config.STARTING_BALANCE, holdings: {} });
  store.writePortfolios(rows);

  auth.registerCredentials(username, password);
  const token = auth.createSession(username);
  auth.setSessionCookie(res, token);

  const user = store.getUser(username);
  return res.status(201).json({ user: { username, fullname }, portfolio: summarize(req.market, user) });
});

router.post('/auth/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const user = store.getUser(username);

  if (!user || !auth.verify(user, password)) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }

  const token = auth.createSession(username);
  auth.setSessionCookie(res, token);
  return res.json({ user: { username: user.username, fullname: user.fullname }, portfolio: summarize(req.market, user) });
});

router.post('/auth/logout', (req, res) => {
  auth.destroySession(req.token);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ user: { username: req.user.username, fullname: req.user.fullname }, portfolio: summarize(req.market, req.user) });
});

/* ------------------------------------------------------------------ */
/* Market                                                              */
/* ------------------------------------------------------------------ */

router.get('/market', (req, res) => {
  const stocks = req.market.snapshot();
  res.json({ stocks, index: req.market.index(stocks), tick: req.market.tickCount, tickMs: config.TICK_MS });
});

router.get('/market/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const stocks = req.market.snapshot();
  res.write(`event: init\ndata: ${JSON.stringify({ stocks, index: req.market.index(stocks) })}\n\n`);

  const onTick = (payload) => res.write(`event: tick\ndata: ${JSON.stringify(payload)}\n\n`);
  req.market.on('tick', onTick);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    req.market.off('tick', onTick);
  });
});

router.get('/market/:symbol', (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const quote = req.market.snapshot().find((s) => s.symbol === symbol);
  if (!quote) return res.status(404).json({ error: `Unknown ticker "${symbol}".` });

  const live = req.market.series(symbol);
  const trend = trends.loadTrend(symbol);

  res.json({
    quote,
    live: { prices: live.prices, candles: live.candles },
    history: { symbol, days: trend.days, hasData: trend.hasData }
  });
});

/* ------------------------------------------------------------------ */
/* Trading                                                             */
/* ------------------------------------------------------------------ */

function trade(req, res, side) {
  const symbol = String(req.body?.symbol || '').toUpperCase();
  const quantity = Number.parseInt(req.body?.quantity, 10);

  if (!config.SYMBOLS.includes(symbol)) return res.status(400).json({ error: 'Pick a listed ticker.' });
  if (!Number.isInteger(quantity) || quantity <= 0) return res.status(400).json({ error: 'Quantity must be a whole number above zero.' });
  if (quantity > 100000) return res.status(400).json({ error: 'Whoa. 100,000 shares per order, max.' });

  const price = req.market.price(symbol);
  const total = Math.round(price * quantity);
  const holdings = store.getPortfolio(req.user.username)?.holdings || {};
  const owned = holdings[symbol] || 0;

  if (side === 'buy') {
    if (total > req.user.balance) {
      return res.status(400).json({
        error: `Not enough cash — that order costs ${total.toLocaleString()} but you hold ${req.user.balance.toLocaleString()}.`
      });
    }
    const cost = avgCost(req.user.username, symbol);
    const nextAvg = cost === null ? price : (cost * owned + price * quantity) / (owned + quantity);
    const nextHoldings = { ...holdings, [symbol]: owned + quantity };

    store.saveAccount(req.user.username, { balance: req.user.balance - total, holdings: nextHoldings });
    setAvgCost(req.user.username, symbol, nextAvg);
    store.appendTrade({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      username: req.user.username,
      side: 'BUY',
      symbol,
      quantity,
      price: round2(price),
      total
    });
  } else {
    if (owned < quantity) {
      return res.status(400).json({ error: `You only hold ${owned} share(s) of ${symbol}.` });
    }
    const nextHoldings = { ...holdings };
    const remaining = owned - quantity;
    if (remaining > 0) nextHoldings[symbol] = remaining;
    else delete nextHoldings[symbol];

    store.saveAccount(req.user.username, { balance: req.user.balance + total, holdings: nextHoldings });
    if (remaining === 0) setAvgCost(req.user.username, symbol, null);
    store.appendTrade({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      username: req.user.username,
      side: 'SELL',
      symbol,
      quantity,
      price: round2(price),
      total
    });
  }

  const fresh = store.getUser(req.user.username);
  res.json({
    ok: true,
    filled: { side, symbol, quantity, price: round2(price), total },
    portfolio: summarize(req.market, fresh)
  });
}

router.post('/trade/buy', auth.requireAuth, (req, res, next) => {
  try { trade(req, res, 'buy'); } catch (err) { next(err); }
});
router.post('/trade/sell', auth.requireAuth, (req, res, next) => {
  try { trade(req, res, 'sell'); } catch (err) { next(err); }
});

router.post('/deposit', auth.requireAuth, (req, res) => {
  const amount = Number.parseInt(req.body?.amount, 10);
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: 'Enter an amount above zero.' });
  if (amount > 1000000) return res.status(400).json({ error: 'Deposits are capped at 1,000,000 per transaction.' });

  store.saveAccount(req.user.username, { balance: req.user.balance + amount });
  store.appendTrade({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    username: req.user.username,
    side: 'DEPOSIT',
    symbol: 'CASH',
    quantity: 1,
    price: amount,
    total: amount
  });

  const fresh = store.getUser(req.user.username);
  res.json({ ok: true, portfolio: summarize(req.market, fresh) });
});

/* ------------------------------------------------------------------ */
/* Portfolio, activity, leaderboard                                    */
/* ------------------------------------------------------------------ */

router.get('/portfolio', auth.requireAuth, (req, res) => {
  res.json(summarize(req.market, req.user));
});

router.get('/activity', auth.requireAuth, (req, res) => {
  const trades = store.getTrades();
  res.json({
    mine: trades.filter((t) => t.username === req.user.username).slice(-25).reverse(),
    all: trades.slice(-25).reverse()
  });
});

router.get('/leaderboard', auth.requireAuth, (req, res) => {
  const rows = store
    .readUsers()
    .map((user) => {
      const summary = summarize(req.market, user);
      return {
        username: user.username,
        fullname: user.fullname,
        netWorth: summary.netWorth,
        dayChangePct: summary.dayChangePct,
        positions: summary.positions.length,
        isMe: user.username === req.user.username
      };
    })
    .sort((a, b) => b.netWorth - a.netWorth)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  const me = rows.find((r) => r.isMe);
  res.json({ rows: rows.slice(0, 10), me: me || null, total: rows.length });
});

module.exports = router;
