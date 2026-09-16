'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

/**
 * Every tradable instrument. `base` mirrors the price band the original C
 * client uses, `volatility` drives how jumpy the simulated tick is and
 * `color` is the accent used across the dashboard for that ticker.
 */
const STOCKS = [
  { symbol: 'APL',  name: 'Apple Inc.',  sector: 'Consumer Tech', color: '#22d3ee', base: 1500, volatility: 0.013 },
  { symbol: 'GOGL', name: 'Google',      sector: 'Internet',      color: '#a78bfa', base: 2100, volatility: 0.015 },
  { symbol: 'TSLA', name: 'Tesla',       sector: 'Automotive',    color: '#f472b6', base: 3300, volatility: 0.024 },
  { symbol: 'MSFT', name: 'Microsoft',   sector: 'Software',      color: '#34d399', base: 4450, volatility: 0.010 },
  { symbol: 'AMZN', name: 'Amazon',      sector: 'E-Commerce',    color: '#fbbf24', base: 1300, volatility: 0.017 }
];

module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  HOST: process.env.HOST || '0.0.0.0',
  ROOT,
  DATA_DIR,

  // --- Files shared with the original C client (do not change the format) ---
  USERS_FILE: path.join(ROOT, 'users.txt'),
  PORTFOLIO_FILE: path.join(ROOT, 'portfolio.txt'),
  trendFile: (symbol) => path.join(ROOT, `stock_trend_of_${symbol}.txt`),

  // --- Web-only sidecar state (JSON, gitignored) ---
  AUTH_FILE: path.join(DATA_DIR, 'auth.json'),
  TRADES_FILE: path.join(DATA_DIR, 'trades.json'),
  COST_BASIS_FILE: path.join(DATA_DIR, 'cost_basis.json'),

  STOCKS,
  SYMBOLS: STOCKS.map((s) => s.symbol),
  STARTING_BALANCE: 10000,

  /** Simulation cadence. */
  TICK_MS: 1000,
  /** Rolling window of live prices kept per ticker. */
  LIVE_WINDOW: 240,
  /** How many live ticks are folded into one candle on the live chart. */
  CANDLE_TICKS: 10
};
