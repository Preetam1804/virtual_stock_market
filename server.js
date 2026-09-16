'use strict';

/**
 * Virtual Stock Market — web server.
 *
 * Serves the dashboard and a small JSON API on top of the same flat files the
 * original C terminal client reads and writes (users.txt, portfolio.txt and
 * stock_trend_of_*.txt).
 */

const path = require('path');
const express = require('express');

const config = require('./src/config');
const store = require('./src/lib/store');
const auth = require('./src/lib/auth');
const { Market } = require('./src/lib/market');
const api = require('./src/routes/api');

const app = express();
const market = new Market();

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

// Make the market engine available to every route handler.
app.use((req, _res, next) => {
  req.market = market;
  next();
});
app.use(auth.attachUser);

app.use('/api', api);

app.use(express.static(path.join(config.ROOT, 'public'), { extensions: ['html'] }));

app.use('/api', (req, res) => res.status(404).json({ error: `No API route for ${req.method} ${req.path}` }));

app.use((err, _req, res, _next) => {
  console.error('[vsm]', err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
});

store.reconcile();
market.start();

const server = app.listen(config.PORT, config.HOST, () => {
  console.log(`\n  ▲ Virtual Stock Market`);
  console.log(`  ➜  http://localhost:${config.PORT}  (bound to ${config.HOST})`);
  console.log(`  ➜  ${config.STOCKS.length} tickers · tick every ${config.TICK_MS}ms\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    market.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
